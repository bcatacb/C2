type MessageHandler = (data: unknown) => void

let socket: WebSocket | null = null
let handlers: MessageHandler[] = []
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function getWsUrl() {
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
