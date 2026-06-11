type MessageHandler = (data: unknown) => void

let socket: WebSocket | null = null
let handlers: MessageHandler[] = []
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function getWsUrl() {
  const customBase = localStorage.getItem('c2_backend_url')
  if (customBase) {
    const cleanBase = customBase.replace(/^https?:\/\//, '')
    const proto = customBase.startsWith('https') ? 'wss' : 'ws'
    return `${proto}://${cleanBase}/ws`
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}


export function connectWs() {
  if (socket?.readyState === WebSocket.OPEN) return

  socket = new WebSocket(getWsUrl())

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data)
    handlers.forEach((h) => h(data))
  }

  socket.onclose = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connectWs, 3000)
  }

  socket.onerror = () => socket?.close()
}

export function onWsMessage(handler: MessageHandler) {
  handlers.push(handler)
  return () => {
    handlers = handlers.filter((h) => h !== handler)
  }
}

export function disconnectWs() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  socket?.close()
  socket = null
}
