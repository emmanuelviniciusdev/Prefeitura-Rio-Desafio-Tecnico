import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isRideResponse, type RideResponse } from '../domain/ride-response';
import { RedisService } from '../../redis/redis.service';

export function rideCacheKey(id: string): string {
  return `taxi-rio:rides:${id}`;
}

@Injectable()
export class RideCacheService {
  private readonly logger = new Logger(RideCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async readThrough(
    id: string,
    loadFromDatabase: () => Promise<RideResponse | null>,
  ): Promise<RideResponse | null> {
    const key = rideCacheKey(id);
    const cached = await this.read(key);
    if (cached) {
      const parsed = parseCachedRide(cached);
      if (parsed) {
        return parsed;
      }

      await this.invalidate(id);
    }

    const ride = await loadFromDatabase();
    if (!ride) {
      return null;
    }

    await this.write(key, ride);
    return ride;
  }

  async invalidate(id: string): Promise<void> {
    try {
      await this.redis.del(rideCacheKey(id));
    } catch (error) {
      this.logger.warn(
        `Cache delete failed for ride ${id}: ${errorMessage(error)}`,
      );
    }
  }

  private async read(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.warn(`Cache read failed for ${key}: ${errorMessage(error)}`);
      return null;
    }
  }

  private async write(key: string, ride: RideResponse): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(ride), this.ttlSeconds());
    } catch (error) {
      this.logger.warn(`Cache write failed for ${key}: ${errorMessage(error)}`);
    }
  }

  private ttlSeconds(): number {
    return this.config.getOrThrow<number>('app.rideCacheTtlSeconds');
  }
}

function parseCachedRide(raw: string): RideResponse | null {
  try {
    const parsed: unknown = JSON.parse(raw) as unknown;
    return isRideResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
