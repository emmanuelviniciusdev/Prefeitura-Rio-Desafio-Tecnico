import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COPY } from '../copy'
import { createTestJwt, createTestSession } from '../test/fixtures'
import { LoginScreen } from './LoginScreen'

const requestAccessToken = vi.fn()

vi.mock('../api/auth-api', () => ({
  requestAccessToken: (...args: unknown[]) => requestAccessToken(...args),
}))

describe('LoginScreen', () => {
  beforeEach(() => {
    requestAccessToken.mockReset()
  })

  it('renders passenger and driver login actions', () => {
    render(<LoginScreen onLoggedIn={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: COPY.loginPassenger }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: COPY.loginDriver }),
    ).toBeInTheDocument()
  })

  it('logs in as passenger and persists the session', async () => {
    const user = userEvent.setup()
    const onLoggedIn = vi.fn()
    const session = createTestSession('passageiro')
    requestAccessToken.mockResolvedValue({
      accessToken: createTestJwt('passageiro'),
      tokenType: 'Bearer',
      expiresIn: 3600,
    })

    render(<LoginScreen onLoggedIn={onLoggedIn} />)
    await user.click(screen.getByRole('button', { name: COPY.loginPassenger }))

    expect(requestAccessToken).toHaveBeenCalledWith('passageiro')
    expect(onLoggedIn).toHaveBeenCalledWith(session)
    expect(JSON.parse(localStorage.getItem('taxi-rio.session') ?? '{}')).toMatchObject({
      actor: 'passageiro',
    })
  })

  it('shows an error when login fails', async () => {
    const user = userEvent.setup()
    requestAccessToken.mockRejectedValue(new Error('network'))

    render(<LoginScreen onLoggedIn={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: COPY.loginDriver }))

    expect(screen.getByRole('alert')).toHaveTextContent(COPY.loginError)
  })
})
