// Pure helpers for the band and the panel: what a decision reads as in one
// line, how a button steps a setting. No `$` here.
import { POLICIES, type Policy } from './config.ts'

export type DecisionLike = {
  tier: string | null
  reason: string
  confidence: number | null
  jevMs: number
  effort?: string
  error?: string
}

// `routed haiku conf=0.95 371ms effort=low (why)`: the status command's line.
export const describe = (d: DecisionLike) =>
  `${d.reason} ${d.tier ?? '-'} conf=${d.confidence ?? '-'} ${d.jevMs}ms` + (d.effort ? ` effort=${d.effort}` : '') + (d.error ? ` (${d.error})` : '')

// `haiku (routed) 0.95`: the band's few characters.
export const short = (d: DecisionLike) =>
  `${d.tier ?? '-'} (${d.reason})${d.confidence !== null ? ` ${d.confidence.toFixed(2)}` : ''}`

// The next policy on the ring down-only → both → effort-only → down-only.
export const cyclePolicy = (p: Policy): Policy => POLICIES[(POLICIES.indexOf(p) + 1) % POLICIES.length] ?? 'down-only'

// min_confidence moved by `delta`, kept in 0..1 and to one decimal.
export const stepConfidence = (v: number, delta: number) => Math.round(Math.min(1, Math.max(0, v + delta)) * 10) / 10
