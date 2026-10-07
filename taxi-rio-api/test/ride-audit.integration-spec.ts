import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import {
  MySqlContainer,
  type StartedMySqlContainer,
} from '@testcontainers/mysql';
import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ACTOR_USER_IDS, type Actor } from '../src/auth/domain/actor';
import { configureApp } from '../src/configure-app';
import { MongodbService } from '../src/mongodb/mongodb.service';
import { RideAuditModule } from '../src/rides/audit/ride-audit.module';
import {
  isRideResponse,
  type RideResponse,
} from '../src/rides/domain/ride-response';
import { RideStatus } from '../src/rides/domain/ride-status';
import {
  RIDE_AUDIT_COLLECTION,
  type RideAuditRecord,
} from '../src/rides/events/ride-audit-event';
import { useExampleJwtEnv } from './jwt-env';

describe('Ride audit (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redisContainer: StartedRedisContainer;
  let rabbitmq: StartedRabbitMQContainer;
  let mongodb: StartedMongoDBContainer;
  let app: INestApplication<App>;
  let mongo: MongodbService;
  let passageiroToken = '';
  let motoristaToken = '';

  beforeAll(async () => {
    useExampleJwtEnv();
    mysql = await new MySqlContainer('mysql:8.4')
      .withDatabase('taxi_rio')
      .withUsername('admin')
      .withRootPassword('root')
      .withUserPassword('admin')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();
    rabbitmq = await new RabbitMQContainer(
      'rabbitmq:4-management-alpine',
    ).start();
    mongodb = await new MongoDBContainer('mongo:7').start();

    process.env.MYSQL_HOST = mysql.getHost();
    process.env.MYSQL_PORT = String(mysql.getPort());
    process.env.MYSQL_USER = mysql.getUsername();
    process.env.MYSQL_PASSWORD = mysql.getUserPassword();
    process.env.MYSQL_DATABASE = mysql.getDatabase();
    process.env.REDIS_HOST = redisContainer.getHost();
    process.env.REDIS_PORT = String(redisContainer.getPort());
    process.env.RABBITMQ_URL = rabbitmq.getAmqpUrl();
    process.env.MONGODB_URI = mongodb.getConnectionString();
    process.env.MONGODB_DATABASE = 'taxi_rio';
    process.env.RIDE_CACHE_TTL_SECONDS = '300';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, RideAuditModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    mongo = app.get(MongodbService);
    passageiroToken = await issueToken('passageiro');
    motoristaToken = await issueToken('motorista');
  });

  beforeEach(async () => {
    await mongo.collection(RIDE_AUDIT_COLLECTION).deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await mongodb?.stop();
    await rabbitmq?.stop();
    await redisContainer?.stop();
    await mysql?.stop();
  });

  it('inserts corridas_audit on create and updates that record on status changes', async () => {
    const payload = {
      userId: ACTOR_USER_IDS.passageiro,
      localPartida: 'São Conrado',
      localDestino: 'Centro',
      dhInicio: '2026-10-07T18:00:00.000Z',
    };
    const key = randomUUID();

    const created = readRide(
      (
        await request(app.getHttpServer())
          .post('/corridas')
          .set('Authorization', authorization('passageiro'))
          .set('Idempotency-Key', key)
          .send(payload)
          .expect(201)
      ).body,
    );

    await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization('passageiro'))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    const afterCreate = await waitForAudit(
      created.id,
      (docs) =>
        docs.length === 1 && docs[0]?.status_corrida === RideStatus.Requested,
    );
    expect(afterCreate[0]).toMatchObject({
      id_corrida: created.id,
      status_corrida: RideStatus.Requested,
      computed_elapsed_time: null,
    });
    expect(afterCreate[0]?.dh_inicio.toISOString()).toBe(created.dhInicio);
    expect(afterCreate[0]?.dh_fim).toBeNull();

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Requested })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const afterInitialized = await loadAudits(created.id);
    expect(afterInitialized).toHaveLength(1);
    expect(afterInitialized[0]?.status_corrida).toBe(RideStatus.Requested);

    const finished = readRide(
      (
        await request(app.getHttpServer())
          .patch(`/corridas/${created.id}/status`)
          .set('Authorization', authorization('motorista'))
          .send({ statusCorrida: RideStatus.Finished })
          .expect(200)
      ).body,
    );

    const afterFinished = await waitForAudit(
      created.id,
      (docs) =>
        docs.length === 1 && docs[0]?.status_corrida === RideStatus.Finished,
    );
    expect(afterFinished[0]).toMatchObject({
      id_corrida: created.id,
      status_corrida: RideStatus.Finished,
    });
    expect(finished.dhFim).toEqual(expect.any(String));
    expect(afterFinished[0]?.dh_inicio.toISOString()).toBe(created.dhInicio);
    expect(afterFinished[0]?.dh_fim?.toISOString()).toBe(finished.dhFim);
    expect(afterFinished[0]?.computed_elapsed_time).toBe(
      (Date.parse(finished.dhFim as string) - Date.parse(created.dhInicio)) /
        60_000,
    );
  });

  function authorization(actor: Actor): string {
    const token = actor === 'passageiro' ? passageiroToken : motoristaToken;
    return `Bearer ${token}`;
  }

  async function issueToken(actor: Actor): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/auth/generate-token/${actor}`)
      .expect(200);
    return readAccessToken(response.body);
  }

  async function waitForAudit(
    rideId: string,
    matches: (docs: RideAuditRecord[]) => boolean,
    timeoutMs = 10_000,
  ): Promise<RideAuditRecord[]> {
    const deadline = Date.now() + timeoutMs;
    let docs = await loadAudits(rideId);
    while (!matches(docs) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      docs = await loadAudits(rideId);
    }
    if (!matches(docs)) {
      throw new Error(
        `Timed out waiting for audit records, got ${JSON.stringify(docs)}`,
      );
    }

    return docs;
  }

  async function loadAudits(rideId: string): Promise<RideAuditRecord[]> {
    return mongo
      .collection<RideAuditRecord>(RIDE_AUDIT_COLLECTION)
      .find({ id_corrida: rideId })
      .sort({ _id: 1 })
      .toArray();
  }
});

function readAccessToken(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string' ||
    value.accessToken.length === 0
  ) {
    throw new Error('Token response is invalid');
  }

  return value.accessToken;
}

function readRide(value: unknown): RideResponse {
  if (!isRideResponse(value)) {
    throw new Error('Response is not a ride');
  }

  return value;
}
