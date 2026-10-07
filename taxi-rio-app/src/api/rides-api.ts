import { apiRequest } from './http'
import type { FirstPendingRideResponse, Ride, RideStatus } from './types'

export function createRide(input: {
  token: string
  userId: string
  localPartida: string
  localDestino: string
  dhInicio: string
  idempotencyKey: string
}): Promise<Ride> {
  return apiRequest<Ride>('/corridas', {
    method: 'POST',
    token: input.token,
    idempotencyKey: input.idempotencyKey,
    body: JSON.stringify({
      userId: input.userId,
      localPartida: input.localPartida,
      localDestino: input.localDestino,
      dhInicio: input.dhInicio,
    }),
  })
}

export function getRideById(input: {
  token: string
  id: string
  signal?: AbortSignal
}): Promise<Ride> {
  return apiRequest<Ride>(`/corridas/${input.id}`, {
    method: 'GET',
    token: input.token,
    signal: input.signal,
  })
}

export function getFirstPendingRide(input: {
  token: string
  signal?: AbortSignal
}): Promise<FirstPendingRideResponse> {
  return apiRequest<FirstPendingRideResponse>('/corridas/match-polling', {
    method: 'GET',
    token: input.token,
    signal: input.signal,
  })
}

export function updateRideStatus(input: {
  token: string
  id: string
  statusCorrida: RideStatus
}): Promise<Ride> {
  return apiRequest<Ride>(`/corridas/${input.id}/status`, {
    method: 'PATCH',
    token: input.token,
    body: JSON.stringify({ statusCorrida: input.statusCorrida }),
  })
}
