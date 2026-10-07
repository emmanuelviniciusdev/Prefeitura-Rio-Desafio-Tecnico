import { describe, expect, it } from 'vitest'
import { SESSION_STORAGE_KEY } from '../config'
import { createTestJwt, createTestSession, PASSENGER_USER_ID } from '../test/fixtures'
import {
  clearSession,
  decodeJwtClaims,
  readSession,
  sessionFromTokenResponse,
  writeSession,
} from './session'

describe('session', () => {
  it('decodes actor and user id from a JWT payload', () => {
    expect(decodeJwtClaims(createTestJwt('passageiro'))).toEqual({
      actor: 'passageiro',
      userId: PASSENGER_USER_ID,
    })
  })

  it('rejects a malformed token', () => {
    expect(() => decodeJwtClaims('not-a-jwt')).toThrow('Invalid access token')
  })

  it('builds, persists and restores a session', () => {
    const session = sessionFromTokenResponse({
      accessToken: createTestJwt('motorista'),
      tokenType: 'Bearer',
      expiresIn: 3600,
    })

    writeSession(session)

    expect(readSession()).toEqual(session)
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain('motorista')

    clearSession()
    expect(readSession()).toBeNull()
  })

  it('ignores invalid stored JSON', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, '{')
    expect(readSession()).toBeNull()
  })

  it('ignores stored objects that are not sessions', () => {
    writeSession(createTestSession('passageiro'))
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ accessToken: 'x' }))
    expect(readSession()).toBeNull()
  })
})
