import { ACTOR_USER_IDS } from '../../auth/domain/actor';
import type { RideResponse } from '../domain/ride-response';
import { RideStatus } from '../domain/ride-status';
import {
  computeElapsedTimeMinutes,
  parseRideAuditEvent,
  shouldPublishRideStatusChanged,
  toRideAuditEvent,
  toRideAuditRecord,
} from './ride-audit-event';

describe('ride audit event', () => {
  const ride = rideResponse();

  it('maps a ride response onto the audit payload', () => {
    expect(toRideAuditEvent(ride)).toEqual({
      id_corrida: ride.id,
      status_corrida: RideStatus.Requested,
      dh_inicio: ride.dhInicio,
      dh_fim: null,
    });
  });

  it('publishes status changes for every ride status', () => {
    expect(shouldPublishRideStatusChanged(RideStatus.Requested)).toBe(true);
    expect(shouldPublishRideStatusChanged(RideStatus.Initialized)).toBe(true);
    expect(shouldPublishRideStatusChanged(RideStatus.Finished)).toBe(true);
  });

  it('parses a valid payload and rejects incomplete ones', () => {
    const event = toRideAuditEvent(ride);
    expect(parseRideAuditEvent(event)).toEqual(event);
    expect(parseRideAuditEvent(null)).toBeNull();
    expect(
      parseRideAuditEvent({ ...event, status_corrida: 'pending' }),
    ).toBeNull();
    expect(
      parseRideAuditEvent({ ...event, dh_inicio: 'not-a-date' }),
    ).toBeNull();
  });

  it('computes elapsed time only when the ride has finished', () => {
    expect(
      computeElapsedTimeMinutes(
        RideStatus.Finished,
        '2026-10-07T18:00:00.000Z',
        '2026-10-07T18:30:00.000Z',
      ),
    ).toBe(30);
    expect(
      computeElapsedTimeMinutes(
        RideStatus.Requested,
        '2026-10-07T18:00:00.000Z',
        '2026-10-07T18:30:00.000Z',
      ),
    ).toBeNull();
    expect(
      computeElapsedTimeMinutes(
        RideStatus.Finished,
        '2026-10-07T18:00:00.000Z',
        null,
      ),
    ).toBeNull();
  });

  it('builds a MongoDB record with computed elapsed time', () => {
    const finished = toRideAuditEvent({
      ...ride,
      statusCorrida: RideStatus.Finished,
      dhFim: '2026-10-07T18:30:00.000Z',
    });

    expect(toRideAuditRecord(finished)).toEqual({
      id_corrida: ride.id,
      status_corrida: RideStatus.Finished,
      dh_inicio: new Date(ride.dhInicio),
      dh_fim: new Date('2026-10-07T18:30:00.000Z'),
      computed_elapsed_time: 30,
    });
    expect(
      toRideAuditRecord(toRideAuditEvent(ride)).computed_elapsed_time,
    ).toBeNull();
  });
});

function rideResponse(): RideResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: ACTOR_USER_IDS.passageiro,
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
    idempotencyKey: '0b6f9c3e-8a1d-4f5e-9c2a-1d2e3f4a5b6c',
    dhInicio: '2026-10-07T18:00:00.000Z',
    dhFim: null,
    statusCorrida: RideStatus.Requested,
    createdAt: '2026-10-07T18:00:00.000Z',
    createdBy: 'passageiro',
    updatedAt: '2026-10-07T18:00:00.000Z',
    updatedBy: 'passageiro',
  };
}
