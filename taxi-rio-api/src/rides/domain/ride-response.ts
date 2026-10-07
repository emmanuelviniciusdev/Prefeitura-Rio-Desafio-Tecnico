import { RideStatus } from './ride-status';

export interface RideResponse {
  id: string;
  userId: string;
  localPartida: string;
  localDestino: string;
  idempotencyKey: string;
  dhInicio: string;
  dhFim: string | null;
  statusCorrida: RideStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CreateRideResult {
  created: boolean;
  ride: RideResponse;
}

const rideStatuses = new Set<string>(Object.values(RideStatus));

export function isRideResponse(value: unknown): value is RideResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.localPartida === 'string' &&
    typeof record.localDestino === 'string' &&
    typeof record.idempotencyKey === 'string' &&
    typeof record.dhInicio === 'string' &&
    isIsoDateOrNull(record.dhFim) &&
    typeof record.statusCorrida === 'string' &&
    rideStatuses.has(record.statusCorrida) &&
    typeof record.createdAt === 'string' &&
    typeof record.createdBy === 'string' &&
    typeof record.updatedAt === 'string' &&
    typeof record.updatedBy === 'string'
  );
}

export function toRideResponse(ride: {
  id: string;
  userId: string;
  origin: string;
  destination: string;
  idempotencyKey: string;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  status: RideStatus;
  createdAt: Date | string;
  createdBy: string;
  updatedAt: Date | string;
  updatedBy: string;
}): RideResponse {
  return {
    id: ride.id,
    userId: ride.userId,
    localPartida: ride.origin,
    localDestino: ride.destination,
    idempotencyKey: ride.idempotencyKey,
    dhInicio: toIso(ride.startedAt),
    dhFim: toIsoOrNull(ride.finishedAt),
    statusCorrida: ride.status,
    createdAt: toIso(ride.createdAt),
    createdBy: ride.createdBy,
    updatedAt: toIso(ride.updatedAt),
    updatedBy: ride.updatedBy,
  };
}

function isIsoDateOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toIso(value);
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }

  return date.toISOString();
}
