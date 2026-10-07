import { useState } from 'react'
import { readSession } from './api/session'
import type { Session } from './api/types'
import { LoginScreen } from './screens/LoginScreen'
import { RideScreen } from './screens/RideScreen'

function App() {
  const [session, setSession] = useState<Session | null>(() => readSession())

  if (!session) {
    return <LoginScreen onLoggedIn={setSession} />
  }

  return <RideScreen session={session} onLogout={() => setSession(null)} />
}

export default App
