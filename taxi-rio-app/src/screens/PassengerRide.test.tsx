import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COPY } from '../copy'
import { createTestRide, createTestSession } from '../test/fixtures'
import { PassengerRide } from './PassengerRide'

const createRide = vi.fn()
const getRideById = vi.fn()

vi.mock('../api/rides-api', () => ({
  createRide: (...args: unknown[]) => createRide(...args),
  getRideById: (...args: unknown[]) => getRideById(...args),
}))

describe('PassengerRide', () => {
  const session = createTestSession('passageiro')

  beforeEach(() => {
    createRide.mockReset()
    getRideById.mockReset()
  })

  it('prefills a Rio origin and keeps the destination empty', () => {
    render(<PassengerRide session={session} />)

    expect(screen.getByLabelText(COPY.origin)).toHaveValue(COPY.defaultOrigin)
    expect(screen.getByLabelText(COPY.destination)).toHaveValue('')
  })

  it('requests a ride and follows accepted and finished statuses', async () => {
    const user = userEvent.setup()
    const ride = createTestRide()
    createRide.mockResolvedValue(ride)
    getRideById
      .mockResolvedValueOnce(ride)
      .mockResolvedValueOnce({ ...ride, statusCorrida: 'initialized' })
      .mockResolvedValue({ ...ride, statusCorrida: 'finished' })

    render(<PassengerRide session={session} />)

    await user.type(
      screen.getByLabelText(COPY.destination),
      'Ipanema, Rio de Janeiro',
    )
    await user.click(screen.getByRole('button', { name: COPY.requestRide }))
    await user.click(screen.getByRole('button', { name: COPY.confirm }))

    expect(await screen.findByText(COPY.requesting)).toBeInTheDocument()
    expect(createRide).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: session.userId,
        localPartida: COPY.defaultOrigin,
        localDestino: 'Ipanema, Rio de Janeiro',
      }),
    )

    expect(await screen.findByText(COPY.accepted)).toBeInTheDocument()
    expect(await screen.findByText(COPY.arrived)).toBeInTheDocument()
    expect(screen.getByLabelText(COPY.origin)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: COPY.closeFeedback }))
    expect(screen.queryByText(COPY.arrived)).not.toBeInTheDocument()
  })

  it('does not create a ride when the confirmation is cancelled', async () => {
    const user = userEvent.setup()

    render(<PassengerRide session={session} />)
    await user.type(screen.getByLabelText(COPY.destination), 'Centro')
    await user.click(screen.getByRole('button', { name: COPY.requestRide }))
    await user.click(screen.getByRole('button', { name: COPY.cancel }))

    expect(createRide).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
