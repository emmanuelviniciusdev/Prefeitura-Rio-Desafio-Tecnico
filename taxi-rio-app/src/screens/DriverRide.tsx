import { useRef, useState } from 'react'
import { isAbortError } from '../api/http'
import { getFirstPendingRide, updateRideStatus } from '../api/rides-api'
import type { Ride, Session } from '../api/types'
import { COPY } from '../copy'
import { POLL_INTERVAL_MS } from '../config'
import { useConfirm } from '../hooks/useConfirm'
import { usePolling } from '../hooks/usePolling'

type DriverPhase = 'waiting' | 'found' | 'driving'

interface DriverRideProps {
  session: Session
}

export function DriverRide({ session }: DriverRideProps) {
  const { confirm, dialog } = useConfirm()
  const declinedIds = useRef(new Set<string>())
  const [phase, setPhase] = useState<DriverPhase>('waiting')
  const [currentRide, setCurrentRide] = useState<Ride | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  usePolling(
    async (signal) => {
      try {
        const result = await getFirstPendingRide({
          token: session.accessToken,
          signal,
        })
        const ride = result.corridaEncontrada
        if (ride && !declinedIds.current.has(ride.id)) {
          setCurrentRide(ride)
          setPhase('found')
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          return
        }
        setError(COPY.rideError)
      }
    },
    phase === 'waiting',
    POLL_INTERVAL_MS,
  )

  async function acceptRide() {
    if (!currentRide || busy) {
      return
    }

    const confirmed = await confirm({
      title: COPY.acceptConfirmTitle,
      message: COPY.acceptConfirmMessage,
    })
    if (!confirmed) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      const ride = await updateRideStatus({
        token: session.accessToken,
        id: currentRide.id,
        statusCorrida: 'initialized',
      })
      setCurrentRide(ride)
      setPhase('driving')
    } catch {
      setError(COPY.rideError)
    } finally {
      setBusy(false)
    }
  }

  async function declineRide() {
    if (!currentRide || busy) {
      return
    }

    const confirmed = await confirm({
      title: COPY.declineConfirmTitle,
      message: COPY.declineConfirmMessage,
    })
    if (!confirmed) {
      return
    }

    declinedIds.current.add(currentRide.id)
    setCurrentRide(null)
    setPhase('waiting')
  }

  async function finishRide() {
    if (!currentRide || busy) {
      return
    }

    const confirmed = await confirm({
      title: COPY.finishConfirmTitle,
      message: COPY.finishConfirmMessage,
    })
    if (!confirmed) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      await updateRideStatus({
        token: session.accessToken,
        id: currentRide.id,
        statusCorrida: 'finished',
      })
      setCurrentRide(null)
      setPhase('waiting')
    } catch {
      setError(COPY.rideError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {dialog}
      {phase === 'waiting' ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-2xl border-2 border-taxi-black bg-white px-4 py-8 text-center text-lg font-semibold text-taxi-black"
        >
          {COPY.waiting}
        </p>
      ) : null}

      {phase === 'found' && currentRide ? (
        <section className="rounded-2xl border-2 border-taxi-black bg-white p-5 shadow-md">
          <p role="status" aria-live="polite" className="text-lg font-semibold text-taxi-black">
            {COPY.found}
          </p>
          <p className="mt-2 text-sm text-taxi-muted">
            {currentRide.localPartida} → {currentRide.localDestino}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void acceptRide()}
              className="flex-1 rounded-2xl bg-taxi-yellow px-4 py-3 font-bold text-taxi-black hover:bg-taxi-yellow-hover disabled:opacity-60"
            >
              {COPY.acceptRide}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void declineRide()}
              className="flex-1 rounded-2xl border-2 border-taxi-black bg-white px-4 py-3 font-bold text-taxi-black hover:bg-taxi-cream disabled:opacity-60"
            >
              {COPY.declineRide}
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'driving' ? (
        <section className="rounded-2xl border-2 border-taxi-black bg-white p-5 shadow-md">
          <p role="status" aria-live="polite" className="text-lg font-semibold text-taxi-black">
            {COPY.driving}
          </p>
          {currentRide ? (
            <p className="mt-2 text-sm text-taxi-muted">
              {currentRide.localPartida} → {currentRide.localDestino}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void finishRide()}
            className="mt-5 w-full rounded-2xl bg-taxi-yellow px-4 py-3 font-bold text-taxi-black hover:bg-taxi-yellow-hover disabled:opacity-60"
          >
            {COPY.finishRide}
          </button>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
