const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
]

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
]

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
]

const LOCALES = ['en-US', 'en-US', 'en-US', 'en-GB', 'en-CA']

function seededRandom(seed: string): () => number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b)
    h = (h ^ (h >>> 16)) >>> 0
    return h / 0x100000000
  }
}

export interface BrowserFingerprint {
  userAgent: string
  viewport: { width: number; height: number }
  timezone: string
  locale: string
}

export function generateFingerprint(accountId: string): BrowserFingerprint {
  const rand = seededRandom(accountId)
  return {
    userAgent: USER_AGENTS[Math.floor(rand() * USER_AGENTS.length)],
    viewport: VIEWPORTS[Math.floor(rand() * VIEWPORTS.length)],
    timezone: TIMEZONES[Math.floor(rand() * TIMEZONES.length)],
    locale: LOCALES[Math.floor(rand() * LOCALES.length)],
  }
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function humanTypeDelay(): Promise<void> {
  return randomDelay(50, 150)
}
