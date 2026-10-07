import { useState, type FormEvent } from 'react'
import { isAbortError } from '../api/http'
import { createRide, getRideById } from '../api/rides-api'
import type { Ride, Session } from '../api/types'
import { FeedbackCard } from '../components/FeedbackCard'
import { COPY } from '../copy'
import { POLL_INTERVAL_MS } from '../config'
import { useConfirm } from '../hooks/useConfirm'
import { usePolling } from '../hooks/usePolling'

type PassengerPhase = 'idle' | 'requesting' | 'accepted' | 'arrived'

interface PassengerRideProps {
  session: Session
}

export function PassengerRide({ session }: PassengerRideProps) {
  const { confirm, dialog } = useConfirm()
  const [origin, setOrigin] = useState<string>(COPY.defaultOrigin)
  const [destination, setDestination] = useState('')
  const [phase, setPhase] = useState<PassengerPhase>('idle')
  const [activeRide, setActiveRide] = useState<Ride | null>(null)
  const [feedbackRide, setFeedbackRide] = useState<Ride | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const showForm = phase === 'idle' || phase === 'arrived'

  usePolling(
    async (signal) => {
      if (!activeRide) {
        return
      }

      try {
        const ride = await getRideById({
          token: session.accessToken,
          id: activeRide.id,
          signal,
        })
        if (ride.statusCorrida === 'finished') {
          setActiveRide(null)
          setFeedbackRide(ride)
          setPhase('arrived')
          return
        }
        if (ride.statusCorrida === 'initialized') {
          setActiveRide(ride)
          setPhase('accepted')
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          return
        }
        setError(COPY.rideError)
      }
    },
    phase === 'requesting' || phase === 'accepted',
    POLL_INTERVAL_MS,
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const localPartida = origin.trim()
    const localDestino = destination.trim()
    if (!localPartida || !localDestino || submitting) {
      return
    }

    const confirmed = await confirm({
      title: COPY.requestConfirmTitle,
      message: COPY.requestConfirmMessage,
    })
    if (!confirmed) {
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const ride = await createRide({
        token: session.accessToken,
        userId: session.userId,
        localPartida,
        localDestino,
        dhInicio: new Date().toISOString(),
        idempotencyKey: crypto.randomUUID(),
      })
      setActiveRide(ride)
      setPhase('requesting')
    } catch {
      setError(COPY.rideError)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {dialog}
      {feedbackRide ? (
        <FeedbackCard
          origin={feedbackRide.localPartida}
          destination={feedbackRide.localDestino}
          onClose={() => setFeedbackRide(null)}
        />
      ) : null}

      {phase === 'requesting' ? (
        <StatusCard label={COPY.requesting} />
      ) : null}
      {phase === 'accepted' ? <StatusCard label={COPY.accepted} /> : null}

      {showForm ? (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="rounded-2xl border-2 border-taxi-black bg-white p-5 shadow-md"
        >
          <div className="space-y-4">
            <label className="block text-left text-sm font-semibold text-taxi-black">
              {COPY.origin}
              <input
                id="origin"
                name="origin"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
                required
                className="mt-1 w-full rounded-xl border-2 border-taxi-black bg-taxi-cream px-3 py-2 font-normal text-taxi-black"
              />
            </label>
            <label className="block text-left text-sm font-semibold text-taxi-black">
              {COPY.destination}
              <input
                id="destination"
                name="destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                required
                className="mt-1 w-full rounded-xl border-2 border-taxi-black bg-taxi-cream px-3 py-2 font-normal text-taxi-black"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full rounded-2xl bg-taxi-yellow px-4 py-3 font-bold text-taxi-black hover:bg-taxi-yellow-hover disabled:opacity-60"
          >
            {COPY.requestRide}
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function StatusCard({ label }: { label: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-2xl border-2 border-taxi-black bg-taxi-yellow px-4 py-6 text-center text-lg font-semibold text-taxi-black"
    >
      {label}
    </p>
  )
}
