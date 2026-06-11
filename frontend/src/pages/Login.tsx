import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { post } from '../lib/api'

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [backendUrl, setBackendUrl] = useState(localStorage.getItem('c2_backend_url') || '')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (backendUrl.trim()) {
        localStorage.setItem('c2_backend_url', backendUrl.trim())
      } else {
        localStorage.removeItem('c2_backend_url')
      }
      const res = await post<{ token: string }>('/auth/signin', { email: username, password })
      localStorage.setItem('ui_token', res.token)
      navigate('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-8"
      >
        <h1 className="mb-6 text-xl font-semibold text-white">TokTik C2</h1>
        {error && (
          <div className="mb-4 rounded bg-red-900/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-zinc-400">Backend Server URL (optional)</span>
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
            placeholder="http://localhost:4000"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-zinc-400">Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
            placeholder="admin"
            required
          />
        </label>
        <label className="mb-6 block">
          <span className="mb-1 block text-sm text-zinc-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
            required
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Sign in
        </button>
      </form>
    </div>
  )
}

