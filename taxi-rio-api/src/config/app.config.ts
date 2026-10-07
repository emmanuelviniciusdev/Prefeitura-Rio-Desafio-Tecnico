import { registerAs } from '@nestjs/config';

export interface MysqlConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface JwtConfig {
  privateKey: string;
  expiresInSeconds: number;
}

export interface AppConfig {
  mysql: MysqlConfig;
  redis: RedisConfig;
  jwt: JwtConfig;
  rideCacheTtlSeconds: number;
}

function readInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `Expected an integer environment value but received "${value}"`,
    );
  }

  return parsed;
}

function readPort(value: string | undefined, fallback: number): number {
  const port = readInteger(value, fallback);
  if (port <= 0 || port > 65535) {
    throw new Error(`Port out of range: ${port}`);
  }

  return port;
}

export const appConfig = registerAs('app', (): AppConfig => ({
  mysql: {
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: readPort(process.env.MYSQL_PORT, 3306),
    username: process.env.MYSQL_USER ?? 'admin',
    password: process.env.MYSQL_PASSWORD ?? 'admin',
    database: process.env.MYSQL_DATABASE ?? 'taxi_rio',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: readPort(process.env.REDIS_PORT, 6379),
  },
  jwt: {
    privateKey: normalizePrivateKeyPem(process.env.JWT_PRIVATE_KEY),
    expiresInSeconds: readPositiveInteger(
      process.env.JWT_EXPIRES_IN_SECONDS,
      3600,
    ),
  },
  rideCacheTtlSeconds: readPositiveInteger(
    process.env.RIDE_CACHE_TTL_SECONDS,
    300,
  ),
}));

export function normalizePrivateKeyPem(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('JWT_PRIVATE_KEY is required');
  }

  let pem = value.trim();
  if (
    (pem.startsWith('"') && pem.endsWith('"')) ||
    (pem.startsWith("'") && pem.endsWith("'"))
  ) {
    pem = pem.slice(1, -1);
  }

  pem = pem
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('JWT_PRIVATE_KEY must be a PKCS#8 PEM private key');
  }
  if (!pem.endsWith('\n')) {
    pem = `${pem}\n`;
  }

  return pem;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = readInteger(value, fallback);
  if (parsed <= 0) {
    throw new Error(`Expected a positive integer but received ${parsed}`);
  }

  return parsed;
}
