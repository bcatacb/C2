import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { get } from '../lib/api'

export function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading')

  useEffect(() => {
    get('/auth/me')
      .then(() => setState('ok'))
      .catch(() => setState('denied'))
  }, [])

  if (state === 'loading')
    return (
      <div className="flex h-screen items-center justify-center text-zinc-400">
        Loading...
      </div>
    )
  if (state === 'denied') return <Navigate to="/login" replace />
  return <>{children}</>
}
