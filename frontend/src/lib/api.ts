function getApiBase() {
  const customBase = localStorage.getItem('c2_backend_url')
  if (customBase) {
    return `${customBase.replace(/\/$/, '')}/api`
  }
  return '/api'
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('ui_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  
  const base = getApiBase()
  const res = await fetch(`${base}${path}`, {
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `API error ${res.status}`)
  }
  return res.json()
}

export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

