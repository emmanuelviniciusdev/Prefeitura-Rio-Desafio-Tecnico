import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { COPY } from './copy'
import { createTestJwt, createTestSession } from './test/fixtures'
import { writeSession } from './api/session'

vi.mock('./api/auth-api', () => ({
  requestAccessToken: vi.fn(async (actor: 'passageiro' | 'motorista') => ({
    accessToken: createTestJwt(actor),
    tokenType: 'Bearer',
    expiresIn: 3600,
  })),
}))

vi.mock('./api/rides-api', () => ({
  createRide: vi.fn(),
  getRideById: vi.fn(),
  getFirstPendingRide: vi.fn(async () => ({ corridaEncontrada: null })),
  updateRideStatus: vi.fn(),
}))

describe('App', () => {
  it('renders the login screen by default', () => {
    render(<App />)

    expect(
      screen.getByRole('button', { name: COPY.loginPassenger }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: COPY.loginDriver }),
    ).toBeInTheDocument()
  })

  it('opens the passenger ride screen from a stored session', () => {
    writeSession(createTestSession('passageiro'))

    render(<App />)

    expect(screen.getByLabelText(COPY.origin)).toHaveValue(COPY.defaultOrigin)
    expect(screen.getByRole('button', { name: COPY.logout })).toBeInTheDocument()
  })

  it('logs out after confirmation', async () => {
    const user = userEvent.setup()
    writeSession(createTestSession('motorista'))

    render(<App />)
    await user.click(screen.getByRole('button', { name: COPY.logout }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(
      screen.getByRole('button', { name: COPY.loginPassenger }),
    ).toBeInTheDocument()
  })
})
