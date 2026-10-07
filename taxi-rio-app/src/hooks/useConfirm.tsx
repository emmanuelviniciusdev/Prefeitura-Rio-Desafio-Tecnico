import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { COPY } from '../copy'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  dialog: ReactNode
} {
  const [pending, setPending] = useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve })
    })
  }, [])

  const close = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value)
      return null
    })
  }, [])

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.options.title}
      message={pending.options.message}
      confirmLabel={pending.options.confirmLabel ?? COPY.confirm}
      cancelLabel={pending.options.cancelLabel ?? COPY.cancel}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null

  return { confirm, dialog }
}
