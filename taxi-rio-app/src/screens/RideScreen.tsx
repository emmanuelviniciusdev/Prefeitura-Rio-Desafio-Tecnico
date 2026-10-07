import { clearSession } from '../api/session'
import type { Session } from '../api/types'
import { TaxiStripe } from '../components/TaxiStripe'
import { COPY } from '../copy'
import { useConfirm } from '../hooks/useConfirm'
import { DriverRide } from './DriverRide'
import { PassengerRide } from './PassengerRide'

interface RideScreenProps {
  session: Session
  onLogout: () => void
}

export function RideScreen({ session, onLogout }: RideScreenProps) {
  const { confirm, dialog } = useConfirm()
  const roleLabel =
    session.actor === 'passageiro' ? COPY.passenger : COPY.driver

  async function logout() {
    const confirmed = await confirm({
      title: COPY.logoutConfirmTitle,
      message: COPY.logoutConfirmMessage,
    })
    if (!confirmed) {
      return
    }

    clearSession()
    onLogout()
  }

  return (
    <div className="flex min-h-svh flex-col bg-taxi-cream">
      {dialog}
      <TaxiStripe />
      <header className="border-b-2 border-taxi-black bg-taxi-yellow">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-4 px-4 py-4">
          <div className="text-left">
            <p className="text-lg font-bold text-taxi-black">{COPY.appName}</p>
            <p className="text-sm font-medium text-taxi-navy">{roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-xl border-2 border-taxi-black bg-taxi-black px-4 py-2 font-semibold text-taxi-yellow hover:bg-taxi-navy"
          >
            {COPY.logout}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {session.actor === 'passageiro' ? (
          <PassengerRide session={session} />
        ) : (
          <DriverRide session={session} />
        )}
      </main>
      <TaxiStripe />
    </div>
  )
}
