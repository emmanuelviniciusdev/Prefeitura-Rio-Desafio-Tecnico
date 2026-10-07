import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePolling } from './usePolling'

describe('usePolling', () => {
  it('runs immediately and on the interval while enabled', async () => {
    const callback = vi.fn().mockResolvedValue(undefined)

    const { rerender } = renderHook(
      ({ enabled }) => usePolling(callback, enabled, 20),
      { initialProps: { enabled: true } },
    )

    await waitFor(() => expect(callback).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2))

    const callsAfterDisable = callback.mock.calls.length
    rerender({ enabled: false })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(callback.mock.calls.length).toBe(callsAfterDisable)
  })
})
