import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import type { Actor } from '../auth/domain/actor';
import type { Principal } from '../auth/domain/principal';
import { RideCacheService } from './cache/ride-cache.service';
import {
  normalizeCreateRide,
  type NormalizedCreateRide,
} from './domain/create-ride-request';
import { isDuplicateEntry } from './domain/duplicate-entry';
import {
  canCreateRide,
  canFindFirstPendingRide,
  canReadRide,
  canUpdateRideStatus,
} from './domain/ride-access.policy';
import { Ride } from './domain/ride.entity';
import {
  toRideResponse,
  type CreateRideResult,
  type FirstPendingRideResponse,
  type RideResponse,
} from './domain/ride-response';
import { RideStatus } from './domain/ride-status';
import { canTransition, isIdempotentAccept } from './domain/ride-status.policy';
import type { CreateRideDto } from './dto/create-ride.dto';
import type { UpdateRideStatusDto } from './dto/update-ride-status.dto';

const TEXT_MAX_LENGTH = 255;

@Injectable()
export class RidesService {
  constructor(
    @InjectRepository(Ride)
    private readonly rides: Repository<Ride>,
    private readonly dataSource: DataSource,
    private readonly cache: RideCacheService,
  ) {}

  async create(
    dto: CreateRideDto,
    idempotencyKeyHeader: string | undefined,
    principal: Principal,
  ): Promise<CreateRideResult> {
    const idempotencyKey = requireIdempotencyKey(idempotencyKeyHeader);
    const request = normalizeCreateRide(dto);
    assertCreateRide(request);
    if (!canCreateRide(principal, request.userId)) {
      throw new ForbiddenException(
        'Only a passageiro can create their own rides',
      );
    }

    const now = new Date();
    const ride = this.rides.create({
      id: randomUUID(),
      userId: request.userId,
      origin: request.localPartida,
      destination: request.localDestino,
      idempotencyKey,
      startedAt: request.startedAt,
      finishedAt: null,
      status: RideStatus.Accepted,
      createdAt: now,
      createdBy: principal.actor,
      updatedAt: now,
      updatedBy: principal.actor,
    });

    try {
      await this.rides.insert(ride);
      return { created: true, ride: toRideResponse(ride) };
    } catch (error) {
      if (!isDuplicateEntry(error)) {
        throw error;
      }

      const existing = await this.rides.findOne({
        where: { idempotencyKey },
      });
      if (!existing) {
        throw error;
      }
      if (!canReadRide(principal, existing.userId)) {
        throw new ForbiddenException(
          'Only a passageiro can access their own rides',
        );
      }

      return { created: false, ride: toRideResponse(existing) };
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateRideStatusDto,
    actor: Actor,
  ): Promise<RideResponse> {
    if (!canUpdateRideStatus(actor)) {
      throw new ForbiddenException('Only a motorista can update ride status');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const rides = manager.getRepository(Ride);
      const ride = await rides.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ride) {
        throw new NotFoundException(`Ride ${id} was not found`);
      }

      if (isIdempotentAccept(ride.status, dto.statusCorrida)) {
        return { response: toRideResponse(ride), changed: false };
      }

      if (!canTransition(ride.status, dto.statusCorrida)) {
        throw new ConflictException(
          `Cannot change ride status from ${ride.status} to ${dto.statusCorrida}`,
        );
      }

      ride.status = dto.statusCorrida;
      if (dto.statusCorrida === RideStatus.Finished) {
        ride.finishedAt = new Date();
      }
      ride.updatedAt = new Date();
      ride.updatedBy = actor;
      const saved = await rides.save(ride);
      return { response: toRideResponse(saved), changed: true };
    });

    if (result.changed) {
      await this.cache.invalidate(id);
    }

    return result.response;
  }

  async findFirstPending(actor: Actor): Promise<FirstPendingRideResponse> {
    if (!canFindFirstPendingRide(actor)) {
      throw new ForbiddenException(
        'Only a motorista can read the first pending ride',
      );
    }

    const ride = await this.rides.findOne({
      where: { status: RideStatus.Accepted },
      order: { createdAt: 'ASC' },
    });

    return {
      corridaEncontrada: ride ? toRideResponse(ride) : null,
    };
  }

  async findById(id: string, principal: Principal): Promise<RideResponse> {
    if (principal.actor !== 'passageiro') {
      throw new ForbiddenException(
        'Only a passageiro can read their own rides',
      );
    }

    const ride = await this.cache.readThrough(id, async () => {
      const entity = await this.rides.findOne({ where: { id } });
      return entity ? toRideResponse(entity) : null;
    });

    if (!ride) {
      throw new NotFoundException(`Ride ${id} was not found`);
    }
    if (!canReadRide(principal, ride.userId)) {
      throw new ForbiddenException(
        'Only a passageiro can read their own rides',
      );
    }

    return ride;
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? '';
  if (!key) {
    throw new BadRequestException('Idempotency-Key header is required');
  }
  if (!isUUID(key)) {
    throw new BadRequestException('Idempotency-Key must be a UUID');
  }

  return key;
}

function assertCreateRide(request: NormalizedCreateRide): void {
  if (!isUUID(request.userId)) {
    throw new BadRequestException('userId must be a UUID');
  }
  if (!request.localPartida || !request.localDestino) {
    throw new BadRequestException('localPartida and localDestino are required');
  }
  if (
    request.localPartida.length > TEXT_MAX_LENGTH ||
    request.localDestino.length > TEXT_MAX_LENGTH
  ) {
    throw new BadRequestException(
      'localPartida and localDestino must be at most 255 characters',
    );
  }
  if (Number.isNaN(request.startedAt.getTime())) {
    throw new BadRequestException('dhInicio must be a valid date-time');
  }
}
