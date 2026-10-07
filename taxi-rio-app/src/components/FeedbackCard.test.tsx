import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { COPY } from '../copy'
import { FeedbackCard } from './FeedbackCard'

describe('FeedbackCard', () => {
  it('shows the arrival message until the passenger closes it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <FeedbackCard
        origin="Copacabana, Rio de Janeiro"
        destination="Ipanema, Rio de Janeiro"
        onClose={onClose}
      />,
    )

    expect(screen.getByText(COPY.arrived)).toBeInTheDocument()
    expect(
      screen.getByText('Copacabana, Rio de Janeiro → Ipanema, Rio de Janeiro'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: COPY.closeFeedback }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
