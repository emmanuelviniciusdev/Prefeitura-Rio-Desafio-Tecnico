import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  MySqlContainer,
  type StartedMySqlContainer,
} from '@testcontainers/mysql';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import {
  isRideResponse,
  type RideResponse,
} from '../src/rides/domain/ride-response';
import { RideStatus } from '../src/rides/domain/ride-status';
import { rideCacheKey } from '../src/rides/cache/ride-cache.service';

describe('Rides (integration)', () => {
  let mysql: StartedMySqlContainer;
  let redisContainer: StartedRedisContainer;
  let redis: Redis;
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    mysql = await new MySqlContainer('mysql:8.4')
      .withDatabase('taxi_rio')
      .withUsername('admin')
      .withRootPassword('root')
      .withUserPassword('admin')
      .start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();

    process.env.MYSQL_HOST = mysql.getHost();
    process.env.MYSQL_PORT = String(mysql.getPort());
    process.env.MYSQL_USER = mysql.getUsername();
    process.env.MYSQL_PASSWORD = mysql.getUserPassword();
    process.env.MYSQL_DATABASE = mysql.getDatabase();
    process.env.REDIS_HOST = redisContainer.getHost();
    process.env.REDIS_PORT = String(redisContainer.getPort());
    process.env.RIDE_CACHE_TTL_SECONDS = '300';

    redis = new Redis({
      host: redisContainer.getHost(),
      port: redisContainer.getPort(),
      maxRetriesPerRequest: 2,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM idempotency_keys');
    await dataSource.query('DELETE FROM corridas');
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    if (redis) {
      await redis.quit();
    }
    await redisContainer?.stop();
    await mysql?.stop();
  });

  it('creates the corridas table with the expected columns and checks', async () => {
    const columns = (await queryRows(dataSource, columnSql())).map(
      readFirstString,
    );
    expect(columns).toEqual([
      'id',
      'user_id',
      'local_partida',
      'local_destino',
      'tempo_decorrido_minutos',
      'status_corrida',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
    ]);

    await expect(
      insertRide({ status: 'pending', elapsedMinutes: 0 }),
    ).rejects.toThrow();
    await expect(
      insertRide({ status: RideStatus.Accepted, elapsedMinutes: -1 }),
    ).rejects.toThrow();

    const elapsedColumn = await queryRows(
      dataSource,
      `SELECT COLUMN_TYPE AS columnType
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'corridas'
         AND COLUMN_NAME = 'tempo_decorrido_minutos'`,
    );
    expect(readFirstString(elapsedColumn[0]).toLowerCase()).toContain('float');
  });

  it('creates a ride and replays the same Idempotency-Key', async () => {
    const payload = ridePayload();
    const created = await request(app.getHttpServer())
      .post('/corridas')
      .set('Idempotency-Key', 'create-1')
      .set('X-Actor', 'ana')
      .send(payload)
      .expect(201);

    const ride = readRide(created.body);
    expect(ride).toMatchObject({
      userId: payload.userId,
      localPartida: 'São Conrado',
      localDestino: 'Centro',
      tempoDecorridoMinutos: 0,
      statusCorrida: RideStatus.Accepted,
      createdBy: 'ana',
      updatedBy: 'ana',
    });

    const replayed = await request(app.getHttpServer())
      .post('/corridas')
      .set('Idempotency-Key', 'create-1')
      .set('X-Actor', 'bruno')
      .send(payload)
      .expect(201);

    expect(replayed.body).toEqual(created.body);
    expect(await countRows('corridas')).toBe(1);
    expect(await countRows('idempotency_keys')).toBe(1);

    const stored = await storedRide(ride.id);
    expect(stored).toMatchObject({
      origin: 'São Conrado',
      status: RideStatus.Accepted,
      createdBy: 'ana',
      updatedBy: 'ana',
    });
  });

  it('rejects a reused Idempotency-Key when the body changes', async () => {
    const payload = ridePayload();
    await request(app.getHttpServer())
      .post('/corridas')
      .set('Idempotency-Key', 'create-2')
      .send(payload)
      .expect(201);

    await request(app.getHttpServer())
      .post('/corridas')
      .set('Idempotency-Key', 'create-2')
      .send({ ...payload, localDestino: 'Leblon' })
      .expect(409);

    expect(await countRows('corridas')).toBe(1);
  });

  it('requires Idempotency-Key and ignores unknown fields', async () => {
    const payload = ridePayload();
    await request(app.getHttpServer())
      .post('/corridas')
      .send(payload)
      .expect(400);
    await request(app.getHttpServer())
      .post('/corridas')
      .set('Idempotency-Key', 'create-3')
      .send({ ...payload, statusCorrida: RideStatus.Finished })
      .expect(400);
    expect(await countRows('corridas')).toBe(0);
  });

  it('creates one ride when the same key is submitted concurrently', async () => {
    const payload = ridePayload();
    const send = () =>
      request(app.getHttpServer())
        .post('/corridas')
        .set('Idempotency-Key', 'create-race')
        .send(payload);

    const [first, second] = await Promise.all([send(), send()]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await countRows('corridas')).toBe(1);
  });

  it('accepts, starts and finishes a ride', async () => {
    const created = readRide(
      (
        await request(app.getHttpServer())
          .post('/corridas')
          .set('Idempotency-Key', 'status-1')
          .set('X-Actor', 'ana')
          .send(ridePayload())
          .expect(201)
      ).body,
    );

    const accepted = await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('X-Actor', 'bruno')
      .send({ statusCorrida: RideStatus.Accepted })
      .expect(200);
    expect(readRide(accepted.body)).toMatchObject({
      statusCorrida: RideStatus.Accepted,
      updatedBy: 'ana',
    });

    const started = await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('X-Actor', 'bruno')
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(200);
    expect(readRide(started.body).statusCorrida).toBe(RideStatus.Initialized);

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .send({ statusCorrida: RideStatus.Finished })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .send({
        statusCorrida: RideStatus.Finished,
        tempoDecorridoMinutos: 27.5,
      })
      .set('X-Actor', 'carla')
      .expect(200);

    const finished = await storedRide(created.id);
    expect(finished).toMatchObject({
      status: RideStatus.Finished,
      elapsedMinutes: 27.5,
      createdBy: 'ana',
      updatedBy: 'carla',
    });

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(409);
  });

  it('rejects skipping from accepted to finished and unknown rides', async () => {
    const created = readRide(
      (
        await request(app.getHttpServer())
          .post('/corridas')
          .set('Idempotency-Key', 'status-2')
          .send(ridePayload())
          .expect(201)
      ).body,
    );

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .send({
        statusCorrida: RideStatus.Finished,
        tempoDecorridoMinutos: 5,
      })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .send({
        statusCorrida: RideStatus.Initialized,
        tempoDecorridoMinutos: 5,
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/corridas/${randomUUID()}/status`)
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(404);
    await request(app.getHttpServer()).get('/corridas/not-a-uuid').expect(400);
    await request(app.getHttpServer())
      .get(`/corridas/${randomUUID()}`)
      .expect(404);
  });

  it('serves GET from Redis until a status change invalidates the cache', async () => {
    const createdResponse = await request(app.getHttpServer())
      .post('/corridas')
      .set('Idempotency-Key', 'cache-1')
      .send(ridePayload({ localPartida: 'Copacabana' }))
      .expect(201);
    const created = readRide(createdResponse.body);

    expect(await redis.get(rideCacheKey(created.id))).toBeNull();

    const firstGet = await request(app.getHttpServer())
      .get(`/corridas/${created.id}`)
      .expect(200);
    expect(firstGet.body).toEqual(createdResponse.body);
    expect(await redis.get(rideCacheKey(created.id))).toContain('Copacabana');

    await dataSource.query(
      'UPDATE corridas SET local_partida = ? WHERE id = ?',
      ['Botafogo', created.id],
    );

    const cachedGet = await request(app.getHttpServer())
      .get(`/corridas/${created.id}`)
      .expect(200);
    expect(readRide(cachedGet.body).localPartida).toBe('Copacabana');

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(200);

    const refreshed = readRide(
      (
        await request(app.getHttpServer())
          .get(`/corridas/${created.id}`)
          .expect(200)
      ).body,
    );
    expect(refreshed.localPartida).toBe('Botafogo');
    expect(refreshed.statusCorrida).toBe(RideStatus.Initialized);
    expect(await redis.get(rideCacheKey(created.id))).toContain('Botafogo');
  });

  it('does not cache a missing ride', async () => {
    await request(app.getHttpServer())
      .get(`/corridas/${randomUUID()}`)
      .expect(404);
    expect(await redis.keys('taxi-rio:rides:*')).toEqual([]);
  });

  it('publishes the ride endpoints on Swagger', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);

    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const paths = openApiPaths(response.body);
    expect(paths['/corridas']).toBeDefined();
    expect(paths['/corridas/{id}']).toBeDefined();
    expect(paths['/corridas/{id}/status']).toBeDefined();

    const document = JSON.stringify(response.body);
    expect(document).toContain('Idempotency-Key');
    expect(document).toContain('Cria uma corrida');
    expect(document).toContain('Aceita, inicia ou finaliza uma corrida');
    expect(document).toContain('Redis');

    expect(
      openApiProperty(response.body, 'CreateRideDto', 'tempoDecorridoMinutos'),
    ).toMatchObject({ type: 'number', format: 'float' });
    expect(
      openApiProperty(
        response.body,
        'UpdateRideStatusDto',
        'tempoDecorridoMinutos',
      ),
    ).toMatchObject({ type: 'number', format: 'float' });
    expect(
      openApiProperty(response.body, 'RideResponseDto', 'tempoDecorridoMinutos'),
    ).toMatchObject({ type: 'number', format: 'float' });
  });

  async function insertRide(values: {
    status: string;
    elapsedMinutes: number;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO corridas (
        id, user_id, local_partida, local_destino, tempo_decorrido_minutos,
        status_corrida, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, 'A', 'B', ?, ?, UTC_TIMESTAMP(3), 'test', UTC_TIMESTAMP(3), 'test')`,
      [randomUUID(), randomUUID(), values.elapsedMinutes, values.status],
    );
  }

  async function storedRide(id: string): Promise<{
    origin: string;
    status: string;
    elapsedMinutes: number;
    createdBy: string;
    updatedBy: string;
  }> {
    const rows = await queryRows(
      dataSource,
      `SELECT local_partida AS origin, status_corrida AS status,
              tempo_decorrido_minutos AS elapsedMinutes, created_by AS createdBy,
              updated_by AS updatedBy
       FROM corridas WHERE id = ?`,
      [id],
    );
    return parseStoredRide(rows[0]);
  }

  async function countRows(
    table: 'corridas' | 'idempotency_keys',
  ): Promise<number> {
    const sql =
      table === 'corridas'
        ? 'SELECT COUNT(*) AS total FROM corridas'
        : 'SELECT COUNT(*) AS total FROM idempotency_keys';
    const rows = await queryRows(dataSource, sql);
    return readTotal(rows[0]);
  }
});

function ridePayload(overrides?: {
  localPartida?: string;
  localDestino?: string;
}): {
  userId: string;
  localPartida: string;
  localDestino: string;
} {
  return {
    userId: randomUUID(),
    localPartida: overrides?.localPartida ?? 'São Conrado',
    localDestino: overrides?.localDestino ?? 'Centro',
  };
}

function readRide(value: unknown): RideResponse {
  if (!isRideResponse(value)) {
    throw new Error('Response is not a ride');
  }

  return value;
}

function columnSql(): string {
  return `SELECT COLUMN_NAME AS columnName
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'corridas'
          ORDER BY ORDINAL_POSITION`;
}

async function queryRows(
  dataSource: DataSource,
  sql: string,
  parameters: unknown[] = [],
): Promise<readonly unknown[]> {
  const rows: unknown = await dataSource.query(sql, parameters);
  if (!isUnknownArray(rows)) {
    throw new Error('Expected query rows');
  }

  return rows;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function readFirstString(row: unknown): string {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Expected a row');
  }

  const value = Object.values(row as Record<string, unknown>)[0];
  if (typeof value !== 'string') {
    throw new Error('Expected a string column');
  }

  return value;
}

function readTotal(row: unknown): number {
  if (typeof row !== 'object' || row === null || !('total' in row)) {
    throw new Error('Expected a total column');
  }

  const total = row.total;
  if (typeof total === 'number') {
    return total;
  }
  if (typeof total === 'string' || typeof total === 'bigint') {
    return Number(total);
  }

  throw new Error('Unexpected total type');
}

function parseStoredRide(row: unknown): {
  origin: string;
  status: string;
  elapsedMinutes: number;
  createdBy: string;
  updatedBy: string;
} {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Expected a stored ride');
  }

  const record = row as Record<string, unknown>;
  const elapsed = record.elapsedMinutes;
  if (
    typeof record.origin !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.createdBy !== 'string' ||
    typeof record.updatedBy !== 'string' ||
    (typeof elapsed !== 'number' && typeof elapsed !== 'string')
  ) {
    throw new Error('Stored ride row is incomplete');
  }

  return {
    origin: record.origin,
    status: record.status,
    elapsedMinutes: Number(elapsed),
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

function openApiProperty(
  document: unknown,
  schemaName: string,
  propertyName: string,
): Record<string, unknown> {
  if (typeof document !== 'object' || document === null) {
    throw new Error('OpenAPI document is invalid');
  }

  const components = (document as { components?: unknown }).components;
  if (typeof components !== 'object' || components === null) {
    throw new Error('OpenAPI components are missing');
  }

  const schemas = (components as { schemas?: unknown }).schemas;
  if (typeof schemas !== 'object' || schemas === null) {
    throw new Error('OpenAPI schemas are missing');
  }

  const schema = (schemas as Record<string, unknown>)[schemaName];
  if (typeof schema !== 'object' || schema === null) {
    throw new Error(`Schema ${schemaName} was not found`);
  }

  const properties = (schema as { properties?: unknown }).properties;
  if (typeof properties !== 'object' || properties === null) {
    throw new Error(`Schema ${schemaName} has no properties`);
  }

  const property = (properties as Record<string, unknown>)[propertyName];
  if (typeof property !== 'object' || property === null) {
    throw new Error(`Property ${propertyName} was not found on ${schemaName}`);
  }

  return property as Record<string, unknown>;
}

function openApiPaths(document: unknown): Record<string, unknown> {
  if (
    typeof document !== 'object' ||
    document === null ||
    !('paths' in document)
  ) {
    throw new Error('OpenAPI document has no paths');
  }

  const paths = document.paths;
  if (typeof paths !== 'object' || paths === null) {
    throw new Error('OpenAPI paths are invalid');
  }

  return paths as Record<string, unknown>;
}
