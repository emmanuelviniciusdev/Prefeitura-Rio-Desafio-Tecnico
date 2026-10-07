export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { token?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const { token, idempotencyKey, headers: initHeaders, ...rest } = init
  const headers = new Headers(initHeaders)
  headers.set('Accept', 'application/json')
  if (rest.body !== undefined && rest.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey)
  }

  const response = await fetch(path, { ...rest, headers })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response))
  }

  return (await response.json()) as T
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with status ${response.status}`
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: unknown }).message
      if (typeof message === 'string' && message.length > 0) {
        return message
      }
      if (Array.isArray(message) && typeof message[0] === 'string') {
        return message[0]
      }
    }
  } catch {
    return fallback
  }

  return fallback
}
