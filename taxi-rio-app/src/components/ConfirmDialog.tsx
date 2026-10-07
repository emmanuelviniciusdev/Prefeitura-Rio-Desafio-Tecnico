import { useEffect } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-taxi-black/55 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-md rounded-2xl border-2 border-taxi-black bg-white p-6 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-xl font-semibold text-taxi-black">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-taxi-muted">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border-2 border-taxi-black bg-white px-4 py-2 font-semibold text-taxi-black hover:bg-taxi-cream"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-taxi-yellow px-4 py-2 font-semibold text-taxi-black hover:bg-taxi-yellow-hover"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
