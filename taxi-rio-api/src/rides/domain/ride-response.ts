import { RideStatus } from './ride-status';

export interface RideResponse {
  id: string;
  userId: string;
  localPartida: string;
  localDestino: string;
  tempoDecorridoMinutos: number;
  statusCorrida: RideStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
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
    typeof record.tempoDecorridoMinutos === 'number' &&
    Number.isFinite(record.tempoDecorridoMinutos) &&
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
  elapsedMinutes: number;
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
    tempoDecorridoMinutos: ride.elapsedMinutes,
    statusCorrida: ride.status,
    createdAt: toIso(ride.createdAt),
    createdBy: ride.createdBy,
    updatedAt: toIso(ride.updatedAt),
    updatedBy: ride.updatedBy,
  };
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }

  return date.toISOString();
}
