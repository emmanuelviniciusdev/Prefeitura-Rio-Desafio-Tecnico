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
import type { Actor } from '../src/auth/domain/actor';
import { configureApp } from '../src/configure-app';
import { useExampleJwtEnv } from './jwt-env';
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
    passageiroToken = await issueToken('passageiro');
    motoristaToken = await issueToken('motorista');
  });

  beforeEach(async () => {
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
      'idempotency_key',
      'dh_inicio',
      'dh_fim',
      'status_corrida',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
    ]);

    const missingTables = await queryRows(
      dataSource,
      `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'idempotency_keys'`,
    );
    expect(missingTables).toEqual([]);

    await expect(insertRide({ status: 'pending' })).rejects.toThrow();
    await expect(
      insertRide({ status: RideStatus.Accepted, startedAt: null }),
    ).rejects.toThrow();

    const uniqueIndex = await queryRows(
      dataSource,
      `SELECT NON_UNIQUE AS total
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'corridas'
         AND INDEX_NAME = 'uk_corridas_idempotency_key'
         AND COLUMN_NAME = 'idempotency_key'`,
    );
    expect(readTotal(uniqueIndex[0])).toBe(0);

    const startColumn = await queryRows(
      dataSource,
      `SELECT IS_NULLABLE AS isNullable
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'corridas'
         AND COLUMN_NAME = 'dh_inicio'`,
    );
    expect(readFirstString(startColumn[0]).toUpperCase()).toBe('NO');

    const endColumn = await queryRows(
      dataSource,
      `SELECT IS_NULLABLE AS isNullable
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'corridas'
         AND COLUMN_NAME = 'dh_fim'`,
    );
    expect(readFirstString(endColumn[0]).toUpperCase()).toBe('YES');
  });

  it('issues a token for each actor and rejects anonymous ride access', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');

    const passageiro = await request(app.getHttpServer())
      .post('/auth/generate-token/passageiro')
      .expect(200);
    const motorista = await request(app.getHttpServer())
      .post('/auth/generate-token/motorista')
      .expect(200);

    expect(passageiro.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(motorista.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(readAccessToken(passageiro.body)).not.toEqual(
      readAccessToken(motorista.body),
    );

    await request(app.getHttpServer())
      .post('/corridas')
      .send(ridePayload())
      .expect(401);
    await request(app.getHttpServer())
      .get(`/corridas/${randomUUID()}`)
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);

    await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', `Bearer ${readAccessToken(motorista.body)}`)
      .set('Idempotency-Key', randomUUID())
      .send(ridePayload())
      .expect(403);
  });

  it('returns 403 when the token profile cannot perform the ride operation', async () => {
    const payload = ridePayload();
    const created = readRide(
      (
        await request(app.getHttpServer())
          .post('/corridas')
          .set('Authorization', authorization('passageiro'))
          .set('Idempotency-Key', randomUUID())
          .send(payload)
          .expect(201)
      ).body,
    );

    await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization('motorista'))
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/corridas/${created.id}`)
      .set('Authorization', authorization('motorista'))
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('passageiro'))
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(403);

    const ownRide = await request(app.getHttpServer())
      .get(`/corridas/${created.id}`)
      .set('Authorization', authorization('passageiro'))
      .expect(200);
    expect(readRide(ownRide.body).id).toBe(created.id);

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(200);
  });

  it('creates a ride and returns the existing one for the same Idempotency-Key', async () => {
    const payload = ridePayload();
    const key = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization('passageiro'))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    const ride = readRide(created.body);
    expect(ride).toMatchObject({
      userId: payload.userId,
      localPartida: 'São Conrado',
      localDestino: 'Centro',
      idempotencyKey: key,
      dhInicio: payload.dhInicio,
      dhFim: null,
      statusCorrida: RideStatus.Accepted,
      createdBy: 'passageiro',
      updatedBy: 'passageiro',
    });

    const replayed = await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization('passageiro'))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    expect(replayed.body).toEqual(created.body);
    expect(await countCorridas()).toBe(1);

    const stored = await storedRide(ride.id);
    expect(stored).toMatchObject({
      origin: 'São Conrado',
      status: RideStatus.Accepted,
      createdBy: 'passageiro',
      updatedBy: 'passageiro',
      finishedAt: null,
    });
  });

  it('returns the original ride when the same Idempotency-Key is reused with another body', async () => {
    const payload = ridePayload();
    const key = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization())
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    const replayed = await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization())
      .set('Idempotency-Key', key)
      .send({ ...payload, localDestino: 'Leblon' })
      .expect(200);

    expect(replayed.body).toEqual(created.body);
    expect(readRide(replayed.body).localDestino).toBe('Centro');
    expect(await countCorridas()).toBe(1);
  });

  it('requires Idempotency-Key and ignores unknown fields', async () => {
    const payload = ridePayload();
    await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization())
      .send(payload)
      .expect(400);
    await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization())
      .set('Idempotency-Key', 'not-a-uuid')
      .send(payload)
      .expect(400);
    await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization())
      .set('Idempotency-Key', randomUUID())
      .send({ ...payload, statusCorrida: RideStatus.Finished })
      .expect(400);
    expect(await countCorridas()).toBe(0);
  });

  it('creates one ride when the same key is submitted concurrently', async () => {
    const payload = ridePayload();
    const key = randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post('/corridas')
        .set('Authorization', authorization())
        .set('Idempotency-Key', key)
        .send(payload);

    const [first, second] = await Promise.all([send(), send()]);
    const statuses = [first.status, second.status].sort();

    expect(statuses).toEqual([200, 201]);
    expect(second.body).toEqual(first.body);
    expect(await countCorridas()).toBe(1);
  });

  it('accepts, starts and finishes a ride', async () => {
    const created = readRide(
      (
        await request(app.getHttpServer())
          .post('/corridas')
          .set('Authorization', authorization('passageiro'))
          .set('Idempotency-Key', randomUUID())
          .send(ridePayload())
          .expect(201)
      ).body,
    );
    expect(created.dhFim).toBeNull();

    const accepted = await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Accepted })
      .expect(200);
    expect(readRide(accepted.body)).toMatchObject({
      statusCorrida: RideStatus.Accepted,
      updatedBy: 'passageiro',
      dhFim: null,
    });

    const started = await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(200);
    expect(readRide(started.body)).toMatchObject({
      statusCorrida: RideStatus.Initialized,
      updatedBy: 'motorista',
      dhFim: null,
    });

    const finishedResponse = await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Finished })
      .expect(200);
    const finishedRide = readRide(finishedResponse.body);
    expect(finishedRide.statusCorrida).toBe(RideStatus.Finished);
    expect(finishedRide.dhFim).toEqual(expect.any(String));

    const finished = await storedRide(created.id);
    expect(finished).toMatchObject({
      status: RideStatus.Finished,
      createdBy: 'passageiro',
      updatedBy: 'motorista',
    });
    expect(finished.finishedAt).toEqual(expect.any(Date));

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(409);
  });

  it('rejects skipping from accepted to finished and unknown rides', async () => {
    const created = readRide(
      (
        await request(app.getHttpServer())
          .post('/corridas')
          .set('Authorization', authorization())
          .set('Idempotency-Key', randomUUID())
          .send(ridePayload())
          .expect(201)
      ).body,
    );

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Finished })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({
        statusCorrida: RideStatus.Initialized,
        tempoDecorridoMinutos: 5,
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/corridas/${randomUUID()}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(404);
    await request(app.getHttpServer())
      .get('/corridas/not-a-uuid')
      .set('Authorization', authorization())
      .expect(400);
    await request(app.getHttpServer())
      .get(`/corridas/${randomUUID()}`)
      .set('Authorization', authorization())
      .expect(404);
  });

  it('serves GET from Redis until a status change invalidates the cache', async () => {
    const createdResponse = await request(app.getHttpServer())
      .post('/corridas')
      .set('Authorization', authorization())
      .set('Idempotency-Key', randomUUID())
      .send(ridePayload({ localPartida: 'Copacabana' }))
      .expect(201);
    const created = readRide(createdResponse.body);

    expect(await redis.get(rideCacheKey(created.id))).toBeNull();

    const firstGet = await request(app.getHttpServer())
      .get(`/corridas/${created.id}`)
      .set('Authorization', authorization())
      .expect(200);
    expect(firstGet.body).toEqual(createdResponse.body);
    expect(await redis.get(rideCacheKey(created.id))).toContain('Copacabana');

    await dataSource.query(
      'UPDATE corridas SET local_partida = ? WHERE id = ?',
      ['Botafogo', created.id],
    );

    const cachedGet = await request(app.getHttpServer())
      .get(`/corridas/${created.id}`)
      .set('Authorization', authorization())
      .expect(200);
    expect(readRide(cachedGet.body).localPartida).toBe('Copacabana');

    await request(app.getHttpServer())
      .patch(`/corridas/${created.id}/status`)
      .set('Authorization', authorization('motorista'))
      .send({ statusCorrida: RideStatus.Initialized })
      .expect(200);

    const refreshed = readRide(
      (
        await request(app.getHttpServer())
          .get(`/corridas/${created.id}`)
          .set('Authorization', authorization())
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
      .set('Authorization', authorization())
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
    expect(paths['/auth/generate-token/passageiro']).toBeDefined();
    expect(paths['/auth/generate-token/motorista']).toBeDefined();

    const document = JSON.stringify(response.body);
    expect(document).toContain('Idempotency-Key');
    expect(document).not.toContain('X-Actor');
    expect(document).toContain('Cria uma corrida');
    expect(document).toContain('Aceita, inicia ou finaliza uma corrida');
    expect(document).toContain(
      'Perfil do token sem permissão para esta operação.',
    );
    expect(document).toContain('Redis');

    expect(
      openApiProperty(response.body, 'CreateRideDto', 'dhInicio'),
    ).toMatchObject({ type: 'string', format: 'date-time' });
    expect(
      openApiProperty(response.body, 'RideResponseDto', 'dhInicio'),
    ).toMatchObject({ type: 'string', format: 'date-time' });
    expect(
      openApiProperty(response.body, 'RideResponseDto', 'dhFim'),
    ).toMatchObject({ format: 'date-time', nullable: true });
    expect(
      openApiProperty(response.body, 'RideResponseDto', 'idempotencyKey'),
    ).toMatchObject({ type: 'string', format: 'uuid' });
    expect(
      (openApiSchema(response.body, 'UpdateRideStatusDto').properties ?? {})
        .tempoDecorridoMinutos,
    ).toBeUndefined();
  });

  async function insertRide(values: {
    status: string;
    startedAt?: string | null;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO corridas (
        id, user_id, local_partida, local_destino, idempotency_key, dh_inicio, dh_fim,
        status_corrida, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, 'A', 'B', ?, ?, NULL, ?, UTC_TIMESTAMP(3), 'test', UTC_TIMESTAMP(3), 'test')`,
      [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        values.startedAt === undefined
          ? '2026-10-07 18:00:00.000'
          : values.startedAt,
        values.status,
      ],
    );
  }

  async function storedRide(id: string): Promise<{
    origin: string;
    status: string;
    createdBy: string;
    updatedBy: string;
    finishedAt: Date | null;
  }> {
    const rows = await queryRows(
      dataSource,
      `SELECT local_partida AS origin, status_corrida AS status,
              created_by AS createdBy, updated_by AS updatedBy, dh_fim AS finishedAt
       FROM corridas WHERE id = ?`,
      [id],
    );
    return parseStoredRide(rows[0]);
  }

  function authorization(actor: Actor = 'passageiro'): string {
    const token = actor === 'passageiro' ? passageiroToken : motoristaToken;
    return `Bearer ${token}`;
  }

  async function issueToken(actor: Actor): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/auth/generate-token/${actor}`)
      .expect(200);
    return readAccessToken(response.body);
  }

  async function countCorridas(): Promise<number> {
    const rows = await queryRows(
      dataSource,
      'SELECT COUNT(*) AS total FROM corridas',
    );
    return readTotal(rows[0]);
  }
});

function ridePayload(overrides?: {
  localPartida?: string;
  localDestino?: string;
  dhInicio?: string;
}): {
  userId: string;
  localPartida: string;
  localDestino: string;
  dhInicio: string;
} {
  return {
    userId: randomUUID(),
    localPartida: overrides?.localPartida ?? 'São Conrado',
    localDestino: overrides?.localDestino ?? 'Centro',
    dhInicio: overrides?.dhInicio ?? '2026-10-07T18:00:00.000Z',
  };
}

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
  createdBy: string;
  updatedBy: string;
  finishedAt: Date | null;
} {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Expected a stored ride');
  }

  const record = row as Record<string, unknown>;
  if (
    typeof record.origin !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.createdBy !== 'string' ||
    typeof record.updatedBy !== 'string'
  ) {
    throw new Error('Stored ride row is incomplete');
  }

  return {
    origin: record.origin,
    status: record.status,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    finishedAt: parseOptionalDate(record.finishedAt),
  };
}

function parseOptionalDate(value: unknown): Date | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  throw new Error('Unexpected finishedAt value');
}

function openApiSchema(
  document: unknown,
  schemaName: string,
): { properties?: Record<string, unknown> } {
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

  return schema;
}

function openApiProperty(
  document: unknown,
  schemaName: string,
  propertyName: string,
): Record<string, unknown> {
  const properties = openApiSchema(document, schemaName).properties;
  if (typeof properties !== 'object' || properties === null) {
    throw new Error(`Schema ${schemaName} has no properties`);
  }

  const property = properties[propertyName];
  if (typeof property !== 'object' || property === null) {
    throw new Error(`Property ${propertyName} was not found on ${schemaName}`);
  }

  return property;
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
