import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, isAbortError } from './http'

describe('apiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends JSON, authorization and idempotency headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      apiRequest('/corridas', {
        method: 'POST',
        token: 'token-1',
        idempotencyKey: 'key-1',
        body: JSON.stringify({ localPartida: 'Copacabana' }),
      }),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/corridas',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ localPartida: 'Copacabana' }),
      }),
    )
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-1')
    expect(headers.get('Idempotency-Key')).toBe('key-1')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('throws ApiError with the API message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Only a passageiro can create their own rides' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(apiRequest('/corridas')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      message: 'Only a passageiro can create their own rides',
    } satisfies Partial<ApiError>)
  })
})

describe('isAbortError', () => {
  it('detects abort errors', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
  })
})
