import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { ACTOR_USER_IDS } from '../auth/domain/actor';
import type { Principal } from '../auth/domain/principal';
import { RideCacheService } from './cache/ride-cache.service';
import { Ride } from './domain/ride.entity';
import { toRideResponse, type RideResponse } from './domain/ride-response';
import { RideStatus } from './domain/ride-status';
import type { CreateRideDto } from './dto/create-ride.dto';
import { RidesService } from './rides.service';

describe('RidesService', () => {
  const userId = ACTOR_USER_IDS.passageiro;
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

  const pendingRideQuery = {
    where: { status: RideStatus.Requested },
    order: { createdAt: 'ASC' },
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

  it('creates a requested ride with the idempotency key and start time', async () => {
    const result = await service.create(
      {
        ...dto,
        localPartida: '  Copacabana  ',
        localDestino: ' Ipanema ',
      },
      `  ${idempotencyKey}  `,
      passageiro,
    );

    expect(result.created).toBe(true);
    expect(result.ride).toMatchObject({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      idempotencyKey,
      dhInicio,
      dhFim: null,
      statusCorrida: RideStatus.Requested,
      createdBy: 'passageiro',
      updatedBy: 'passageiro',
    });
    expect(result.ride.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns the existing ride when the idempotency key already exists', async () => {
    const stored = rideEntity(RideStatus.Requested);
    ridesRepository.insert.mockRejectedValueOnce(
      duplicateEntry(idempotencyKey),
    );
    ridesRepository.findOne.mockResolvedValue(stored);

    const result = await service.create(dto, idempotencyKey, passageiro);

    expect(result).toEqual({
      created: false,
      ride: toRideResponse(stored),
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns the existing ride even when the body differs', async () => {
    const stored = rideEntity(RideStatus.Requested);
    ridesRepository.insert.mockRejectedValueOnce(
      duplicateEntry(idempotencyKey),
    );
    ridesRepository.findOne.mockResolvedValue(stored);

    const result = await service.create(
      { ...dto, localDestino: 'Centro' },
      idempotencyKey,
      passageiro,
    );

    expect(result.created).toBe(false);
    expect(result.ride.localDestino).toBe('Ipanema');
  });

  it('returns the winner when a concurrent insert hits the unique key', async () => {
    const stored = rideEntity(RideStatus.Requested);
    ridesRepository.insert.mockRejectedValueOnce(
      duplicateEntry(idempotencyKey),
    );
    ridesRepository.findOne.mockResolvedValue(stored);

    await expect(
      service.create(dto, idempotencyKey, passageiro),
    ).resolves.toEqual({
      created: false,
      ride: toRideResponse(stored),
    });
  });

  it('forbids replaying an idempotency key owned by another user_id', async () => {
    const stored = rideEntity(RideStatus.Requested, ACTOR_USER_IDS.motorista);
    ridesRepository.insert.mockRejectedValueOnce(
      duplicateEntry(idempotencyKey),
    );
    ridesRepository.findOne.mockResolvedValue(stored);

    await expect(
      service.create(dto, idempotencyKey, passageiro),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a motorista from creating a ride', async () => {
    await expect(
      service.create(dto, idempotencyKey, motorista),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ridesRepository.insert).not.toHaveBeenCalled();
  });

  it('requires an Idempotency-Key UUID before touching storage', async () => {
    await expect(service.create(dto, '   ', passageiro)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create(dto, 'not-a-uuid', passageiro),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ridesRepository.insert).not.toHaveBeenCalled();
  });

  it('rejects a blank localPartida', async () => {
    await expect(
      service.create(
        { ...dto, localPartida: '   ' },
        idempotencyKey,
        passageiro,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirms requested status without writing or invalidating the cache', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Requested));

    const response = await service.updateStatus(
      rideId,
      { statusCorrida: RideStatus.Requested },
      'motorista',
    );

    expect(response.statusCorrida).toBe(RideStatus.Requested);
    expect(response.updatedBy).toBe('passageiro');
    expect(rideRows.save).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('initializes a requested ride and invalidates the cache', async () => {
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Requested));

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
    rideRows.findOne.mockResolvedValue(rideEntity(RideStatus.Requested));

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
    const entity = rideEntity(RideStatus.Requested);
    ridesRepository.findOne.mockResolvedValue(entity);
    cache.readThrough.mockImplementation(async (_id, loader) => loader());

    const response = await service.findById(rideId, passageiro);

    expect(response.id).toBe(rideId);
    expect(response.localPartida).toBe('Copacabana');
  });

  it('returns the cached ride without querying when the cache hits', async () => {
    const cached = toRideResponse(rideEntity(RideStatus.Initialized));
    cache.readThrough.mockResolvedValue(cached);

    await expect(service.findById(rideId, passageiro)).resolves.toEqual(cached);
    expect(ridesRepository.findOne).not.toHaveBeenCalled();
  });

  it('forbids a motorista from reading a ride', async () => {
    await expect(service.findById(rideId, motorista)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(cache.readThrough).not.toHaveBeenCalled();
  });

  it('forbids a passageiro from reading a ride owned by another user_id', async () => {
    const cached = toRideResponse(
      rideEntity(RideStatus.Requested, ACTOR_USER_IDS.motorista),
    );
    cache.readThrough.mockResolvedValue(cached);

    await expect(service.findById(rideId, passageiro)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids creating a ride for another user_id', async () => {
    await expect(
      service.create(
        { ...dto, userId: ACTOR_USER_IDS.motorista },
        idempotencyKey,
        passageiro,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ridesRepository.insert).not.toHaveBeenCalled();
  });

  it('returns not found when the read-through misses', async () => {
    cache.readThrough.mockResolvedValue(null);

    await expect(service.findById(rideId, passageiro)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the oldest requested ride for a motorista', async () => {
    const stored = rideEntity(RideStatus.Requested);
    ridesRepository.findOne.mockResolvedValue(stored);

    await expect(service.findFirstPending('motorista')).resolves.toEqual({
      corridaEncontrada: toRideResponse(stored),
    });
    expect(ridesRepository.findOne).toHaveBeenCalledWith(pendingRideQuery);
  });

  it('returns null when there is no pending ride', async () => {
    ridesRepository.findOne.mockResolvedValue(null);

    await expect(service.findFirstPending('motorista')).resolves.toEqual({
      corridaEncontrada: null,
    });
    expect(ridesRepository.findOne).toHaveBeenCalledWith(pendingRideQuery);
  });

  it('forbids a passageiro from reading the first pending ride', async () => {
    await expect(service.findFirstPending('passageiro')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ridesRepository.findOne).not.toHaveBeenCalled();
  });
});

const rideId = '11111111-1111-4111-8111-111111111111';
const passageiro: Principal = {
  actor: 'passageiro',
  userId: ACTOR_USER_IDS.passageiro,
};
const motorista: Principal = {
  actor: 'motorista',
  userId: ACTOR_USER_IDS.motorista,
};

function rideEntity(
  status: RideStatus,
  userId: string = ACTOR_USER_IDS.passageiro,
): Ride {
  const now = new Date('2026-10-07T18:00:00.000Z');
  const ride = new Ride();
  ride.id = rideId;
  ride.userId = userId;
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
  ride.createdBy = 'passageiro';
  ride.updatedAt = now;
  ride.updatedBy = 'passageiro';
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
