export function readScenarioNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}
