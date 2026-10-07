import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { RideCacheService } from './cache/ride-cache.service';
import { Ride } from './domain/ride.entity';
import { toRideResponse, type RideResponse } from './domain/ride-response';
import { RideStatus } from './domain/ride-status';
import type { CreateRideDto } from './dto/create-ride.dto';
import { RidesService } from './rides.service';

describe('RidesService', () => {
  const userId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const idempotencyKey = '0b6f9c3e-8a1d-4f5e-9c2a-1d2e3f4a5b6c';
  const dhInicio = '2026-10-07T18:00:00.000Z';
  const dto: CreateRideDto = {
    userId,
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
    dhInicio,
  };

  const rideRows = {
    create: jest.fn((entity: Ride) => entity),
    save: jest.fn((entity: Ride) => Promise.resolve(entity)),
    findOne: jest.fn<Promise<Ride | null>, [unknown]>(),
  };
  const ridesRepository = {
    create: jest.fn((entity: Partial<Ride>) => entity as Ride),
    insert: jest.fn((entity: Ride) =>
      Promise.resolve({ identifiers: [{ id: entity.id }] }),
    ),
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
    getRepository: (entity: unknown): typeof rideRows => {
      if (entity === Ride) {
        return rideRows;
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
        { provide: DataSource, useValue: dataSource },
        { provide: RideCacheService, useValue: cache },
      ],
    }).compile();

    service = moduleRef.get(RidesService);
    cache.invalidate.mockResolvedValue(undefined);
  });

  it('creates an accepted ride with the idempotency key and start time', async () => {
    const result = await service.create(
      {
        ...dto,
        localPartida: '  Copacabana  ',
        localDestino: ' Ipanema ',
      },
      `  ${idempotencyKey}  `,
      'passageiro',
    );

    expect(result.created).toBe(true);
    expect(result.ride).toMatchObject({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      idempotencyKey,
      dhInicio,
      dhFim: null,
      statusCorrida: RideStatus.Accepted,
      createdBy: 'passageiro',
      updatedBy: 'passageiro',
    });
    expect(result.ride.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns the existing ride when the idempotency key already exists', async () => {
    const stored = rideEntity(RideStatus.Accepted);
    ridesRepository.insert.mockRejectedValueOnce(
      duplicateEntry(idempotencyKey),
    );
    ridesRepository.findOne.mockResolvedValue(stored);

    const result = await service.create(dto, idempotencyKey, 'passageiro');

    expect(result).toEqual({
      created: false,
      ride: toRideResponse(stored),
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns the existing ride even when the body differs', async () => {
    const stored = rideEntity(RideStatus.Accepted);
    ridesRepository.insert.mockRejectedValueOnce(
      duplicateEntry(idempotencyKey),
    );
    ridesRepository.findOne.mockResolvedValue(stored);

    const result = await service.create(
      { ...dto, localDestino: 'Centro' },
      idempotencyKey,
      'passageiro',
    );

    expect(result.created).toBe(false);
    expect(result.ride.localDestino).toBe('Ipanema');
  });

  it('returns the winner when a concurrent insert hits the unique key', async () => {
    const stored = rideEntity(RideStatus.Accepted);
    ridesRepository.insert.mockRejectedValueOnce(
      duplicateEntry(idempotencyKey),
    );
    ridesRepository.findOne.mockResolvedValue(stored);

    await expect(
      service.create(dto, idempotencyKey, 'passageiro'),
    ).resolves.toEqual({
      created: false,
      ride: toRideResponse(stored),
    });
  });

  it('forbids a motorista from creating a ride', async () => {
    await expect(
      service.create(dto, idempotencyKey, 'motorista'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ridesRepository.insert).not.toHaveBeenCalled();
  });

  it('requires an Idempotency-Key UUID before touching storage', async () => {
    await expect(
      service.create(dto, '   ', 'passageiro'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(dto, 'not-a-uuid', 'passageiro'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ridesRepository.insert).not.toHaveBeenCalled();
  });

  it('rejects a blank localPartida', async () => {
    await expect(
      service.create(
        { ...dto, localPartida: '   ' },
        idempotencyKey,
        'passageiro',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirms accept without writing or invalidating the cache', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Accepted));

    const response = await service.updateStatus(
      rideId,
      { statusCorrida: RideStatus.Accepted },
      'motorista',
    );

    expect(response.statusCorrida).toBe(RideStatus.Accepted);
    expect(response.updatedBy).toBe('passageiro');
    expect(rideRows.save).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('initializes an accepted ride and invalidates the cache', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Accepted));

    const response = await service.updateStatus(
      rideId,
      { statusCorrida: RideStatus.Initialized },
      'motorista',
    );

    expect(response.statusCorrida).toBe(RideStatus.Initialized);
    expect(response.updatedBy).toBe('motorista');
    expect(response.dhFim).toBeNull();
    expect(cache.invalidate).toHaveBeenCalledWith(rideId);
  });

  it('forbids a passageiro from updating ride status', async () => {
    await expect(
      service.updateStatus(
        rideId,
        { statusCorrida: RideStatus.Initialized },
        'passageiro',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rideRows.findOne).not.toHaveBeenCalled();
  });

  it('rejects finishing a ride that has not started', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Accepted));

    await expect(
      service.updateStatus(
        rideId,
        { statusCorrida: RideStatus.Finished },
        'motorista',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('finishes an initialized ride and fills dhFim', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Initialized));

    const response = await service.updateStatus(
      rideId,
      { statusCorrida: RideStatus.Finished },
      'motorista',
    );

    expect(response).toMatchObject({
      statusCorrida: RideStatus.Finished,
      updatedBy: 'motorista',
    });
    expect(response.dhFim).toEqual(expect.any(String));
    expect(cache.invalidate).toHaveBeenCalledWith(rideId);
  });

  it('returns not found when the ride does not exist', async () => {
    rideRows.findOne.mockResolvedValue(null);

    await expect(
      service.updateStatus(
        rideId,
        { statusCorrida: RideStatus.Initialized },
        'motorista',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads through the cache and falls back to the repository', async () => {
    const entity = rideEntity(RideStatus.Accepted);
    ridesRepository.findOne.mockResolvedValue(entity);
    cache.readThrough.mockImplementation(async (_id, loader) => loader());

    const response = await service.findById(rideId, 'passageiro');

    expect(response.id).toBe(rideId);
    expect(response.localPartida).toBe('Copacabana');
  });

  it('returns the cached ride without querying when the cache hits', async () => {
    const cached = toRideResponse(rideEntity(RideStatus.Initialized));
    cache.readThrough.mockResolvedValue(cached);

    await expect(service.findById(rideId, 'passageiro')).resolves.toEqual(
      cached,
    );
    expect(ridesRepository.findOne).not.toHaveBeenCalled();
  });

  it('forbids a motorista from reading a ride', async () => {
    await expect(service.findById(rideId, 'motorista')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(cache.readThrough).not.toHaveBeenCalled();
  });

  it('forbids a passageiro from reading a ride created by another actor', async () => {
    const cached = toRideResponse(rideEntity(RideStatus.Accepted, 'motorista'));
    cache.readThrough.mockResolvedValue(cached);

    await expect(service.findById(rideId, 'passageiro')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns not found when the read-through misses', async () => {
    cache.readThrough.mockResolvedValue(null);

    await expect(service.findById(rideId, 'passageiro')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

const rideId = '11111111-1111-4111-8111-111111111111';

function rideEntity(
  status: RideStatus,
  createdBy: string = 'passageiro',
): Ride {
  const now = new Date('2026-10-07T18:00:00.000Z');
  const ride = new Ride();
  ride.id = rideId;
  ride.userId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  ride.origin = 'Copacabana';
  ride.destination = 'Ipanema';
  ride.idempotencyKey = '0b6f9c3e-8a1d-4f5e-9c2a-1d2e3f4a5b6c';
  ride.startedAt = now;
  ride.finishedAt =
    status === RideStatus.Finished
      ? new Date('2026-10-07T18:30:00.000Z')
      : null;
  ride.status = status;
  ride.createdAt = now;
  ride.createdBy = createdBy;
  ride.updatedAt = now;
  ride.updatedBy = createdBy;
  return ride;
}

function duplicateEntry(key: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error(`Duplicate entry '${key}' for key 'PRIMARY'`), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    }),
  );
}
