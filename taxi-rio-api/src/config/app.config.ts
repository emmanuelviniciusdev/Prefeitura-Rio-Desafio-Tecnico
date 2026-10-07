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

export interface AppConfig {
  mysql: MysqlConfig;
  redis: RedisConfig;
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
  rideCacheTtlSeconds: readPositiveInteger(
    process.env.RIDE_CACHE_TTL_SECONDS,
    300,
  ),
}));

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
