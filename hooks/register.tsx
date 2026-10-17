import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { CONTEXT_CHARS, question } from './question.ts'
import {
  type Key, type Layer, type Settings,
  DEFAULTS, SETTINGS_KEY, editSettingsText, effortFor, layerValues, parseSet, parseSettingsText, parseUnset, pickValid, resolve, statusText,
} from './config.ts'
import { EN, STRINGS, pickLang, type Strings } from './i18n.ts'
import { cyclePolicy, describe, short, stepConfidence } from './view.ts'

// jev-routing: route each main-loop turn (and each subagent) to haiku /
// sonnet / opus / fable by asking Jev (TypeSafe System One) which tier the
// prompt needs, then rewrite turn.step's model (or agent.spawn's). Every
// failure falls open: the step runs on the model the engine named.
//
// Settings live in three layers (see config.ts): local and project are the
// "jevRouting" key of the project's .claude/settings(.local).json, written by
// `/jev set … local|project` and by the panel's buttons; global is the
// manifest's userConfig (/config), written by `/jev set … global` through
// $.config.set. api_key is userConfig (sensitive) or the TYPESAFE_API_KEY
// environment variable, never a layer.
//
// Two drawings: a band above the prompt (the last decision, on/off, a button
// to the panel) and a panel (/jev panel) with one button per setting. Every
// sentence comes from i18n.ts, in the language the `language` setting picks
// (auto: Claude Code's own `language` setting, then the locale, else English).
//
// Environment: TYPESAFE_API_KEY (fallback key), JEV_ROUTING=off (start the
// session with routing off), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC (same),
// JEV_TIMEOUT_MS (Jev timeout, default 2000), JEV_ROUTING_LOG (a jsonl path;
// nothing is written when unset).

// The first-party model ids each tier maps to. A session on another
// provider's id still routes down by its tier word; see README › Known limits.
const TIERS: Record<string, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}
const TIER_ORDER = ['haiku', 'sonnet', 'opus', 'fable']
const tierOf = (model: string) => TIER_ORDER.find(t => model.includes(t)) ?? null
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const DEFAULT_TIMEOUT_MS = 2000
const LOG_MAX_LINES = 2000
const PANE = 'jev'
// The documented price of Jev input (output is free); the local tally is an estimate at this price.
const JEV_USD_PER_M_INPUT = 0.042
// After this many Jev failures in a row, Jev is left alone for this long.
const PAUSE_AFTER = 3
const PAUSE_MS = 5 * 60_000

type Reason =
  | 'routed' | 'effort-down' | 'effort-up'
  | 'keep-low-confidence' | 'keep-policy' | 'keep-unknown-model' | 'keep-same'
  | 'disabled' | 'no-key' | 'no-prompt' | 'keep-attachment' | 'keep-resume' | 'keep-fork' | 'paused' | 'error'
type Decision = {
  tier: string | null
  model: string
  effort?: string
  confidence: number | null
  probabilities: Record<string, number> | null
  jevMs: number
  inputTokens: number | null
  reason: Reason
  error?: string
}
// What Jev is asked about: the prompt and, for a main-loop turn, the exchange before it.
type JevState = { prompt: string; previous_user_prompt?: string; previous_assistant_reply?: string }
// What the decision is relative to: the model (and effort) the step would otherwise use.
type Base = { model: string; effort?: unknown }

const keep = (model: string, reason: Reason, error?: string): Decision =>
  ({ tier: null, model, confidence: null, probabilities: null, jevMs: 0, inputTokens: null, reason, ...(error ? { error } : {}) })

// Host state the drawings read (a read while drawing subscribes the drawing):
// a counter bumped after every decision and change, the band's own hide
// button, and where the panel's buttons persist a setting.
const view = atom({ plugin: 'jev-routing', key: 'view' } as const, 0)
const bandHidden = atom({ plugin: 'jev-routing', key: 'bandHidden' } as const, false)
const writeScope = atom({ plugin: 'jev-routing', key: 'writeScope' } as const, 'local')

// userConfig values, as register received them (defaults filled in by the engine).
let opts: Readonly<Record<string, unknown>> = {}
let cwd: string | null = null
let layers: Layer[] = []
let effective: Settings = { ...DEFAULTS }
let s: Strings = EN // the language's sentences, picked with the settings
let sessionEnabled: boolean | null = null // /jev on|off for this session only; null = follow the setting
let interactive = false // a headless run (-p) has no panel to open, whatever $.ui.open says
let fullscreen = true // Claude Code's `tui` setting; the band hints at /tui fullscreen when it is not
let lastDecision: Decision | null = null
let lastAgentDecision: Decision | null = null
let failures = 0 // Jev failures in a row; PAUSE_AFTER of them pause the asking
let pausedUntil = 0 // clock time until which Jev is not asked
let pauseWhy = ''
const prompts = new Map<string, string>() // turnId → the turn's prompt text, from turn.start
const decisions = new Map<string, Decision>() // turnId → the decision its steps share
// Submissions that carried images or other non-text items, by the text they
// entered with, until their turn starts; then the kinds of each such turn's
// attachments, by turnId. Jev never sees an attachment, so a prompt that may
// lean on one is not judged by its text: the turn keeps the session's model
// and effort (`keep-attachment`).
const PENDING_MAX = 20
const pendingAttachments: Array<{ text: string; kinds: string[] }> = []
const attachments = new Map<string, string[]>()

// `claude plugin validate` only lets `$` flow into top-level function
// declarations of this file, so the helpers live here, not inside register.

// Optional jsonl log, only when JEV_ROUTING_LOG names a file. $.fs.write
// replaces the whole file and a hot reload empties `lines`, so the first write
// of each module environment re-reads what is already on disk; a file that
// cannot be read back is left alone and a sibling file is started instead.
let logPath: string | null | undefined
let loaded = false
const lines: string[] = []
async function log($: any, ev: string, data: Record<string, unknown>) {
  try {
    if (logPath === undefined) logPath = (await $.env.get('JEV_ROUTING_LOG')) || null
    if (!logPath) return
    if (!loaded) {
      loaded = true
      try {
        if (await $.fs.exists(logPath)) {
          const text: string = await $.fs.read(logPath)
          lines.push(...text.split('\n').filter((l: string) => l.trim() !== ''))
        }
      } catch {
        logPath = `${logPath}.${Date.now()}.jsonl`
      }
      lines.push(JSON.stringify({ t: new Date().toISOString(), ev: 'module.load' }))
    }
    lines.push(JSON.stringify({ t: new Date().toISOString(), ev, ...data }))
    if (lines.length > LOG_MAX_LINES) lines.splice(0, lines.length - LOG_MAX_LINES)
    await $.fs.write(logPath, lines.join('\n') + '\n')
  } catch { /* logging never blocks the turn */ }
}

async function apiKey($: any): Promise<string | null> {
  if (typeof opts.api_key === 'string' && opts.api_key) return opts.api_key
  return (await $.env.get('TYPESAFE_API_KEY')) || null
}

async function keySource($: any): Promise<'userConfig' | 'env' | 'none'> {
  if (typeof opts.api_key === 'string' && opts.api_key) return 'userConfig'
  return (await $.env.get('TYPESAFE_API_KEY')) ? 'env' : 'none'
}

async function settingsPaths($: any): Promise<Record<'local' | 'project' | 'user-file', string | null>> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? null
  return {
    local: cwd ? `${cwd}/.claude/settings.local.json` : null,
    project: cwd ? `${cwd}/.claude/settings.json` : null,
    'user-file': home ? `${home.replace(/\\/g, '/')}/.claude/settings.json` : null,
  }
}

// One file's jevRouting section as a layer; a missing file is an absent layer,
// an unreadable one is present, empty, and carries the reason.
async function fileLayer($: any, name: Layer['name'], path: string | null): Promise<Layer> {
  if (!path) return { name, values: {}, isPresent: false }
  try {
    if (!(await $.fs.exists(path))) return { name, values: {}, path, isPresent: false }
    const parsed = parseSettingsText(await $.fs.read(path), s)
    if ('error' in parsed) return { name, values: {}, path, isPresent: true, error: parsed.error }
    return { name, values: layerValues(name, parsed.root[SETTINGS_KEY]), path, isPresent: true }
  } catch (err) {
    return { name, values: {}, path, isPresent: true, error: s.cannotReadFile(String(err).slice(0, 80)) }
  }
}

// What Claude Code's own settings decide here: the language (the setting,
// else Claude Code's `language`, else the environment's locale, else English)
// and whether the session renders full-screen. A plugin cannot set `tui`
// itself (it is not a /config row and /tui is not a command a hook may run),
// so the band only says so.
async function readClaudeSettings($: any): Promise<void> {
  let claude: any = {}
  try { claude = (await $.settings.read()) ?? {} } catch { /* no settings here */ }
  const envLocale = (await $.env.get('LC_ALL')) || (await $.env.get('LANG')) || (await $.env.get('LANGUAGE')) || null
  s = STRINGS[pickLang(effective.language, claude.language, envLocale)]
  fullscreen = claude.tui === undefined || claude.tui === 'fullscreen'
}

async function loadLayers($: any): Promise<void> {
  const paths = await settingsPaths($)
  layers = [
    await fileLayer($, 'local', paths.local),
    await fileLayer($, 'project', paths.project),
    await fileLayer($, 'user-file', paths['user-file']),
    { name: 'global', values: pickValid(opts), isPresent: true },
  ]
  effective = resolve(layers).effective
  await readClaudeSettings($)
}

function statusLine(): string {
  const { effective: eff, source } = resolve(layers)
  return s.effective(`min_confidence ${eff.min_confidence} (${source.min_confidence}) · policy ${eff.policy} (${source.policy}) · effort ${eff.effort} (${source.effort}) · enabled ${eff.enabled} (${source.enabled}) · subagents ${eff.subagents} (${source.subagents})`)
}

// Tells the band and the panel to draw again.
async function bump($: any): Promise<void> {
  try { await update($, view, n => n + 1) } catch { /* no host state here */ }
}

// The session override, kept in host state so a reload of the plugin's code
// does not silently turn routing back on. Null means "follow the settings".
async function setSessionEnabled($: any, value: boolean | null): Promise<void> {
  sessionEnabled = value
  try { await $.state.set({ plugin: 'jev-routing', key: 'session' }, value) } catch { /* no host state here */ }
}

// The status line after a switch, so the last turn's decision does not linger there.
async function announce($: any): Promise<void> {
  const isOn = sessionEnabled ?? effective.enabled
  try { await $.ui.status(s.statusLineSwitched(isOn, sessionEnabled !== null)) } catch { /* headless */ }
}

// The band's and the panel's on/off: a session override, or back to the setting when it matches.
async function toggleSession($: any): Promise<void> {
  const isOn = sessionEnabled ?? effective.enabled
  await setSessionEnabled($, !isOn === effective.enabled ? null : !isOn)
  await announce($)
  await bump($)
}

async function openPane($: any): Promise<boolean> {
  try {
    await $.ui.open({ id: PANE, title: 'Jev routing', focus: true, closeOnEscape: true, columns: 64, rows: 14 })
    return true
  } catch {
    return false
  }
}

// `/jev set` for local and project: read-modify-write the file's jevRouting key only.
async function writeLayer($: any, scope: 'local' | 'project', key: Key, value: Settings[Key] | undefined): Promise<{ ok: boolean; text: string }> {
  const path = (await settingsPaths($))[scope]
  if (!path) return { ok: false, text: s.noCwd }
  let text: string | null = null
  try { if (await $.fs.exists(path)) text = await $.fs.read(path) } catch (err) { return { ok: false, text: s.cannotRead(path, String(err)) } }
  const edited = editSettingsText(text, key, value, s)
  if ('error' in edited) return { ok: false, text: `${path}: ${edited.error}` }
  await $.fs.write(path, edited.text)
  if (key === 'enabled') await setSessionEnabled($, null)
  await loadLayers($)
  return { ok: true, text: `${value === undefined ? s.unsetDone(scope, path) : s.setDone(key, String(value), scope, path)}\n${statusLine()}` }
}

// A panel button persisting a setting, to the scope the panel writes to; a
// refusal shows as a toast instead of a transcript line.
async function apply($: any, key: Key, value: Settings[Key]): Promise<void> {
  const scope = await read($, writeScope)
  const result = await writeLayer($, scope, key, value)
  if (!result.ok) { try { $.ui.toast(`jev: ${result.text.split('\n')[0]}`) } catch { /* headless */ } }
  await bump($)
}

async function toggleBand($: any): Promise<void> {
  if (!effective.band) {
    await apply($, 'band', true)
    await update($, bandHidden, () => false)
    return
  }
  await update($, bandHidden, h => !h)
  await bump($)
}

async function flipScope($: any): Promise<void> {
  await update($, writeScope, sc => (sc === 'local' ? 'project' : 'local'))
  await bump($)
}

// `/jev set … global`: the same path as the /config menu, validated by the
// engine. The row is looked up by its field suffix because a side-loaded
// plugin's rows may carry its provenance in the key.
async function writeGlobal($: any, key: Key, value: Settings[Key]): Promise<string> {
  try {
    const rows: Array<{ key: string }> = await $.config.list()
    const row = rows.find(r => r.key.includes($.plugin.name) && r.key.endsWith(`.${key}`))
    if (!row) return s.noGlobalRow(key)
    const result = await $.config.set({ key: row.key, value })
    if (result && 'deny' in result) return s.globalRefused(key, String(result.deny))
    opts = { ...opts, [key]: value }
    if (key === 'enabled') await setSessionEnabled($, null)
    await loadLayers($)
    return `${s.setGlobalDone(key, String(value))}\n${statusLine()}`
  } catch (err) {
    return s.globalFailed(key, String(err))
  }
}

async function clockNow($: any): Promise<number> {
  try { return await $.clock.now() } catch { return Date.now() }
}

// The running tally of Jev calls, in the plugin's own store (kept between
// sessions). TypeSafe has no balance endpoint, so this is the only "how much
// so far" there is: an estimate at the documented price.
type Spend = { calls: number; tokens: number; since: string }
async function readSpend($: any): Promise<Spend> {
  try {
    const held = await $.store.get('spend')
    if (held && typeof held === 'object' && typeof (held as Spend).calls === 'number') return held as Spend
  } catch { /* no store here */ }
  return { calls: 0, tokens: 0, since: new Date().toISOString().slice(0, 10) }
}
async function tally($: any, inputTokens: number | null): Promise<void> {
  try {
    const cur = await readSpend($)
    await $.store.set('spend', { calls: cur.calls + 1, tokens: cur.tokens + (inputTokens ?? 0), since: cur.since })
  } catch { /* never blocks the turn */ }
}
const usd = (tokens: number) => { const v = (tokens / 1_000_000) * JEV_USD_PER_M_INPUT; return v < 0.01 ? v.toFixed(5) : v.toFixed(3) }
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

async function askJev($: any, state: JevState): Promise<Decision> {
  const key = await apiKey($)
  if (!key) return keep('', 'no-key')
  const timeoutMs = Number((await $.env.get('JEV_TIMEOUT_MS')) ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  const body = JSON.stringify({ model: question.model, state, questions: question.questions })
  const started = Date.now()
  const fetching = $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body,
  })
  const timer = $.clock.sleep(timeoutMs).then(() => 'timeout' as const)
  const res = await Promise.race([fetching, timer])
  const jevMs = Date.now() - started
  if (res === 'timeout') return { ...keep('', 'error', `timeout ${timeoutMs}ms`), jevMs }
  if (!res.ok) return { ...keep('', 'error', `HTTP ${res.status}: ${res.text.slice(0, 200)}`), jevMs }
  const parsed = JSON.parse(res.text)
  const answer = parsed?.answers?.tier
  if (!answer || typeof answer.choice !== 'string') return { ...keep('', 'error', `unexpected body: ${res.text.slice(0, 200)}`), jevMs }
  await tally($, parsed.usage?.input_tokens ?? null)
  return {
    tier: answer.choice,
    model: TIERS[answer.choice] ?? '',
    confidence: answer.confidence ?? null,
    probabilities: answer.probabilities ?? null,
    jevMs,
    inputTokens: parsed.usage?.input_tokens ?? null,
    reason: 'routed',
  }
}

// The exchange before the current prompt, each side cut to CONTEXT_CHARS, so a
// short follow-up is judged in context. Anything missing is simply left out.
async function previousExchange($: any, prompt: string): Promise<Omit<JevState, 'prompt'>> {
  try {
    const messages: Array<{ role: string; text?: string }> = await $.session.messages()
    let end = messages.length
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m && m.role === 'user' && (m.text ?? '').trim() === prompt.trim()) { end = i; break }
    }
    const before = messages.slice(0, end)
    const cut = (t: string) => (t.length > CONTEXT_CHARS ? t.slice(0, CONTEXT_CHARS) : t)
    const lastOf = (role: string) => [...before].reverse().find(m => m.role === role && (m.text ?? '').trim() !== '')?.text
    const user = lastOf('user')
    const assistant = lastOf('assistant')
    return { ...(user ? { previous_user_prompt: cut(user) } : {}), ...(assistant ? { previous_assistant_reply: cut(assistant) } : {}) }
  } catch {
    return {}
  }
}

// A turn without a typed prompt (a continuation), a slash command's line, or a
// turn the engine started itself (a background task's notification) has
// nothing of the person's to judge; it stays on the session's model. The
// engine hands a slash command's turn over wrapped in <command-message> and
// <command-name> (its arguments in <command-args>): the work is the
// command's own, which Jev never sees, so the arguments are not judged either.
// A prompt that only starts with an absolute path ("/Users/me/a.ts throws …")
// is text, not a command.
const SLASH_COMMAND = /^\/[\w:-]+(?:\s|$)/
const judgeable = (prompt: string) =>
  prompt.trim() !== '' && !SLASH_COMMAND.test(prompt) && !/^\s*<(?:task-notification|command-message|command-name)\b/.test(prompt)

// The decision for a main-loop turn or a subagent: the switches, then Jev's
// answer, then the gates. `base` is what the step would otherwise run with.
async function decide($: any, base: Base, state: JevState, kind: 'turn' | 'agent'): Promise<Decision> {
  const isOn = sessionEnabled ?? effective.enabled
  if (!isOn) return keep(base.model, 'disabled')
  if (!(await apiKey($))) return keep(base.model, 'no-key')
  if (!judgeable(state.prompt)) return keep(base.model, 'no-prompt')
  const now = await clockNow($)
  if (now < pausedUntil) return keep(base.model, 'paused', `until ${hhmm(pausedUntil)}: ${pauseWhy}`)
  let decision: Decision
  try {
    decision = await askJev($, state)
  } catch (err) {
    decision = keep(base.model, 'error', String(err))
  }
  // The breaker: PAUSE_AFTER failures in a row (a dead key, an exhausted
  // quota, an outage) and Jev is left alone for PAUSE_MS, then tried again.
  if (decision.reason === 'error') {
    failures += 1
    if (failures >= PAUSE_AFTER) { pausedUntil = now + PAUSE_MS; pauseWhy = decision.error ?? 'error'; failures = 0 }
  } else failures = 0
  if (decision.reason !== 'routed') return { ...decision, model: base.model }
  if (!decision.model || decision.tier === null) return { ...decision, reason: 'error', error: `unknown tier ${decision.tier}`, model: base.model }
  const baseTier = tierOf(base.model)
  if ((decision.confidence ?? 0) < effective.min_confidence) return { ...decision, reason: 'keep-low-confidence', model: base.model }
  if (decision.tier === baseTier) return { ...decision, reason: 'keep-same', model: base.model }

  // The model, as the policy allows; when it stays, why.
  let model = base.model
  let kept: Reason = 'keep-policy'
  if (effective.policy === 'both') model = decision.model
  else if (effective.policy === 'down-only') {
    if (baseTier === null) kept = 'keep-unknown-model'
    else if (TIER_ORDER.indexOf(decision.tier) <= TIER_ORDER.indexOf(baseTier)) model = decision.model
  }

  // The effort, when the switch is on: low for a haiku-tier prompt; high for
  // an opus- or fable-tier prompt above the session's tier that the policy
  // kept on the session's model (a step up in thinking in place of the step
  // up in model). A spawn has no effort to set.
  const above = (decision.tier === 'opus' || decision.tier === 'fable') &&
    (baseTier === null || TIER_ORDER.indexOf(decision.tier) > TIER_ORDER.indexOf(baseTier))
  let effort: string | null = null
  if (effective.effort && kind === 'turn') {
    if (decision.tier === 'haiku') effort = effortFor('haiku', base.effort)
    else if (above && model === base.model) effort = effortFor(decision.tier, base.effort)
  }

  if (model !== base.model) return { ...decision, model, ...(effort ? { effort } : {}) }
  if (effort) return { ...decision, reason: decision.tier === 'haiku' ? 'effort-down' : 'effort-up', model, effort }
  return { ...decision, reason: kept, model }
}

async function status($: any, keySrc: 'userConfig' | 'env' | 'none'): Promise<string> {
  const lines = [statusText({
    layers, sessionEnabled, keySource: keySrc,
    last: lastDecision ? describe(lastDecision) : null,
    lastAgent: lastAgentDecision ? describe(lastAgentDecision) : null,
  }, s)]
  const spend = await readSpend($)
  if (spend.calls > 0) lines.push(`  ${s.statusSpend(spend.calls, spend.tokens, usd(spend.tokens), spend.since)}`)
  if ((await clockNow($)) < pausedUntil) lines.push(`  ${s.statusPaused(hhmm(pausedUntil), pauseWhy)}`)
  return lines.join('\n')
}

function resetBreaker(): void {
  failures = 0
  pausedUntil = 0
  pauseWhy = ''
}

export const register: Register = (on, options) => {
  opts = options ?? {}

  on('session.start', async ($, e, next) => {
    const raw: string | null = (e as any).cwd ?? null
    cwd = raw ? raw.replace(/\\/g, '/').replace(/\/+$/, '') : null
    interactive = (e as any).isInteractive === true
    if (!cwd) { try { cwd = String(await $.session.cwd()).replace(/\\/g, '/') } catch { /* a host without it */ } }
    // The session override survives a reload of the plugin's code through host
    // state; the environment decides only when nothing was chosen in this session.
    let restored: boolean | null = null
    try {
      const held = await $.state.get({ plugin: 'jev-routing', key: 'session' })
      if (typeof held?.value === 'boolean') restored = held.value
    } catch { /* no host state here */ }
    if (restored !== null) sessionEnabled = restored
    else if ((await $.env.get('JEV_ROUTING')) === 'off') sessionEnabled = false
    else if (['1', 'true'].includes(String(await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC') ?? '').toLowerCase())) sessionEnabled = false
    await loadLayers($)
    await $.command.register({
      name: 'jev',
      description: s.commandDescription,
      argumentHint: 'status|panel|on|off|band|set|unset|reload',
    })
    const source = await keySource($)
    if (source === 'none') { try { await $.ui.status(s.statusLineNoKey) } catch { /* headless */ } }
    await log($, 'session.start', {
      cwd, keySource: source, sessionEnabled, effective, source: resolve(layers).source,
      options: { ...opts, api_key: opts.api_key === undefined ? undefined : `<${String(opts.api_key).length} chars>` },
    })
    return next(e)
  })

  on('command.run', { command: 'jev' }, async ($, e) => {
    const args = e.args.trim()
    const [verb, ...rest] = args.split(/\s+/)
    const tail = rest.join(' ')
    const what: Record<string, unknown> = { verb: (verb ?? '').toLowerCase() } // never the raw arguments: a pasted key must not reach the log
    let text: string
    switch (what.verb) {
      case 'on':
      case 'off': {
        const wanted = what.verb === 'on'
        if (wanted) resetBreaker()
        await setSessionEnabled($, wanted === effective.enabled ? null : wanted)
        await announce($)
        await bump($)
        text = `${s.sessionSwitched(wanted)}\n${statusLine()}`
        break
      }
      case 'panel':
        text = interactive && (await openPane($)) ? s.panelOpened : `${s.noPanel}\n${await status($, await keySource($))}`
        break
      case 'band': {
        const want = tail.trim().toLowerCase()
        if (want !== 'on' && want !== 'off') { text = s.bandUsage; break }
        try { await update($, bandHidden, () => want === 'off') } catch { /* no host state here */ }
        await bump($)
        text = s.bandSwitched(want === 'on')
        break
      }
      case 'reload': resetBreaker(); await loadLayers($); await bump($); text = `${s.reloaded}\n${statusLine()}`; break
      case 'set': {
        const cmd = parseSet(tail, s)
        if ('error' in cmd) { text = cmd.error; break }
        Object.assign(what, { key: cmd.key, scope: cmd.scope })
        text = cmd.scope === 'global' ? await writeGlobal($, cmd.key, cmd.value) : (await writeLayer($, cmd.scope, cmd.key, cmd.value)).text
        await bump($)
        break
      }
      case 'unset': {
        const cmd = parseUnset(tail, s)
        if ('error' in cmd) { text = cmd.error; break }
        Object.assign(what, { key: cmd.key, scope: cmd.scope })
        text = (await writeLayer($, cmd.scope, cmd.key, undefined)).text
        await bump($)
        break
      }
      case '':
      case 'status':
        await loadLayers($)
        text = await status($, await keySource($))
        break
      default:
        text = s.unknownVerb(String(verb))
    }
    await log($, 'command.run', { ...what, sessionEnabled, effective })
    return { text }
  })

  // A submission that carried attachments is noted once it has entered (a
  // dropped prompt starts no turn), under the text that reached the bottom,
  // and claimed by the turn whose text that is. Observe only: a failure here
  // leaves the prompt alone and the turn judged by its text, as before.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const kinds = (e.attachments ?? []).map((a: { type: string }) => a.type)
    if (kinds.length > 0 && result && !result.drop) {
      pendingAttachments.push({ text: result.text ?? e.text, kinds })
      if (pendingAttachments.length > PENDING_MAX) pendingAttachments.splice(0, pendingAttachments.length - PENDING_MAX)
    }
    return result
  })

  // The prompt a turn proceeds with, bound to its turnId: "" for a
  // continuation, a slash command's line for a command. Subagent turns are
  // not routed here (their model is picked at agent.spawn), so their text is not kept.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      prompts.set(e.turnId, e.text)
      const i = pendingAttachments.findIndex(p => p.text === e.text)
      if (i >= 0) attachments.set(e.turnId, pendingAttachments.splice(i, 1)[0]!.kinds)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    let decision = decisions.get(e.turnId)
    if (!decision) {
      const prompt = prompts.get(e.turnId) ?? ''
      // A turn whose prompt carried an attachment is not judged: Jev would see
      // the text alone. The switches still come first, so a session that is
      // off or has no key reports that, as for any other turn.
      const kinds = attachments.get(e.turnId)
      const unjudged = kinds !== undefined && (sessionEnabled ?? effective.enabled) && Boolean(await apiKey($))
      const state: JevState = { prompt, ...(!unjudged && judgeable(prompt) ? await previousExchange($, prompt) : {}) }
      decision = unjudged
        ? keep(e.model, 'keep-attachment', `${kinds!.join(', ')} attached; not judged`)
        : await decide($, { model: e.model, effort: e.effort }, state, 'turn')
      if (!(next as any).signal?.aborted) {
        decisions.set(e.turnId, decision)
        lastDecision = decision
      }
      // `(routed, effort low)` when the model moved and the effort with it; `(effort-up high)` when only the effort moved.
      const tag = decision.effort ? (decision.reason === 'routed' ? `${decision.reason}, effort ${decision.effort}` : `${decision.reason} ${decision.effort}`) : decision.reason
      if (decision.reason !== 'no-key') { try { await $.ui.status(`jev → ${decision.tier ?? '-'} (${tag})`) } catch { /* headless */ } }
      await log($, 'decision', {
        turnId: e.turnId, sessionModel: e.model, sessionEffort: e.effort ?? null, prompt: prompt.slice(0, 120), attachments: kinds ?? null,
        context: { user: 'previous_user_prompt' in state, assistant: 'previous_assistant_reply' in state },
        minConfidence: effective.min_confidence, policy: effective.policy, effortSwitch: effective.effort,
        ...decision,
      })
      await bump($)
    }

    // Only a routed decision names a model and only a decision with an effort
    // names one; every other field passes through with whatever the engine
    // resolved (the session's model or its fallback).
    const routed = decision.reason === 'routed'
    const req = { ...e, ...(routed ? { model: decision.model } : {}), ...(decision.effort ? { effort: decision.effort as any } : {}) }
    const result = yield* next(req)
    const r: any = result ?? {}
    if (routed && r.stopReason === null && r.usage === null) {
      // No response arrived on the routed model (an id the provider does not
      // serve, a dead request): the engine's retry stays on its own model.
      decisions.set(e.turnId, keep(e.model, 'error', `no response from ${decision.model}; the turn stays on the session's model`))
      lastDecision = decisions.get(e.turnId)!
    }
    const u: any = r.usage ?? null
    await log($, 'step', {
      turnId: e.turnId, index: e.index, requested: routed ? decision.model : e.model, requestedEffort: (req as any).effort ?? null, stopReason: r.stopReason ?? null,
      usageModel: u?.model ?? null, input: u?.input_tokens ?? null, output: u?.output_tokens ?? null,
      cacheRead: u?.cache_read_input_tokens ?? null, cacheCreate: u?.cache_creation_input_tokens ?? null,
    })
    return result
  })

  // A subagent's model is picked once, from its brief, relative to the model
  // the call named or the parent's. A subagent starts with an empty cache, so
  // this never rebuilds one. A resumed run keeps the model it started on and
  // a fork always runs on its parent's: the engine ignores a model set for
  // either, so Jev is not asked about them. The switches still come first, as
  // for a turn with an attachment.
  on('agent.spawn', async ($, e, next) => {
    if (!effective.subagents) return next(e)
    const base = e.fork ? e.parentModel : e.model ?? e.parentModel
    const fixed: Reason | null = e.resume ? 'keep-resume' : e.fork ? 'keep-fork' : null
    const decision = fixed !== null && (sessionEnabled ?? effective.enabled) && (await apiKey($))
      ? keep(base, fixed)
      : await decide($, { model: base }, { prompt: e.prompt }, 'agent')
    lastAgentDecision = decision
    if (decision.reason !== 'no-key' && decision.reason !== 'disabled') { try { await $.ui.status(`jev → ${decision.tier ?? '-'} (${decision.reason}, subagent)`) } catch { /* headless */ } }
    // The row is written once the engine has answered, with the model it
    // started the subagent on: the check that a routed model took effect.
    let started: Awaited<ReturnType<typeof next>> | undefined
    try {
      started = await next(decision.reason === 'routed' ? { ...e, model: decision.model } : e)
      return started
    } finally {
      await log($, 'agent.decision', {
        subagentType: e.subagentType, description: e.description, base, parentModel: e.parentModel, parentAgentId: e.parentAgentId ?? null,
        resumedAgentId: e.resume?.agentId ?? null, startedModel: started?.model ?? null,
        minConfidence: effective.min_confidence, policy: effective.policy, effortSwitch: effective.effort,
        ...decision,
      })
      await bump($)
    }
  })

  on('turn.complete', async ($, e, next) => {
    decisions.delete(e.turnId)
    prompts.delete(e.turnId)
    attachments.delete(e.turnId)
    return next(e)
  })

  // The band: one line above the prompt. It yields to the feedback survey, to
  // the band setting, and to its own hide button.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let hidden = false
    try { await read($, view); hidden = await read($, bandHidden) } catch { /* no host state: draw what the module knows */ }
    if (e.props.hasSurvey || !effective.band || hidden) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOn = sessionEnabled ?? effective.enabled
    const key = await keySource($)
    // The effort switch is shown beside the policy: two sessions that differ
    // only there must not look the same.
    const summary = key === 'none'
      ? s.bandNoKey
      : `${s.onOff(isOn)} · ${effective.policy} · effort ${s.onOff(effective.effort)}${isOn && lastDecision ? ` · ${short(lastDecision)}` : ''}`

    return (
      <Box columnGap={2}>
        <Text dimColor>{`jev ▸ ${summary}${fullscreen ? '' : ` · ${s.tuiHint}`}`}</Text>
        {key !== 'none' && <Button key="toggle" label={s.bandToggle(isOn)} hotkey="o" plain onPress={() => toggleSession($)} />}
        <Button key="open" label={s.bandSettings} hotkey="s" plain onPress={() => openPane($)} />
        <Button key="hide" label={s.bandHide} plain dimColor onPress={() => update($, bandHidden, () => true)} />
      </Box>
    )
  })

  // The panel: the effective settings, where each comes from, and a button per
  // setting. Buttons 2–6 persist to the local or the project file.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    let hidden = false
    let scope: 'local' | 'project' = 'local'
    try { await read($, view); hidden = await read($, bandHidden); scope = await read($, writeScope) } catch { /* no host state */ }
    const { Box, Button, Text } = $.ui.resolve(e)
    const { effective: eff, source } = resolve(layers)
    const isOn = sessionEnabled ?? eff.enabled
    const key = await keySource($)
    const path = (await settingsPaths($))[scope] ?? '?'
    const spend = await readSpend($)
    const row = (label: string, value: string, from: string) => `${label.padEnd(15)} ${value.padEnd(11)} ← ${from}`
    const bandState = !eff.band ? 'off' : hidden ? 'hidden' : 'shown'

    return (
      <Box flexDirection="column">
        <Box columnGap={2}>
          <Text bold>{s.paneTitle(isOn, sessionEnabled !== null)}</Text>
          <Button key="toggle" label={s.paneToggle(isOn)} hotkey="1" plain onPress={() => toggleSession($)} />
        </Box>
        <Box columnGap={2}>
          <Text>{row('policy', eff.policy, source.policy)}</Text>
          <Button key="policy" label={s.paneNext(cyclePolicy(eff.policy))} hotkey="2" plain onPress={() => apply($, 'policy', cyclePolicy(eff.policy))} />
        </Box>
        <Box columnGap={2}>
          <Text>{row('effort', String(eff.effort), source.effort)}</Text>
          <Button key="effort" label={s.paneToggle(eff.effort)} hotkey="3" plain onPress={() => apply($, 'effort', !eff.effort)} />
        </Box>
        <Box columnGap={2}>
          <Text>{row('min_confidence', String(eff.min_confidence), source.min_confidence)}</Text>
          <Button key="conf-down" label="−0.1" hotkey="4" plain onPress={() => apply($, 'min_confidence', stepConfidence(eff.min_confidence, -0.1))} />
          <Button key="conf-up" label="+0.1" hotkey="5" plain onPress={() => apply($, 'min_confidence', stepConfidence(eff.min_confidence, 0.1))} />
        </Box>
        <Box columnGap={2}>
          <Text>{row('subagents', String(eff.subagents), source.subagents)}</Text>
          <Button key="subagents" label={s.paneToggle(eff.subagents)} hotkey="6" plain onPress={() => apply($, 'subagents', !eff.subagents)} />
        </Box>
        <Box columnGap={2}>
          <Text>{row('band', s.paneBandValue(bandState), source.band)}</Text>
          <Button key="band" label={s.paneBandButton(bandState === 'shown')} hotkey="7" plain onPress={() => toggleBand($)} />
        </Box>
        <Text dimColor>{s.paneLast(key, lastDecision ? short(lastDecision) : null, lastAgentDecision ? short(lastAgentDecision) : null)}</Text>
        {spend.calls > 0 && <Text dimColor wrap="wrap">{s.statusSpend(spend.calls, spend.tokens, usd(spend.tokens), spend.since)}</Text>}
        <Box columnGap={2}>
          <Text dimColor>{s.paneWrites(scope, path)}</Text>
          <Button key="scope" label={s.paneScopeButton(scope === 'local' ? 'project' : 'local')} hotkey="8" plain onPress={() => flipScope($)} />
        </Box>
        <Text dimColor>{s.paneFooter}</Text>
        {!fullscreen && <Text color="yellow">{s.tuiHint}</Text>}
      </Box>
    )
  })
}
