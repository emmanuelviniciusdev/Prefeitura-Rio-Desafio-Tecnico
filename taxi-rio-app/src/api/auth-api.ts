import { apiRequest } from './http'
import type { AccessTokenResponse, Actor } from './types'

export function requestAccessToken(actor: Actor): Promise<AccessTokenResponse> {
  return apiRequest<AccessTokenResponse>(`/auth/generate-token/${actor}`, {
    method: 'POST',
  })
}
