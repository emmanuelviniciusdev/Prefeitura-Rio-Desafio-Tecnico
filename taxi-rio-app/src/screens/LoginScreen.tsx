import { useState } from 'react'
import { requestAccessToken } from '../api/auth-api'
import { sessionFromTokenResponse, writeSession } from '../api/session'
import type { Actor, Session } from '../api/types'
import { BrandLogo } from '../components/BrandLogo'
import { TaxiStripe } from '../components/TaxiStripe'
import { COPY } from '../copy'

interface LoginScreenProps {
  onLoggedIn: (session: Session) => void
}

export function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [loadingActor, setLoadingActor] = useState<Actor | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loginAs(actor: Actor) {
    setError(null)
    setLoadingActor(actor)
    try {
      const tokens = await requestAccessToken(actor)
      const session = sessionFromTokenResponse(tokens)
      writeSession(session)
      onLoggedIn(session)
    } catch {
      setError(COPY.loginError)
    } finally {
      setLoadingActor(null)
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-taxi-cream">
      <TaxiStripe />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="rounded-3xl border-2 border-taxi-black bg-white p-8 shadow-xl">
          <div className="flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <h1 className="mt-4 text-3xl font-bold text-taxi-black">{COPY.loginTitle}</h1>
          <p className="mt-2 text-taxi-muted">{COPY.loginSubtitle}</p>
          <div className="mt-8 flex flex-col gap-3">
            <button
              type="button"
              disabled={loadingActor !== null}
              onClick={() => void loginAs('passageiro')}
              className="rounded-2xl bg-taxi-yellow px-4 py-3 text-lg font-bold text-taxi-black hover:bg-taxi-yellow-hover disabled:opacity-60"
            >
              {loadingActor === 'passageiro' ? COPY.loggingIn : COPY.loginPassenger}
            </button>
            <button
              type="button"
              disabled={loadingActor !== null}
              onClick={() => void loginAs('motorista')}
              className="rounded-2xl bg-taxi-black px-4 py-3 text-lg font-bold text-taxi-yellow hover:bg-taxi-navy disabled:opacity-60"
            >
              {loadingActor === 'motorista' ? COPY.loggingIn : COPY.loginDriver}
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-4 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </main>
      <TaxiStripe />
    </div>
  )
}
