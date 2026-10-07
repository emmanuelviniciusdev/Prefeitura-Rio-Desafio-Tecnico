import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('confirms and cancels from the dialog actions', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        title="Sair da conta"
        message="Deseja encerrar a sessão?"
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Sair da conta' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onConfirm).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('cancels when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        title="Sair da conta"
        message="Deseja encerrar a sessão?"
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
