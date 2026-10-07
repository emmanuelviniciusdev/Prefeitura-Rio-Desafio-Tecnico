import { SESSION_STORAGE_KEY } from '../config'
import { ACTORS, type Actor, type AccessTokenResponse, type Session } from './types'

export function readSession(): Session | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeSession(session: Session): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY)
}

export function sessionFromTokenResponse(
  response: AccessTokenResponse,
): Session {
  const claims = decodeJwtClaims(response.accessToken)
  return {
    accessToken: response.accessToken,
    tokenType: response.tokenType,
    expiresIn: response.expiresIn,
    actor: claims.actor,
    userId: claims.userId,
  }
}

export function decodeJwtClaims(token: string): {
  actor: Actor
  userId: string
} {
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) {
    throw new Error('Invalid access token')
  }

  const payload: unknown = JSON.parse(decodeBase64Url(parts[1]))
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid access token')
  }

  const record = payload as Record<string, unknown>
  if (!isActor(record.sub) || typeof record.user_id !== 'string') {
    throw new Error('Invalid access token')
  }

  return { actor: record.sub, userId: record.user_id }
}

function isActor(value: unknown): value is Actor {
  return ACTORS.some((actor) => actor === value)
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.accessToken === 'string' &&
    record.tokenType === 'Bearer' &&
    typeof record.expiresIn === 'number' &&
    isActor(record.actor) &&
    typeof record.userId === 'string'
  )
}

function decodeBase64Url(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const padLength = (4 - (padded.length % 4)) % 4
  return atob(`${padded}${'='.repeat(padLength)}`)
}
