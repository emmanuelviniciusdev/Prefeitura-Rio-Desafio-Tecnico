import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { RideCacheService } from './cache/ride-cache.service';
import {
  hashCreateRideRequest,
  normalizeCreateRide,
} from './domain/create-ride-request';
import { IdempotencyKeyRecord } from './domain/idempotency-key.entity';
import { Ride } from './domain/ride.entity';
import { toRideResponse, type RideResponse } from './domain/ride-response';
import { RideStatus } from './domain/ride-status';
import type { CreateRideDto } from './dto/create-ride.dto';
import { RidesService } from './rides.service';

describe('RidesService', () => {
  const userId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const dto: CreateRideDto = {
    userId,
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
  };

  const rideRows = {
    create: jest.fn((entity: Ride) => entity),
    save: jest.fn((entity: Ride) => Promise.resolve(entity)),
    findOne: jest.fn<Promise<Ride | null>, [unknown]>(),
  };
  const keyRows = {
    create: jest.fn((entity: IdempotencyKeyRecord) => entity),
    save: jest.fn((entity: IdempotencyKeyRecord) => Promise.resolve(entity)),
  };
  const idempotencyRepository = {
    findOne: jest.fn<Promise<IdempotencyKeyRecord | null>, [unknown]>(),
  };
  const ridesRepository = {
    findOne: jest.fn<Promise<Ride | null>, [unknown]>(),
  };
  const cache = {
    readThrough: jest.fn<
      Promise<RideResponse | null>,
      [string, () => Promise<RideResponse | null>]
    >(),
    invalidate: jest.fn<Promise<void>, [string]>(),
  };
  const dataSource = {
    transaction: jest.fn(
      async <T>(work: (manager: EntityManager) => Promise<T>): Promise<T> => {
        return work(manager as unknown as EntityManager);
      },
    ),
  };

  const manager = {
    getRepository: (entity: unknown): typeof rideRows | typeof keyRows => {
      if (entity === Ride) {
        return rideRows;
      }
      if (entity === IdempotencyKeyRecord) {
        return keyRows;
      }
      throw new Error('Unexpected repository');
    },
  };

  let service: RidesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RidesService,
        { provide: getRepositoryToken(Ride), useValue: ridesRepository },
        {
          provide: getRepositoryToken(IdempotencyKeyRecord),
          useValue: idempotencyRepository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: RideCacheService, useValue: cache },
      ],
    }).compile();

    service = moduleRef.get(RidesService);
    idempotencyRepository.findOne.mockResolvedValue(null);
    cache.invalidate.mockResolvedValue(undefined);
  });

  it('creates an accepted ride and stores the idempotent response', async () => {
    const response = await service.create(
      {
        ...dto,
        localPartida: '  Copacabana  ',
        localDestino: ' Ipanema ',
      },
      '  key-1  ',
      '  ana  ',
    );

    expect(response).toMatchObject({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      tempoDecorridoMinutos: 0,
      statusCorrida: RideStatus.Accepted,
      createdBy: 'ana',
      updatedBy: 'ana',
    });
    expect(response.id).toMatch(/^[0-9a-f-]{36}$/i);

    const stored = keyRows.save.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      key: 'key-1',
      resourceId: response.id,
      requestHash: hashCreateRideRequest(
        normalizeCreateRide({
          userId,
          localPartida: 'Copacabana',
          localDestino: 'Ipanema',
        }),
      ),
      responseBody: response,
    });
  });

  it('uses system when X-Actor is omitted', async () => {
    const response = await service.create(dto, 'key-1', undefined);

    expect(response.createdBy).toBe('system');
    expect(response.updatedBy).toBe('system');
  });

  it('replays the original response for the same Idempotency-Key and body', async () => {
    const stored = idempotencyRecord(dto);
    idempotencyRepository.findOne.mockResolvedValue(stored);

    await expect(service.create(dto, 'key-1', 'someone-else')).resolves.toEqual(
      stored.responseBody,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects the same Idempotency-Key when the body differs', async () => {
    idempotencyRepository.findOne.mockResolvedValue(idempotencyRecord(dto));

    await expect(
      service.create({ ...dto, localDestino: 'Centro' }, 'key-1', undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('replays the winner when a concurrent insert hits the unique key', async () => {
    const stored = idempotencyRecord(dto);
    idempotencyRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored);
    dataSource.transaction.mockRejectedValueOnce(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error("Duplicate entry 'key-1' for key 'PRIMARY'"), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        }),
      ),
    );

    await expect(service.create(dto, 'key-1', 'ana')).resolves.toEqual(
      stored.responseBody,
    );
  });

  it('requires an Idempotency-Key before touching storage', async () => {
    await expect(service.create(dto, '   ', undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(idempotencyRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a blank localPartida', async () => {
    await expect(
      service.create({ ...dto, localPartida: '   ' }, 'key-1', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirms accept without writing or invalidating the cache', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Accepted));

    const response = await service.updateStatus(
      rideId,
      { statusCorrida: RideStatus.Accepted },
      'ana',
    );

    expect(response.statusCorrida).toBe(RideStatus.Accepted);
    expect(response.updatedBy).toBe('system');
    expect(rideRows.save).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('initializes an accepted ride and invalidates the cache', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Accepted));

    const response = await service.updateStatus(
      rideId,
      { statusCorrida: RideStatus.Initialized },
      'bruno',
    );

    expect(response.statusCorrida).toBe(RideStatus.Initialized);
    expect(response.updatedBy).toBe('bruno');
    expect(cache.invalidate).toHaveBeenCalledWith(rideId);
  });

  it('rejects finishing a ride that has not started', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Accepted));

    await expect(
      service.updateStatus(
        rideId,
        {
          statusCorrida: RideStatus.Finished,
          tempoDecorridoMinutos: 10,
        },
        'ana',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('finishes an initialized ride and stores the elapsed minutes', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Initialized));

    const response = await service.updateStatus(
      rideId,
      {
        statusCorrida: RideStatus.Finished,
        tempoDecorridoMinutos: 18,
      },
      'ana',
    );

    expect(response).toMatchObject({
      statusCorrida: RideStatus.Finished,
      tempoDecorridoMinutos: 18,
      updatedBy: 'ana',
    });
    expect(cache.invalidate).toHaveBeenCalledWith(rideId);
  });

  it('requires elapsed minutes only when finishing', async () => {
    await expect(
      service.updateStatus(
        rideId,
        { statusCorrida: RideStatus.Finished },
        'ana',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateStatus(
        rideId,
        {
          statusCorrida: RideStatus.Initialized,
          tempoDecorridoMinutos: 4,
        },
        'ana',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns not found when the ride does not exist', async () => {
    rideRows.findOne.mockResolvedValue(null);

    await expect(
      service.updateStatus(
        rideId,
        { statusCorrida: RideStatus.Initialized },
        'ana',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads through the cache and falls back to the repository', async () => {
    const entity = rideEntity(RideStatus.Accepted);
    ridesRepository.findOne.mockResolvedValue(entity);
    cache.readThrough.mockImplementation(async (_id, loader) => loader());

    const response = await service.findById(rideId);

    expect(response.id).toBe(rideId);
    expect(response.localPartida).toBe('Copacabana');
  });

  it('returns the cached ride without querying when the cache hits', async () => {
    const cached = toRideResponse(rideEntity(RideStatus.Initialized));
    cache.readThrough.mockResolvedValue(cached);

    await expect(service.findById(rideId)).resolves.toEqual(cached);
    expect(ridesRepository.findOne).not.toHaveBeenCalled();
  });

  it('returns not found when the read-through misses', async () => {
    cache.readThrough.mockResolvedValue(null);

    await expect(service.findById(rideId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

const rideId = '11111111-1111-4111-8111-111111111111';

function rideEntity(status: RideStatus): Ride {
  const now = new Date('2026-10-07T18:00:00.000Z');
  const ride = new Ride();
  ride.id = rideId;
  ride.userId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  ride.origin = 'Copacabana';
  ride.destination = 'Ipanema';
  ride.elapsedMinutes = status === RideStatus.Finished ? 18 : 0;
  ride.status = status;
  ride.createdAt = now;
  ride.createdBy = 'system';
  ride.updatedAt = now;
  ride.updatedBy = 'system';
  return ride;
}

function idempotencyRecord(dto: CreateRideDto): IdempotencyKeyRecord {
  const response = toRideResponse(rideEntity(RideStatus.Accepted));
  const record = new IdempotencyKeyRecord();
  record.key = 'key-1';
  record.requestHash = hashCreateRideRequest(normalizeCreateRide(dto));
  record.resourceId = response.id;
  record.responseBody = response;
  record.createdAt = new Date('2026-10-07T18:00:00.000Z');
  return record;
}
