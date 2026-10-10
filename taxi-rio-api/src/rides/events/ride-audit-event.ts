import type { RideResponse } from '../domain/ride-response';
import { RideStatus } from '../domain/ride-status';

export const RIDE_CREATED_QUEUE = 'corrida.criada';
export const RIDE_STATUS_CHANGED_QUEUE = 'corrida.status_alterado';
export const RIDE_AUDIT_COLLECTION = 'corridas_audit';

const rideStatuses = new Set<string>(Object.values(RideStatus));

export interface RideAuditEvent {
  id_corrida: string;
  status_corrida: RideStatus;
  dh_inicio: string;
  dh_fim: string | null;
}

export interface RideAuditRecord {
  id_corrida: string;
  status_corrida: RideStatus;
  dh_inicio: Date;
  dh_fim: Date | null;
  computed_elapsed_time: number | null;
}

export function shouldPublishRideStatusChanged(status: RideStatus): boolean {
  return rideStatuses.has(status);
}

export function toRideAuditEvent(ride: RideResponse): RideAuditEvent {
  return {
    id_corrida: ride.id,
    status_corrida: ride.statusCorrida,
    dh_inicio: ride.dhInicio,
    dh_fim: ride.dhFim,
  };
}

export function parseRideAuditEvent(value: unknown): RideAuditEvent | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id_corrida !== 'string' || record.id_corrida.length === 0) {
    return null;
  }
  if (
    typeof record.status_corrida !== 'string' ||
    !rideStatuses.has(record.status_corrida)
  ) {
    return null;
  }
  if (!isIsoDate(record.dh_inicio)) {
    return null;
  }
  if (record.dh_fim !== null && !isIsoDate(record.dh_fim)) {
    return null;
  }

  return {
    id_corrida: record.id_corrida,
    status_corrida: record.status_corrida as RideStatus,
    dh_inicio: record.dh_inicio,
    dh_fim: record.dh_fim,
  };
}

export function toRideAuditRecord(event: RideAuditEvent): RideAuditRecord {
  return {
    id_corrida: event.id_corrida,
    status_corrida: event.status_corrida,
    dh_inicio: new Date(event.dh_inicio),
    dh_fim: event.dh_fim === null ? null : new Date(event.dh_fim),
    computed_elapsed_time: computeElapsedTimeMinutes(
      event.status_corrida,
      event.dh_inicio,
      event.dh_fim,
    ),
  };
}

export function computeElapsedTimeMinutes(
  status: RideStatus,
  startedAt: string,
  finishedAt: string | null,
): number | null {
  if (status !== RideStatus.Finished || finishedAt === null) {
    return null;
  }

  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished)) {
    throw new Error('Invalid date value');
  }

  return Math.max(0, (finished - started) / 60_000);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
