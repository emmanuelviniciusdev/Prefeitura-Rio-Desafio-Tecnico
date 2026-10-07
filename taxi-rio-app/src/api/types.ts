export const ACTORS = ['passageiro', 'motorista'] as const

export type Actor = (typeof ACTORS)[number]

export const RIDE_STATUSES = ['requested', 'initialized', 'finished'] as const

export type RideStatus = (typeof RIDE_STATUSES)[number]

export interface AccessTokenResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export interface Session {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  actor: Actor
  userId: string
}

export interface Ride {
  id: string
  userId: string
  localPartida: string
  localDestino: string
  idempotencyKey: string
  dhInicio: string
  dhFim: string | null
  statusCorrida: RideStatus
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface FirstPendingRideResponse {
  corridaEncontrada: Ride | null
}
