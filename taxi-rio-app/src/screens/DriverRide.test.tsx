import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COPY } from '../copy'
import { createTestRide, createTestSession } from '../test/fixtures'
import { DriverRide } from './DriverRide'

const getFirstPendingRide = vi.fn()
const updateRideStatus = vi.fn()

vi.mock('../api/rides-api', () => ({
  getFirstPendingRide: (...args: unknown[]) => getFirstPendingRide(...args),
  updateRideStatus: (...args: unknown[]) => updateRideStatus(...args),
}))

describe('DriverRide', () => {
  const session = createTestSession('motorista')

  beforeEach(() => {
    getFirstPendingRide.mockReset()
    updateRideStatus.mockReset()
    getFirstPendingRide.mockResolvedValue({ corridaEncontrada: null })
  })

  it('waits until a ride is found, then starts and finishes it', async () => {
    const user = userEvent.setup()
    const ride = createTestRide()
    let pendingRide: typeof ride | null = null
    getFirstPendingRide.mockImplementation(async () => ({
      corridaEncontrada: pendingRide,
    }))
    updateRideStatus.mockImplementation(
      async (input: { statusCorrida: 'initialized' | 'finished' }) => {
        pendingRide = null
        return { ...ride, statusCorrida: input.statusCorrida }
      },
    )

    render(<DriverRide session={session} />)
    expect(screen.getByText(COPY.waiting)).toBeInTheDocument()

    pendingRide = ride
    expect(await screen.findByText(COPY.found)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: COPY.acceptRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(updateRideStatus).toHaveBeenCalledWith({
      token: session.accessToken,
      id: ride.id,
      statusCorrida: 'initialized',
    })
    expect(await screen.findByText(COPY.driving)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: COPY.finishRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(updateRideStatus).toHaveBeenCalledWith({
      token: session.accessToken,
      id: ride.id,
      statusCorrida: 'finished',
    })
    expect(await screen.findByText(COPY.waiting)).toBeInTheDocument()
  })

  it('returns to waiting after declining a ride and ignores it afterwards', async () => {
    const user = userEvent.setup()
    const ride = createTestRide()
    getFirstPendingRide.mockResolvedValue({ corridaEncontrada: ride })

    render(<DriverRide session={session} />)

    expect(await screen.findByText(COPY.found)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: COPY.declineRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(await screen.findByText(COPY.waiting)).toBeInTheDocument()
    await screen.findByText(COPY.waiting)
    expect(screen.queryByText(COPY.found)).not.toBeInTheDocument()
    expect(updateRideStatus).not.toHaveBeenCalled()
  })
})
