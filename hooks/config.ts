// Pure settings logic for jev-routing: the keys, how a typed value is parsed,
// how the layers merge, how a settings file is edited, and the status text.
// No `$` in here, so the rules can be read and tested without a session.
//
// Layers, highest first:
//   local     <cwd>/.claude/settings.local.json  → "jevRouting": { … }   (personal, per project)
//   project   <cwd>/.claude/settings.json        → "jevRouting": { … }   (shared with the repo)
//   user-file ~/.claude/settings.json            → "jevRouting": { … }   (hand-written; read only)
//   global    the manifest's userConfig values (/config, pluginConfigs)
//   defaults  DEFAULTS below
// api_key is never a layer value: it lives in userConfig (sensitive) or the environment.
// The project layer (a file that arrives with a clone) can switch routing off,
// never on: its `enabled: true` and `subagents: true` are dropped.
//
// Every message takes the Strings of a language (i18n.ts); English when none is given.
import { EN, LANGS, normalizeLang, type Lang, type Strings } from './i18n.ts'

export type Policy = 'down-only' | 'both' | 'effort-only'
export type Language = 'auto' | Lang
export type Settings = { min_confidence: number; policy: Policy; enabled: boolean; subagents: boolean; band: boolean; language: Language }
export type Key = keyof Settings
export type Scope = 'local' | 'project' | 'global'
export type LayerName = Scope | 'user-file' | 'defaults'
export type Layer = { name: LayerName; values: Partial<Settings>; path?: string; isPresent: boolean; error?: string }

export const SETTINGS_KEY = 'jevRouting'
export const POLICIES: readonly Policy[] = ['down-only', 'both', 'effort-only']
export const DEFAULTS: Settings = { min_confidence: 0.6, policy: 'down-only', enabled: true, subagents: true, band: true, language: 'auto' }
export const SCOPES: readonly Scope[] = ['local', 'project', 'global']
export const KEYS: readonly Key[] = ['min_confidence', 'policy', 'enabled', 'subagents', 'band', 'language']
// Switches a project file may turn off but never on.
const PROJECT_OFF_ONLY: readonly Key[] = ['enabled', 'subagents']

const parseBoolean = (raw: unknown) => (raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : undefined)
const PARSERS: Record<Key, { hint: string; parse: (raw: unknown) => Settings[Key] | undefined }> = {
  min_confidence: {
    hint: 'a number from 0 to 1',
    parse: raw => {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined
    },
  },
  policy: { hint: POLICIES.join(' | '), parse: raw => (POLICIES.includes(raw as Policy) ? (raw as Policy) : undefined) },
  enabled: { hint: 'true | false', parse: parseBoolean },
  subagents: { hint: 'true | false', parse: parseBoolean },
  band: { hint: 'true | false', parse: parseBoolean },
  language: {
    hint: `auto | ${LANGS.join(' | ')}`,
    parse: raw => (typeof raw === 'string' && raw.trim().toLowerCase() === 'auto' ? 'auto' : normalizeLang(raw) ?? undefined),
  },
}

export const hintFor = (key: Key) => PARSERS[key].hint

// Only the known keys, only values that parse; anything else in the object is ignored.
export function pickValid(raw: unknown): Partial<Settings> {
  if (raw === null || typeof raw !== 'object') return {}
  const out: Partial<Settings> = {}
  for (const key of KEYS) {
    const v = PARSERS[key].parse((raw as Record<string, unknown>)[key])
    if (v !== undefined) (out as Record<string, unknown>)[key] = v
  }
  return out
}

// What one layer may contribute: everything it set, except that the project
// file cannot turn a switch on.
export function layerValues(name: LayerName, raw: unknown): Partial<Settings> {
  const values = pickValid(raw)
  if (name === 'project') for (const key of PROJECT_OFF_ONLY) if (values[key] === true) delete values[key]
  return values
}

// Settings files written by editors on Windows may start with a byte-order mark.
const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

// The parsed object of a settings file, or the reason it cannot be used.
export function parseSettingsText(text: string, s: Strings = EN): { root: Record<string, unknown> } | { error: string } {
  const body = stripBom(text)
  if (body.trim() === '') return { root: {} }
  try {
    const parsed = JSON.parse(body)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: s.notJsonObject }
    return { root: parsed }
  } catch (err) {
    return { error: s.doesNotParse(String(err).slice(0, 80)) }
  }
}

// The effective settings and, for each key, the first layer (highest) that set it.
export function resolve(layers: readonly Layer[]): { effective: Settings; source: Record<Key, LayerName> } {
  const effective: Settings = { ...DEFAULTS }
  const source = Object.fromEntries(KEYS.map(k => [k, 'defaults'])) as Record<Key, LayerName>
  for (const key of KEYS) {
    const hit = layers.find(l => l.values[key] !== undefined)
    if (hit) {
      ;(effective as Record<string, unknown>)[key] = hit.values[key]
      source[key] = hit.name
    }
  }
  return { effective, source }
}

export type SetCommand = { key: Key; value: Settings[Key]; scope: Scope }

// `/jev set <key> <value> [local|project|global]`; the scope defaults to local.
export function parseSet(args: string, s: Strings = EN): SetCommand | { error: string } {
  const [key, rawValue, rawScope, ...rest] = args.trim().split(/\s+/)
  if (!key || rawValue === undefined) return { error: s.setUsage(KEYS.join('|'), SCOPES.join('|')) }
  if (!KEYS.includes(key as Key)) return { error: s.unknownKey(key, KEYS.join(', ')) }
  const value = PARSERS[key as Key].parse(rawValue)
  if (value === undefined) return { error: s.badValue(rawValue, key, PARSERS[key as Key].hint) }
  const scope = (rawScope ?? 'local') as Scope
  if (!SCOPES.includes(scope) || rest.length > 0) return { error: s.badScope(SCOPES.join(', ')) }
  return { key: key as Key, value, scope }
}

// `/jev unset <key> [local|project]`; global values are changed in /config.
export function parseUnset(args: string, s: Strings = EN): { key: Key; scope: Exclude<Scope, 'global'> } | { error: string } {
  const [key, rawScope, ...rest] = args.trim().split(/\s+/)
  if (!key || !KEYS.includes(key as Key)) return { error: s.unsetUsage(KEYS.join('|')) }
  const scope = (rawScope ?? 'local') as Scope
  if (scope === 'global') return { error: s.unsetGlobal }
  if (!SCOPES.includes(scope) || rest.length > 0) return { error: s.unsetScope }
  return { key: key as Key, scope }
}

// A settings file with one key of its jevRouting object changed (or removed
// when `value` is undefined). Every other key of the file is kept as parsed
// (the file is re-indented with two spaces). A file that is not a JSON object
// is left alone, with the reason.
export function editSettingsText(text: string | null, key: Key, value: Settings[Key] | undefined, s: Strings = EN): { text: string } | { error: string } {
  const parsed = parseSettingsText(text ?? '', s)
  if ('error' in parsed) return { error: `${parsed.error}${s.notTouching}` }
  const root = parsed.root
  const section = root[SETTINGS_KEY]
  const current: Record<string, unknown> = section !== null && typeof section === 'object' && !Array.isArray(section) ? { ...(section as Record<string, unknown>) } : {}
  if (value === undefined) delete current[key]
  else current[key] = value
  const next: Record<string, unknown> = { ...root }
  if (Object.keys(current).length === 0) delete next[SETTINGS_KEY]
  else next[SETTINGS_KEY] = current
  return { text: JSON.stringify(next, null, 2) + '\n' }
}

// ── the effort ladder (policy effort-only) ───────────────────────────────────

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]
const rank = (e: unknown) => (typeof e === 'string' ? EFFORTS.indexOf(e as Effort) : -1)

// Under effort-only the model never changes; a haiku-tier prompt runs at low
// effort and an opus-tier prompt at high, each only when that moves the
// session's effort in that direction. Unknown or numeric efforts are left alone.
export function effortFor(tier: string, current: unknown): Effort | null {
  const have = rank(current)
  if (have < 0) return null
  if (tier === 'haiku' && have > rank('low')) return 'low'
  if (tier === 'opus' && have < rank('high')) return 'high'
  return null
}

export type StatusInput = {
  layers: readonly Layer[]
  sessionEnabled: boolean | null
  keySource: 'userConfig' | 'env' | 'none'
  last: string | null
  lastAgent?: string | null
}

export function statusText(input: StatusInput, s: Strings = EN): string {
  const { effective, source } = resolve(input.layers)
  const isOn = input.sessionEnabled ?? effective.enabled
  const lines = [s.statusHeader(isOn, input.sessionEnabled !== null, effective.enabled ? 'on' : 'off')]
  for (const key of KEYS) lines.push(`  ${key.padEnd(15)} ${String(effective[key]).padEnd(12)} ← ${source[key]}`)
  const files = input.layers.filter(l => l.path).map(l => `${l.name} ${l.error ? '✗' : l.isPresent ? '✓' : '–'}`).join(' · ')
  lines.push(`  ${s.statusLayers(files)}`)
  for (const l of input.layers) if (l.error) lines.push(`  ${l.name}: ${l.error} (${l.path})`)
  lines.push(`  api_key: ${input.keySource}${input.keySource === 'none' ? s.statusKeyNone : ''}`)
  lines.push(`  ${s.statusLast(input.last)}`)
  if (input.lastAgent !== undefined) lines.push(`  ${s.statusLastAgent(input.lastAgent)}`)
  return lines.join('\n')
}
