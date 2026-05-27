const BACKOFF_STEPS_MS = [
  6 * 60 * 60 * 1000,   // 6h
  12 * 60 * 60 * 1000,  // 12h
  24 * 60 * 60 * 1000,  // 24h
]

export function isInCooldown(cooldownUntil: string | null): boolean {
  if (!cooldownUntil) return false
  return new Date(cooldownUntil).getTime() > Date.now()
}

export function nextCooldown(currentStep: number): { untilMs: number; step: number } {
  const step = Math.min(currentStep, BACKOFF_STEPS_MS.length - 1)
  const durationMs = BACKOFF_STEPS_MS[step]
  return {
    untilMs: Date.now() + durationMs,
    step: step + 1,
  }
}

export function extractWaitSeconds(errorMessage: string): number | null {
  const match = errorMessage.match(/wait[_\s]*(\d+)/i)
  return match ? parseInt(match[1], 10) : null
}

export function cooldownFromWait(waitSeconds: number): { untilMs: number } {
  return { untilMs: Date.now() + waitSeconds * 1000 }
}
