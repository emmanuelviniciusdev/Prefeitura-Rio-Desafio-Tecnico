import type { Actor, Ride, Session } from '../api/types'

export const PASSENGER_USER_ID = 'e1c6c6d8-08d2-46ce-a670-4be04e1be1cb'
export const DRIVER_USER_ID = '2bd66a43-5cdf-4e6a-8ad0-fbfa6b6bc6b0'

export function createTestJwt(
  actor: Actor,
  userId = actor === 'passageiro' ? PASSENGER_USER_ID : DRIVER_USER_ID,
): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')

  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    sub: actor,
    user_id: userId,
  })}.signature`
}

export function createTestSession(actor: Actor): Session {
  return {
    accessToken: createTestJwt(actor),
    tokenType: 'Bearer',
    expiresIn: 3600,
    actor,
    userId: actor === 'passageiro' ? PASSENGER_USER_ID : DRIVER_USER_ID,
  }
}

export function createTestRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: PASSENGER_USER_ID,
    localPartida: 'Copacabana, Rio de Janeiro',
    localDestino: 'Ipanema, Rio de Janeiro',
    idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    dhInicio: '2026-10-07T18:00:00.000Z',
    dhFim: null,
    statusCorrida: 'requested',
    createdAt: '2026-10-07T18:00:00.000Z',
    createdBy: 'passageiro',
    updatedAt: '2026-10-07T18:00:00.000Z',
    updatedBy: 'passageiro',
    ...overrides,
  }
}
