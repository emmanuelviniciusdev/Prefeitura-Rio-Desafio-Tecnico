export const POLL_INTERVAL_MS = import.meta.env.MODE === 'test' ? 20 : 2_000

export const SESSION_STORAGE_KEY = 'taxi-rio.session'
