import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import type { Actor } from '../auth/domain/actor';
import { RideCacheService } from './cache/ride-cache.service';
import {
  hashCreateRideRequest,
  normalizeCreateRide,
  type NormalizedCreateRide,
} from './domain/create-ride-request';
import { isDuplicateEntry } from './domain/duplicate-entry';
import { IdempotencyKeyRecord } from './domain/idempotency-key.entity';
import { Ride } from './domain/ride.entity';
import {
  isRideResponse,
  toRideResponse,
  type RideResponse,
} from './domain/ride-response';
import { RideStatus } from './domain/ride-status';
import { canTransition, isIdempotentAccept } from './domain/ride-status.policy';
import type { CreateRideDto } from './dto/create-ride.dto';
import type { UpdateRideStatusDto } from './dto/update-ride-status.dto';

const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
const TEXT_MAX_LENGTH = 255;

@Injectable()
export class RidesService {
  constructor(
    @InjectRepository(Ride)
    private readonly rides: Repository<Ride>,
    @InjectRepository(IdempotencyKeyRecord)
    private readonly idempotencyKeys: Repository<IdempotencyKeyRecord>,
    private readonly dataSource: DataSource,
    private readonly cache: RideCacheService,
  ) {}

  async create(
    dto: CreateRideDto,
    idempotencyKeyHeader: string | undefined,
    actor: Actor,
  ): Promise<RideResponse> {
    const idempotencyKey = requireIdempotencyKey(idempotencyKeyHeader);
    const request = normalizeCreateRide(dto);
    assertCreateRide(request);
    const requestHash = hashCreateRideRequest(request);

    const existing = await this.idempotencyKeys.findOne({
      where: { key: idempotencyKey },
    });
    if (existing) {
      return replay(existing, requestHash);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const rides = manager.getRepository(Ride);
        const keys = manager.getRepository(IdempotencyKeyRecord);
        const now = new Date();
        const ride = await rides.save(
          rides.create({
            id: randomUUID(),
            userId: request.userId,
            origin: request.localPartida,
            destination: request.localDestino,
            elapsedMinutes: request.tempoDecorridoMinutos,
            status: RideStatus.Accepted,
            createdAt: now,
            createdBy: actor,
            updatedAt: now,
            updatedBy: actor,
          }),
        );
        const response = toRideResponse(ride);
        await keys.save(
          keys.create({
            key: idempotencyKey,
            requestHash,
            resourceId: ride.id,
            responseBody: response,
            createdAt: now,
          }),
        );
        return response;
      });
    } catch (error) {
      if (!isDuplicateEntry(error)) {
        throw error;
      }

      const stored = await this.idempotencyKeys.findOne({
        where: { key: idempotencyKey },
      });
      if (!stored) {
        throw error;
      }

      return replay(stored, requestHash);
    }
  }

  async updateStatus(
    id: string,
    dto: UpdateRideStatusDto,
    actor: Actor,
  ): Promise<RideResponse> {
    const elapsedMinutes = resolveElapsedMinutes(dto);

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
      if (elapsedMinutes !== undefined) {
        ride.elapsedMinutes = elapsedMinutes;
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

  async findById(id: string): Promise<RideResponse> {
    const ride = await this.cache.readThrough(id, async () => {
      const entity = await this.rides.findOne({ where: { id } });
      return entity ? toRideResponse(entity) : null;
    });

    if (!ride) {
      throw new NotFoundException(`Ride ${id} was not found`);
    }

    return ride;
  }
}

function replay(
  record: IdempotencyKeyRecord,
  requestHash: string,
): RideResponse {
  if (!hashesMatch(record.requestHash, requestHash)) {
    throw new ConflictException(
      'Idempotency-Key was already used with a different request body',
    );
  }

  return parseStoredResponse(record.responseBody);
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? '';
  if (!key) {
    throw new BadRequestException('Idempotency-Key header is required');
  }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new BadRequestException(
      'Idempotency-Key must be at most 255 characters',
    );
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

  assertElapsedMinutes(request.tempoDecorridoMinutos);
}

function resolveElapsedMinutes(dto: UpdateRideStatusDto): number | undefined {
  if (dto.statusCorrida === RideStatus.Finished) {
    if (dto.tempoDecorridoMinutos === undefined) {
      throw new BadRequestException(
        'tempoDecorridoMinutos is required when finishing a ride',
      );
    }

    assertElapsedMinutes(dto.tempoDecorridoMinutos);
    return dto.tempoDecorridoMinutos;
  }

  if (dto.tempoDecorridoMinutos !== undefined) {
    throw new BadRequestException(
      'tempoDecorridoMinutos is only allowed when finishing a ride',
    );
  }

  return undefined;
}

function assertElapsedMinutes(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException(
      'tempoDecorridoMinutos must be a non-negative number',
    );
  }
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseStoredResponse(value: unknown): RideResponse {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!isRideResponse(parsed)) {
    throw new InternalServerErrorException(
      'Stored idempotent response is invalid',
    );
  }

  return parsed;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
