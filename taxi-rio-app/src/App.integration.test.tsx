import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import App from './App'
import { COPY } from './copy'
import {
  createTestJwt,
  createTestRide,
  DRIVER_USER_ID,
  PASSENGER_USER_ID,
} from './test/fixtures'

const ride = createTestRide()
let rideStatus: 'requested' | 'initialized' | 'finished' = 'requested'
let pendingRide: typeof ride | null = null

const server = setupServer(
  http.post('*/auth/generate-token/passageiro', () => {
    return HttpResponse.json({
      accessToken: createTestJwt('passageiro'),
      tokenType: 'Bearer',
      expiresIn: 3600,
    })
  }),
  http.post('*/auth/generate-token/motorista', () => {
    return HttpResponse.json({
      accessToken: createTestJwt('motorista'),
      tokenType: 'Bearer',
      expiresIn: 3600,
    })
  }),
  http.post('*/corridas', async ({ request }) => {
    const body = (await request.json()) as {
      userId: string
      localPartida: string
      localDestino: string
    }
    rideStatus = 'requested'
    pendingRide = {
      ...ride,
      userId: body.userId,
      localPartida: body.localPartida,
      localDestino: body.localDestino,
      statusCorrida: 'requested',
    }
    return HttpResponse.json(pendingRide, { status: 201 })
  }),
  http.get('*/corridas/match-polling', () => {
    return HttpResponse.json({
      corridaEncontrada:
        pendingRide && rideStatus === 'requested' ? pendingRide : null,
    })
  }),
  http.get('*/corridas/:id', () => {
    return HttpResponse.json({
      ...(pendingRide ?? ride),
      statusCorrida: rideStatus,
      dhFim: rideStatus === 'finished' ? '2026-10-07T18:20:00.000Z' : null,
    })
  }),
  http.patch('*/corridas/:id/status', async ({ request }) => {
    const body = (await request.json()) as { statusCorrida: typeof rideStatus }
    rideStatus = body.statusCorrida
    pendingRide = pendingRide
      ? { ...pendingRide, statusCorrida: rideStatus }
      : pendingRide
    return HttpResponse.json({
      ...(pendingRide ?? ride),
      statusCorrida: rideStatus,
    })
  }),
)

describe('App integration', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
  })

  afterEach(() => {
    server.resetHandlers()
    rideStatus = 'requested'
    pendingRide = null
  })

  afterAll(() => {
    server.close()
  })

  it('lets a passenger request a ride and follow it until arrival', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: COPY.loginPassenger }))
    await user.clear(screen.getByLabelText(COPY.destination))
    await user.type(screen.getByLabelText(COPY.destination), 'Ipanema')
    await user.click(screen.getByRole('button', { name: COPY.requestRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(await screen.findByText(COPY.requesting)).toBeInTheDocument()
    expect(pendingRide?.userId).toBe(PASSENGER_USER_ID)

    rideStatus = 'initialized'
    expect(await screen.findByText(COPY.accepted)).toBeInTheDocument()

    rideStatus = 'finished'
    expect(await screen.findByText(COPY.arrived)).toBeInTheDocument()
    expect(screen.getByLabelText(COPY.origin)).toHaveValue(COPY.defaultOrigin)
    expect(screen.getByRole('button', { name: COPY.requestRide })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: COPY.closeFeedback }))
    expect(screen.queryByText(COPY.arrived)).not.toBeInTheDocument()
  })

  it('lets a driver accept and finish a matched ride', async () => {
    const user = userEvent.setup()
    pendingRide = ride
    render(<App />)

    await user.click(screen.getByRole('button', { name: COPY.loginDriver }))
    expect(await screen.findByText(COPY.found)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: COPY.acceptRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(await screen.findByText(COPY.driving)).toBeInTheDocument()
    expect(rideStatus).toBe('initialized')

    await user.click(screen.getByRole('button', { name: COPY.finishRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(await screen.findByText(COPY.waiting)).toBeInTheDocument()
    expect(rideStatus).toBe('finished')
  })

  it('lets a driver decline a ride and keep waiting', async () => {
    const user = userEvent.setup()
    pendingRide = ride
    render(<App />)

    await user.click(screen.getByRole('button', { name: COPY.loginDriver }))
    expect(await screen.findByText(COPY.found)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: COPY.declineRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(await screen.findByText(COPY.waiting)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(COPY.found)).not.toBeInTheDocument()
    })
    expect(rideStatus).toBe('requested')
  })

  it('issues a motorista token for the driver login', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: COPY.loginDriver }))
    expect(await screen.findByText(COPY.waiting)).toBeInTheDocument()
    expect(screen.getByText(COPY.driver)).toBeInTheDocument()
    expect(DRIVER_USER_ID).toHaveLength(36)
  })
})
