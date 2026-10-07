import { COPY } from '../copy'

interface FeedbackCardProps {
  origin: string
  destination: string
  onClose: () => void
}

export function FeedbackCard({ origin, destination, onClose }: FeedbackCardProps) {
  return (
    <section
      aria-label={COPY.arrived}
      className="rounded-2xl border-2 border-taxi-black bg-white p-5 shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-taxi-black">{COPY.arrived}</p>
          <p className="mt-2 text-sm text-taxi-muted">
            {origin} → {destination}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border-2 border-taxi-black bg-taxi-cream px-3 py-1 text-sm font-semibold text-taxi-black hover:bg-taxi-yellow"
        >
          {COPY.closeFeedback}
        </button>
      </div>
    </section>
  )
}
