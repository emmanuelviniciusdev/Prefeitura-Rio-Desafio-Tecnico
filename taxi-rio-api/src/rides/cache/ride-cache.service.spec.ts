import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { RideResponse } from '../domain/ride-response';
import { RideStatus } from '../domain/ride-status';
import { RedisService } from '../../redis/redis.service';
import { RideCacheService, rideCacheKey } from './ride-cache.service';

describe('RideCacheService', () => {
  const ride = rideResponse();
  let cache: RideCacheService;
  let redis: {
    get: jest.Mock<Promise<string | null>, [string]>;
    set: jest.Mock<Promise<void>, [string, string, number]>;
    del: jest.Mock<Promise<void>, [string]>;
  };

  beforeEach(async () => {
    redis = {
      get: jest.fn<Promise<string | null>, [string]>(),
      set: jest.fn<Promise<void>, [string, string, number]>(),
      del: jest.fn<Promise<void>, [string]>(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RideCacheService,
        { provide: RedisService, useValue: redis },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(300),
          },
        },
      ],
    }).compile();

    cache = moduleRef.get(RideCacheService);
  });

  it('returns the cached ride without loading the database', async () => {
    redis.get.mockResolvedValue(JSON.stringify(ride));
    const loadFromDatabase = jest.fn<Promise<RideResponse | null>, []>();

    await expect(cache.readThrough(ride.id, loadFromDatabase)).resolves.toEqual(
      ride,
    );

    expect(loadFromDatabase).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('loads the database on a miss and stores the ride', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(undefined);
    const loadFromDatabase = jest
      .fn<Promise<RideResponse | null>, []>()
      .mockResolvedValue(ride);

    await expect(cache.readThrough(ride.id, loadFromDatabase)).resolves.toEqual(
      ride,
    );

    expect(redis.set).toHaveBeenCalledWith(
      rideCacheKey(ride.id),
      JSON.stringify(ride),
      300,
    );
  });

  it('does not cache a missing ride', async () => {
    redis.get.mockResolvedValue(null);
    const loadFromDatabase = jest
      .fn<Promise<RideResponse | null>, []>()
      .mockResolvedValue(null);

    await expect(
      cache.readThrough(ride.id, loadFromDatabase),
    ).resolves.toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falls back to the database when Redis read fails', async () => {
    redis.get.mockRejectedValue(new Error('connection refused'));
    redis.set.mockResolvedValue(undefined);
    const loadFromDatabase = jest
      .fn<Promise<RideResponse | null>, []>()
      .mockResolvedValue(ride);

    await expect(cache.readThrough(ride.id, loadFromDatabase)).resolves.toEqual(
      ride,
    );
    expect(loadFromDatabase).toHaveBeenCalledTimes(1);
  });

  it('falls back to the database when the cached payload is invalid', async () => {
    redis.get.mockResolvedValue('{');
    redis.del.mockResolvedValue(undefined);
    redis.set.mockResolvedValue(undefined);
    const loadFromDatabase = jest
      .fn<Promise<RideResponse | null>, []>()
      .mockResolvedValue(ride);

    await expect(cache.readThrough(ride.id, loadFromDatabase)).resolves.toEqual(
      ride,
    );
    expect(redis.del).toHaveBeenCalledWith(rideCacheKey(ride.id));
  });

  it('still returns the ride when the cache write fails', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockRejectedValue(new Error('readonly'));
    const loadFromDatabase = jest
      .fn<Promise<RideResponse | null>, []>()
      .mockResolvedValue(ride);

    await expect(cache.readThrough(ride.id, loadFromDatabase)).resolves.toEqual(
      ride,
    );
  });

  it('deletes the cache key on invalidate and swallows Redis errors', async () => {
    redis.del.mockResolvedValueOnce(undefined);
    await cache.invalidate(ride.id);
    expect(redis.del).toHaveBeenCalledWith(rideCacheKey(ride.id));

    redis.del.mockRejectedValueOnce(new Error('timeout'));
    await expect(cache.invalidate(ride.id)).resolves.toBeUndefined();
  });
});

function rideResponse(): RideResponse {
  return {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    userId: '6b9c3e18-0d4a-4e7b-9f21-2a6d5c8e1b34',
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
    tempoDecorridoMinutos: 0,
    statusCorrida: RideStatus.Accepted,
    createdAt: '2026-10-07T18:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-10-07T18:00:00.000Z',
    updatedBy: 'system',
  };
}
