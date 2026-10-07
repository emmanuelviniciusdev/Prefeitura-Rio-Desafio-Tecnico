import { useEffect, useRef } from 'react'

export function usePolling(
  callback: (signal: AbortSignal) => void | Promise<void>,
  enabled: boolean,
  intervalMs: number,
): void {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const controller = new AbortController()
    let inFlight = false

    const run = () => {
      if (inFlight || controller.signal.aborted) {
        return
      }

      inFlight = true
      void Promise.resolve(callbackRef.current(controller.signal)).finally(
        () => {
          inFlight = false
        },
      )
    }

    run()
    const timer = window.setInterval(run, intervalMs)

    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [enabled, intervalMs])
}
