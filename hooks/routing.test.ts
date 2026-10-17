import { test, expect, mock } from 'claude-code/testing'

// The mod end to end, with the world beneath it mocked: Jev's answer, the
// environment, the clock, host state, the conversation and the settings
// files all live in memory.

const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const OPUS = 'claude-opus-5-5'
const FABLE = 'claude-fable-5-1'
const ARN = 'arn:aws:bedrock:us-east-1:123:application-inference-profile/abc'
const LOCAL = '/repo/.claude/settings.local.json'
const PROJECT = '/repo/.claude/settings.json'
const USER_FILE = '/home/me/.claude/settings.json'
const LOG = '/logs/jev.jsonl'
const BOM = '\uFEFF'

const jevBody = (choice: string, confidence: number) =>
  JSON.stringify({ answers: { tier: { choice, confidence, probabilities: { haiku: 0, sonnet: 0, opus: 0, [choice]: confidence } } }, usage: { input_tokens: 500 } })
const ok = (text: string) => ({ value: { ok: true, status: 200, headers: {}, text } })
const stepResult = (e: any, overrides: Record<string, unknown> = {}) =>
  ({ turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null, ...overrides })

type Options = {
  env?: Record<string, string>
  files?: Record<string, string>
  // What Jev answers; the default is haiku at 0.95. A promise that never settles simulates a hang.
  jev?: (prompt: string) => unknown
  // A path whose $.fs.read fails (an unreadable file).
  readFails?: string
  // What the engine answers for a step; the default is a normal end_turn.
  step?: (e: any) => Record<string, unknown>
  // The /config rows the session lists, and what $.config.set does.
  configRows?: Array<{ key: string; value: unknown; kind: string; provider: unknown }>
  configSet?: (e: any) => unknown
  // The host state held for this plugin at the start (a reload keeps it).
  state?: unknown
  // The conversation $.session.messages() returns; `messagesFail` makes the call throw.
  messages?: Array<{ role: 'user' | 'assistant'; text: string }>
  messagesFail?: boolean
  // What $.settings.read() returns (Claude Code's merged settings, e.g. its `language`).
  settings?: Record<string, unknown>
  // Which submitted prompts the engine drops (a settings hook's block).
  drop?: (text: string) => boolean
}

function world(on: any, options: Options = {}) {
  const w = {
    files: { ...(options.files ?? {}) } as Record<string, string>,
    fetches: [] as Array<{ url: string; init: any; state: any }>,
    prompts: [] as string[],
    steps: [] as Array<{ model: string; index: number; agentId?: string; effort?: unknown }>,
    spawns: [] as Array<{ model: string | undefined; prompt: string }>,
    statuses: [] as string[],
    configSets: [] as any[],
    messages: options.messages ?? [] as Array<{ role: string; text: string }>,
    // Host state by key; `session` is the /jev on|off override.
    state: { session: options.state } as Record<string, unknown>,
    clock: mock.clock(on, { now: 1_000 }),
  }
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', USERPROFILE: '/home/me', ...(options.env ?? {}) })
  mock.store(on, {})
  // The engine resolves the path before it reaches the hook (on Windows
  // `/repo/x` arrives as `D:\repo\x`), so the files are keyed by its POSIX form.
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('fs.exists', ($: any, e: any) => ({ value: norm(e.path) in w.files }))
  on('fs.read', ($: any, e: any) => {
    if (options.readFails && norm(e.path) === options.readFails) throw new Error('file over 4 MiB')
    return { value: w.files[norm(e.path)] ?? '' }
  })
  on('fs.write', ($: any, e: any) => { w.files[norm(e.path)] = e.text; return { value: undefined } })
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('ui.status', ($: any, e: any) => { w.statuses.push(e.text); return { value: undefined } })
  on('config.list', () => ({ value: options.configRows ?? [] }))
  on('config.set', ($: any, e: any) => { w.configSets.push({ key: e.key, value: e.value }); return options.configSet ? options.configSet(e) : { value: e.value } })
  on('state.get', ($: any, e: any) => ({ value: { value: w.state[e.key], version: 1 } }))
  on('state.set', ($: any, e: any) => { w.state[e.key] = e.value; return { value: { isSet: true, version: 2 } } })
  on('ui.open', ($: any, e: any) => { w.statuses.push(`open:${e.id}`); return { value: { id: e.id } } })
  on('session.messages', () => { if (options.messagesFail) throw new Error('no transcript'); return { value: w.messages } })
  on('settings.read', () => ({ value: options.settings ?? {} }))
  on('http.fetch', ($: any, e: any) => {
    const state = JSON.parse(e.init.body).state
    w.fetches.push({ url: e.url, init: e.init, state })
    w.prompts.push(state.prompt)
    return options.jev ? options.jev(state.prompt) : ok(jevBody('haiku', 0.95))
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', ($: any, e: any) => options.drop?.(e.text) ? { drop: 'blocked by a settings hook' } : { text: e.text })
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($: any, e: any) {
    w.steps.push({ model: e.model, index: e.index, agentId: e.agentId, effort: e.effort })
    return stepResult(e, options.step ? options.step(e) : {})
  })
  on('agent.spawn', ($: any, e: any) => { w.spawns.push({ model: e.model, prompt: e.prompt }); return { model: e.model ?? e.parentModel, agentId: 'agent-1' } })
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  return w
}

const start = ($: any, cwd = '/repo') => $.session.start({ cwd, surface: null, isInteractive: false })
const jev = ($: any, args = 'status') => $.command.run({ command: 'jev', args })
const begin = ($: any, turnId: string, text: string, extra: Record<string, unknown> = {}) => $.turn.start({ turnId, text, ...extra })
const submit = ($: any, text: string, attachments?: Array<Record<string, unknown>>) => $.prompt.submit({ text, ...(attachments ? { attachments } : {}) })
const complete = ($: any, turnId: string) => $.turn.complete({ turnId, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
const spawn = ($: any, prompt: string, extra: Record<string, unknown> = {}) =>
  $.agent.spawn({ prompt, description: 'a task', subagentType: 'general-purpose', provider: { kind: 'core', tier: 'core' }, parentModel: SONNET, ...extra })

async function step($: any, turnId: string, model: string, extra: Record<string, unknown> = {}) {
  const stream = $.turn.step({ turnId, index: 0, model, effort: 'medium', messageCount: 1, ...extra })
  for await (const _chunk of stream) { /* drain */ }
  return stream.result
}

async function turn($: any, prompt: string, model: string, turnId: string, extra: Record<string, unknown> = {}) {
  await begin($, turnId, prompt)
  await step($, turnId, model, extra)
  await complete($, turnId)
}

const models = (w: ReturnType<typeof world>) => w.steps.map(s => s.model)
const last = (w: ReturnType<typeof world>) => w.statuses[w.statuses.length - 1]

// ── routing ────────────────────────────────────────────────────────────────

test('a lookup prompt on a sonnet session runs on haiku', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')

  expect(models(w)).toEqual([HAIKU])
  expect(w.fetches).toHaveLength(1)
  expect(w.fetches[0]!.url).toBe('https://api.typesafe.ai/v1/systemone')
  expect(w.fetches[0]!.init.headers.Authorization).toBe('Bearer test-key')
  const body = JSON.parse(w.fetches[0]!.init.body)
  expect(body).toMatchObject({ model: 'jev-1.13.0', state: { prompt: 'which file defines register?' } })
  expect(Object.keys(body)).toEqual(['model', 'state', 'questions'])
  expect(Object.keys(body.state)).toEqual(['prompt'])
  expect(Object.keys(body.questions.tier.criteria)).toEqual(['haiku', 'sonnet', 'opus', 'fable'])
  expect(last(w)).toBe('jev → haiku (routed, effort low)')
  expect((await jev($)).text).toContain('last: routed haiku conf=0.95')
})

test('the previous exchange goes to Jev with the prompt, each side cut to 300 characters', async ($, on) => {
  const w = world(on, { messages: [
    { role: 'user', text: 'Which file defines parseSet?' },
    { role: 'assistant', text: 'A'.repeat(500) },
    { role: 'user', text: 'and parseUnset?' },
  ] })
  await start($)
  await turn($, 'and parseUnset?', SONNET, 't1')

  const state = w.fetches[0]!.state
  expect(Object.keys(state)).toEqual(['prompt', 'previous_user_prompt', 'previous_assistant_reply'])
  expect(state.previous_user_prompt).toBe('Which file defines parseSet?')
  expect(state.previous_assistant_reply).toBe('A'.repeat(300))
})

test('the first prompt of a session goes alone; a transcript that cannot be read does not stop routing', async ($, on) => {
  const w = world(on, { messages: [{ role: 'user', text: 'hello' }], messagesFail: true })
  await start($)
  await turn($, 'hello', SONNET, 't1')

  expect(Object.keys(w.fetches[0]!.state)).toEqual(['prompt'])
  expect(models(w)).toEqual([HAIKU])
})

test('one decision per turn: later steps reuse it, the next turn asks again', async ($, on) => {
  const w = world(on)
  await start($)
  await begin($, 't1', 'rename foo to bar')
  await step($, 't1', SONNET)
  await step($, 't1', SONNET, { index: 1 })
  await complete($, 't1')
  await turn($, 'rename bar to baz', SONNET, 't2')

  expect(w.prompts).toEqual(['rename foo to bar', 'rename bar to baz'])
  expect(models(w)).toEqual([HAIKU, HAIKU, HAIKU])
})

test('below min_confidence the session model stays', async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('haiku', 0.4)) })
  await start($)
  await turn($, 'something in between', SONNET, 't1')

  expect(models(w)).toEqual([SONNET])
  expect(last(w)).toBe('jev → haiku (keep-low-confidence)')
})

test('down-only never routes above the session model', async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('opus', 0.92)) })
  await start($)
  await turn($, 'design the migration strategy', SONNET, 't1')

  expect(models(w)).toEqual([SONNET])
  expect(last(w)).toBe('jev → opus (effort-up high)')
})

test('policy both routes up as well', { options: { policy: 'both' } }, async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('opus', 0.92)) })
  await start($)
  await turn($, 'design the migration strategy', SONNET, 't1')

  expect(models(w)).toEqual([OPUS])
  expect(last(w)).toBe('jev → opus (routed)')
})

test('the session tier is kept by tier, whatever the model version', async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('sonnet', 0.9)) })
  await start($)
  await turn($, 'write a test for parseSet', 'claude-sonnet-4-5', 't1')
  await turn($, 'write a test for parseSet', SONNET, 't2')

  expect(models(w)).toEqual(['claude-sonnet-4-5', SONNET])
  expect(w.statuses.filter(s => s === 'jev → sonnet (keep-same)')).toHaveLength(2)
})

test('a session model without a tier word is kept under down-only', { options: { effort: false } }, async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('opus', 0.95)) })
  await start($)
  await turn($, 'design the migration strategy', ARN, 't1')

  expect(models(w)).toEqual([ARN])
  expect(last(w)).toBe('jev → opus (keep-unknown-model)')
})

test('a session model without a tier word gets a higher effort for an opus-tier prompt, never for a sonnet-tier one', async ($, on) => {
  let answer = jevBody('opus', 0.95)
  const w = world(on, { jev: () => ok(answer) })
  await start($)
  await turn($, 'design the migration strategy', ARN, 't1')
  answer = jevBody('sonnet', 0.95)
  await turn($, 'write a test for parseSet', ARN, 't2')

  expect(w.steps.map(st => [st.model, st.effort])).toEqual([[ARN, 'high'], [ARN, 'medium']])
  expect(w.statuses.filter(st => st.startsWith('jev →'))).toEqual(['jev → opus (effort-up high)', 'jev → sonnet (keep-unknown-model)'])
})

test('with the effort switch off only the model moves', { options: { effort: false } }, async ($, on) => {
  let answer = jevBody('haiku', 0.95)
  const w = world(on, { jev: () => ok(answer), env: { JEV_ROUTING_LOG: LOG } })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  answer = jevBody('opus', 0.92)
  await turn($, 'design the migration strategy', SONNET, 't2')

  expect(w.steps.map(st => [st.model, st.effort])).toEqual([[HAIKU, 'medium'], [SONNET, 'medium']])
  expect(w.statuses.filter(st => st.startsWith('jev →'))).toEqual(['jev → haiku (routed)', 'jev → opus (keep-policy)'])
  const rows = w.files[LOG]!.trim().split('\n').map(l => JSON.parse(l))
  expect(rows.filter(r => r.ev === 'decision').map(r => r.effortSwitch)).toEqual([false, false])
})

test('the effort moves with the model down, and in its place when the policy keeps the model', async ($, on) => {
  let answer = jevBody('haiku', 0.95)
  const w = world(on, { jev: () => ok(answer) })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  answer = jevBody('opus', 0.92)
  await turn($, 'design the migration strategy', SONNET, 't2')
  await jev($, 'set policy both local')
  await turn($, 'design the migration strategy', SONNET, 't3') // routed up: the effort stays

  expect(w.steps.map(st => [st.model, st.effort])).toEqual([[HAIKU, 'low'], [SONNET, 'high'], [OPUS, 'medium']])
  expect(w.statuses.filter(st => st.startsWith('jev →'))).toEqual(['jev → haiku (routed, effort low)', 'jev → opus (effort-up high)', 'jev → opus (routed)'])
  expect((await jev($)).text).toContain('last: routed opus conf=0.92')
})

test('a session model without a tier word routes under policy both', { options: { policy: 'both' } }, async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('haiku', 0.95)) })
  await start($)
  await turn($, 'which file defines register?', ARN, 't1')

  expect(models(w)).toEqual([HAIKU])
})

test('subagent turns and steps pass through turn.step without asking Jev', async ($, on) => {
  const w = world(on)
  await start($)
  await begin($, 'a1', 'the agent brief', { agentId: 'agent-1' })
  await step($, 'a1', SONNET, { agentId: 'agent-1' })

  expect(w.fetches).toHaveLength(0)
  expect(w.steps).toEqual([{ model: SONNET, index: 0, agentId: 'agent-1', effort: 'medium' }])
})

test('a continuation turn, a slash command turn or a task notification has nothing to judge', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  await turn($, '', SONNET, 't2')
  await turn($, '/init', SONNET, 't3')
  await turn($, '<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n</task-notification>', SONNET, 't4')
  // The engine hands a slash command's turn over in these wrappers, its arguments included
  // (the first one as a real session's log recorded it, the arguments shortened).
  await turn($, '<command-message>docs:doc-mine</command-message>\n<command-name>/docs:doc-mine</command-name>\n<command-args>research az mcp 3.0</command-args>', SONNET, 't5')
  await turn($, '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>', SONNET, 't6')

  expect(w.prompts).toEqual(['which file defines register?'])
  expect(models(w)).toEqual([HAIKU, SONNET, SONNET, SONNET, SONNET, SONNET])
  expect(w.statuses.filter(s => s === 'jev → - (no-prompt)')).toHaveLength(5)
})

test('a prompt that starts with an absolute path is judged as text', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, '/Users/me/proj/a.ts throws on line 4, find the typo', SONNET, 't1')

  expect(w.prompts).toEqual(['/Users/me/proj/a.ts throws on line 4, find the typo'])
  expect(models(w)).toEqual([HAIKU])
})

// ── attachments ────────────────────────────────────────────────────────────

test('a prompt with an image keeps the session model and effort without asking Jev; the next text-only prompt is routed again', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, 'fix this', [{ type: 'image', mediaType: 'image/png' }])
  await turn($, 'fix this', SONNET, 't1')
  await submit($, 'which file defines register?')
  await turn($, 'which file defines register?', SONNET, 't2')

  expect(w.prompts).toEqual(['which file defines register?'])
  expect(models(w)).toEqual([SONNET, HAIKU])
  expect(w.steps[0]!.effort).toBe('medium')
  expect(w.statuses.filter(s => s.startsWith('jev →'))).toEqual(['jev → - (keep-attachment)', 'jev → haiku (routed, effort low)'])
})

test('an image without text is keep-attachment, not no-prompt; a document counts as well', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, '', [{ type: 'image', mediaType: 'image/png' }])
  await turn($, '', SONNET, 't1')
  await submit($, 'summarise this', [{ type: 'document', mediaType: 'application/pdf' }])
  await turn($, 'summarise this', SONNET, 't2')

  expect(w.fetches).toHaveLength(0)
  expect(models(w)).toEqual([SONNET, SONNET])
  expect(w.statuses.filter(s => s.startsWith('jev →'))).toEqual(['jev → - (keep-attachment)', 'jev → - (keep-attachment)'])
  expect((await jev($)).text).toContain('last: keep-attachment - conf=- 0ms (document attached; not judged)')
})

test('effort-only leaves the effort of a turn with an attachment alone', { options: { policy: 'effort-only' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, 'rename foo to bar as in the screenshot', [{ type: 'image' }])
  await turn($, 'rename foo to bar as in the screenshot', SONNET, 't1')

  expect(w.fetches).toHaveLength(0)
  expect(w.steps.map(s => [s.model, s.effort])).toEqual([[SONNET, 'medium']])
})

test('a dropped submission with an image is forgotten; the same text sent again is judged', async ($, on) => {
  const w = world(on, { drop: text => text === 'fix this' })
  await start($)
  await submit($, 'fix this', [{ type: 'image' }])
  await turn($, 'fix this', SONNET, 't1')

  expect(w.prompts).toEqual(['fix this'])
  expect(models(w)).toEqual([HAIKU])
})

test('a session that is off reports disabled for a turn with an image, not keep-attachment', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await submit($, 'fix this', [{ type: 'image' }])
  await turn($, 'fix this', SONNET, 't1')

  expect(w.fetches).toHaveLength(0)
  expect(models(w)).toEqual([SONNET])
  expect(last(w)).toBe('jev → - (disabled)')
})

test('a keep decision never overrides the model the engine resolved for a later step', async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('sonnet', 0.3)) })
  await start($)
  await begin($, 't1', 'anything')
  await step($, 't1', OPUS)
  await step($, 't1', SONNET, { index: 1 }) // the engine fell back

  expect(models(w)).toEqual([OPUS, SONNET])
})

test('a routed model that gives no response leaves the retry on the session model', async ($, on) => {
  const w = world(on, { step: e => (e.index === 0 ? { stopReason: null, usage: null } : {}) })
  await start($)
  await begin($, 't1', 'which file defines register?')
  await step($, 't1', SONNET)
  await step($, 't1', SONNET, { index: 1 })

  expect(models(w)).toEqual([HAIKU, SONNET])
  expect((await jev($)).text).toContain('(no response from claude-haiku-5-5; the turn stays on the session\'s model)')
})

// ── policy effort-only ─────────────────────────────────────────────────────

test('policy none keeps the model and lowers the effort for a haiku-tier prompt', { options: { policy: 'none' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await begin($, 't1', 'which file defines register?')
  await step($, 't1', SONNET)
  await step($, 't1', SONNET, { index: 1 })

  expect(w.steps.map(s => [s.model, s.effort])).toEqual([[SONNET, 'low'], [SONNET, 'low']])
  expect(last(w)).toBe('jev → haiku (effort-down low)')
  expect((await jev($)).text).toContain('last: effort-down haiku conf=0.95')
  expect((await jev($)).text).toContain('effort=low')
})

test('policy none raises the effort for an opus-tier prompt and leaves the session tier alone', { options: { policy: 'none' } }, async ($, on) => {
  let answer = jevBody('opus', 0.9)
  const w = world(on, { jev: () => ok(answer) })
  await start($)
  await turn($, 'design the migration strategy', SONNET, 't1')
  answer = jevBody('sonnet', 0.9)
  await turn($, 'write a test for parseSet', SONNET, 't2')

  expect(w.steps.map(s => [s.model, s.effort])).toEqual([[SONNET, 'high'], [SONNET, 'medium']])
  expect(w.statuses.filter(s => s.startsWith('jev →'))).toEqual(['jev → opus (effort-up high)', 'jev → sonnet (keep-same)'])
})

test('an effort that is already there, or that cannot be read, is left alone', { options: { policy: 'none' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1', { effort: 'low' })
  await turn($, 'which file defines register?', SONNET, 't2', { effort: 7 })

  expect(w.steps.map(s => [s.model, s.effort])).toEqual([[SONNET, 'low'], [SONNET, 7]])
  expect(w.statuses.filter(s => s.startsWith('jev →'))).toEqual(['jev → haiku (keep-policy)', 'jev → haiku (keep-policy)'])
})

// ── fable ──────────────────────────────────────────────────────────────────

test('a fable session routes down by tier like any other', async ($, on) => {
  let answer = jevBody('haiku', 0.95)
  const w = world(on, { jev: () => ok(answer) })
  await start($)
  await turn($, 'which file defines register?', FABLE, 't1')
  answer = jevBody('opus', 0.95)
  await turn($, 'design the migration strategy', FABLE, 't2')
  answer = jevBody('fable', 0.95)
  await turn($, 'build the whole workflow engine on your own', FABLE, 't3')

  expect(w.steps.map(st => [st.model, st.effort])).toEqual([[HAIKU, 'low'], [OPUS, 'medium'], [FABLE, 'medium']])
  expect(w.statuses.filter(st => st.startsWith('jev →'))).toEqual(['jev → haiku (routed, effort low)', 'jev → opus (routed)', 'jev → fable (keep-same)'])
})

test('a fable-tier prompt raises the effort where the policy keeps the model, and routes up under policy both', async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('fable', 0.9)) })
  await start($)
  await turn($, 'build the whole workflow engine on your own', OPUS, 't1')
  await turn($, 'build the whole workflow engine on your own', OPUS, 't2', { effort: 'xhigh' })
  await jev($, 'set policy both local')
  await turn($, 'build the whole workflow engine on your own', OPUS, 't3')

  expect(w.steps.map(st => [st.model, st.effort])).toEqual([[OPUS, 'high'], [OPUS, 'xhigh'], [FABLE, 'medium']])
  expect(w.statuses.filter(st => st.startsWith('jev →'))).toEqual(['jev → fable (effort-up high)', 'jev → fable (keep-policy)', 'jev → fable (routed)'])
})

test('an opus-tier prompt on a fable session never raises the effort', { options: { policy: 'none' } }, async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('opus', 0.9)) })
  await start($)
  await turn($, 'design the migration strategy', FABLE, 't1')

  expect(w.steps.map(st => [st.model, st.effort])).toEqual([[FABLE, 'medium']])
  expect(last(w)).toBe('jev → opus (keep-policy)')
})

test('the 0.1.0 value effort-only still parses, as policy none', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await jev($, 'set policy effort-only local')).text).toContain('set policy = none in local')
  expect(JSON.parse(w.files[LOCAL]!)).toEqual({ jevRouting: { policy: 'none' } })
  expect((await jev($)).text).toMatch(/policy\s+none\s+← local/)
})

// ── subagents ──────────────────────────────────────────────────────────────

test('a subagent brief that reads as a lookup sends the subagent to haiku', async ($, on) => {
  const w = world(on)
  await start($)
  const result = await spawn($, 'Find every file that imports parseSet and report the paths.')

  expect(w.prompts).toEqual(['Find every file that imports parseSet and report the paths.'])
  expect(Object.keys(w.fetches[0]!.state)).toEqual(['prompt'])
  expect(w.spawns).toEqual([{ model: HAIKU, prompt: 'Find every file that imports parseSet and report the paths.' }])
  expect(result).toEqual({ model: HAIKU, agentId: 'agent-1' })
  expect(last(w)).toBe('jev → haiku (routed, subagent)')
  expect((await jev($)).text).toContain('last subagent: routed haiku conf=0.95')
})

test('a subagent is never sent above the model it would have used under down-only', async ($, on) => {
  let answer = jevBody('opus', 0.95)
  const w = world(on, { jev: () => ok(answer) })
  await start($)
  await spawn($, 'Threat-model the settings layering and recommend mitigations.')
  answer = jevBody('sonnet', 0.95)
  await spawn($, 'Fix the failing test and keep the suite green.', { model: 'haiku' })

  expect(w.spawns.map(s => s.model)).toEqual([undefined, 'haiku'])
  expect(w.statuses.filter(s => s.startsWith('jev →'))).toEqual(['jev → opus (keep-policy, subagent)', 'jev → sonnet (keep-policy, subagent)'])
})

test('policy both routes a subagent up; policy none leaves subagents alone', async ($, on) => {
  const w = world(on, { jev: () => ok(jevBody('opus', 0.95)) })
  await start($)
  await jev($, 'set policy both local')
  await spawn($, 'Threat-model the settings layering and recommend mitigations.')
  await jev($, 'set policy none local')
  await spawn($, 'Threat-model the settings layering and recommend mitigations.')

  expect(w.spawns.map(s => s.model)).toEqual([OPUS, undefined])
  expect(w.statuses.filter(s => s.includes('subagent'))).toEqual(['jev → opus (routed, subagent)', 'jev → opus (keep-policy, subagent)'])
})

test('a resumed subagent or a fork keeps the model it has without asking Jev', async ($, on) => {
  const w = world(on, { env: { JEV_ROUTING_LOG: LOG } })
  await start($)
  await spawn($, 'Resend the part of your notes that was cut off.', { resume: { agentId: 'agent-1' } })
  await spawn($, 'Check the other half of the diff.', { fork: true, model: 'haiku' })

  expect(w.fetches).toHaveLength(0)
  expect(w.spawns.map(s => s.model)).toEqual([undefined, 'haiku'])
  expect(w.statuses.filter(s => s.includes('subagent'))).toEqual(['jev → - (keep-resume, subagent)', 'jev → - (keep-fork, subagent)'])
  // The log names the run a resume continues; a fork's model is its parent's, whatever the call named.
  const rows = w.files[LOG]!.trim().split('\n').map(l => JSON.parse(l)).filter(r => r.ev === 'agent.decision')
  expect(rows.map(r => [r.reason, r.resumedAgentId, r.model])).toEqual([['keep-resume', 'agent-1', SONNET], ['keep-fork', null, SONNET]])
})

test('a resumed subagent or a fork in a session that is off reports disabled', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, 'Resend the part of your notes that was cut off.', { resume: { agentId: 'agent-1' } })
  expect((await jev($)).text).toContain('last subagent: disabled')
  await spawn($, 'Check the other half of the diff.', { fork: true })
  expect((await jev($)).text).toContain('last subagent: disabled')
  expect(w.fetches).toHaveLength(0)
})

test('without a key a resumed subagent reports no-key', async ($, on) => {
  world(on, { env: { TYPESAFE_API_KEY: '' } })
  await start($)
  await spawn($, 'Resend the part of your notes that was cut off.', { resume: { agentId: 'agent-1' } })
  expect((await jev($)).text).toContain('last subagent: no-key')
})

test('subagents:false, a project file, or a session that is off leaves every spawn untouched', { options: { subagents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, 'Find every file that imports parseSet.')
  expect(w.fetches).toHaveLength(0)
  expect(w.spawns.map(s => s.model)).toEqual([undefined])

  expect((await jev($, 'set subagents true local')).text).toContain('set subagents = true in local')
  await spawn($, 'Find every file that imports parseSet.')
  expect(w.spawns.map(s => s.model)).toEqual([undefined, HAIKU])

  await jev($, 'off')
  await spawn($, 'Find every file that imports parseSet.')
  expect(w.fetches).toHaveLength(1)
  expect(w.spawns.map(s => s.model)).toEqual([undefined, HAIKU, undefined])
})

test('a project file cannot switch subagent routing on, a local file can', { options: { subagents: false } }, async ($, on) => {
  const w = world(on, { files: { [PROJECT]: JSON.stringify({ jevRouting: { subagents: true } }) } })
  await start($)
  await spawn($, 'Find every file that imports parseSet.')
  expect(w.fetches).toHaveLength(0)
  expect((await jev($)).text).toMatch(/subagents\s+false\s+← global/)

  w.files[LOCAL] = JSON.stringify({ jevRouting: { subagents: true } })
  await jev($, 'reload')
  await spawn($, 'Find every file that imports parseSet.')
  expect(w.fetches).toHaveLength(1)
})

// ── failures fall open ─────────────────────────────────────────────────────

test('an HTTP error or an unexpected body falls open', async ($, on) => {
  let answer: unknown = { value: { ok: false, status: 500, headers: {}, text: 'boom' } }
  const w = world(on, { jev: () => answer })
  await start($)
  await turn($, 'anything', SONNET, 't1')
  expect(models(w)).toEqual([SONNET])
  expect((await jev($)).text).toContain('last: error - conf=-')
  expect((await jev($)).text).toContain('(HTTP 500: boom)')

  answer = ok('{"answers":{}}')
  await turn($, 'anything else', SONNET, 't2')
  expect(models(w)).toEqual([SONNET, SONNET])
  expect((await jev($)).text).toContain('(unexpected body:')
})

test('a Jev call that hangs times out and falls open', async ($, on) => {
  const w = world(on, { jev: () => new Promise(() => { /* never */ }) })
  await start($)
  await begin($, 't1', 'anything')
  const pending = step($, 't1', SONNET)
  await w.clock.settle()
  await w.clock.advance(2_000)
  await pending

  expect(models(w)).toEqual([SONNET])
  expect((await jev($)).text).toContain('(timeout 2000ms)')
})

test('three Jev failures in a row pause the asking for five minutes; /jev on ends the pause early', async ($, on) => {
  let answer: unknown = { value: { ok: false, status: 429, headers: {}, text: 'quota exhausted' } }
  const w = world(on, { jev: () => answer })
  await start($)
  for (const t of ['t1', 't2', 't3']) await turn($, 'which file defines register?', SONNET, t)
  expect(w.fetches).toHaveLength(3)
  expect(models(w)).toEqual([SONNET, SONNET, SONNET])

  await turn($, 'which file defines register?', SONNET, 't4')
  expect(w.fetches).toHaveLength(3)
  expect(last(w)).toBe('jev → - (paused)')
  const text = (await jev($)).text
  expect(text).toContain('last: paused - conf=- 0ms (until ')
  expect(text).toContain('jev paused until ')
  expect(text).toContain('(HTTP 429: quota exhausted)')

  answer = ok(jevBody('haiku', 0.95))
  await w.clock.advance(5 * 60_000)
  await turn($, 'which file defines register?', SONNET, 't5')
  expect(w.fetches).toHaveLength(4)
  expect(models(w)[4]).toBe(HAIKU)

  answer = { value: { ok: false, status: 500, headers: {}, text: 'down' } }
  for (const t of ['t6', 't7', 't8']) await turn($, 'anything', SONNET, t)
  await turn($, 'anything', SONNET, 't9')
  expect(w.fetches).toHaveLength(7)
  expect((await jev($, 'on')).text).toContain('on for this session')
  answer = ok(jevBody('haiku', 0.95))
  await turn($, 'which file defines register?', SONNET, 't10')
  expect(w.fetches).toHaveLength(8)
  expect(models(w)[9]).toBe(HAIKU)
})

test('/jev status keeps a local tally of Jev calls and tokens with an estimated cost', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await jev($)).text).not.toContain('jev spend:')
  await turn($, 'which file defines register?', SONNET, 't1')
  await spawn($, 'Find every file that imports parseSet.')
  const text = (await jev($)).text
  expect(text).toContain('jev spend: 2 calls · 1000 input tokens ≈ US$0.00004 since ')
  expect(w.fetches).toHaveLength(2)
})

test('JEV_TIMEOUT_MS sets the timeout', async ($, on) => {
  const w = world(on, { env: { JEV_TIMEOUT_MS: '500' }, jev: () => new Promise(() => { /* never */ }) })
  await start($)
  await begin($, 't1', 'anything')
  const pending = step($, 't1', SONNET)
  await w.clock.settle()
  await w.clock.advance(500)
  await pending

  expect((await jev($)).text).toContain('(timeout 500ms)')
})

test('without an API key nothing is routed; the hint stays on the status line', async ($, on) => {
  const w = world(on, { env: { TYPESAFE_API_KEY: '' } })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  await spawn($, 'Find every file that imports parseSet.')

  expect(w.fetches).toHaveLength(0)
  expect(models(w)).toEqual([SONNET])
  expect(w.spawns.map(s => s.model)).toEqual([undefined])
  expect(w.statuses).toHaveLength(1)
  expect(w.statuses[0]).toContain('no API key')
  const text = (await jev($)).text
  expect(text).toContain('api_key: none')
  expect(text).toContain('last: no-key')
})

// ── the three layers ───────────────────────────────────────────────────────

test('a project settings file raises the gate; /jev status names the source', async ($, on) => {
  const w = world(on, {
    files: { [PROJECT]: JSON.stringify({ jevRouting: { min_confidence: 0.9 } }) },
    jev: () => ok(jevBody('haiku', 0.8)),
  })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')

  expect(models(w)).toEqual([SONNET])
  const text = (await jev($)).text
  expect(text).toMatch(/min_confidence\s+0\.9\s+← project/)
  expect(text).toMatch(/policy\s+down-only\s+← global/)
  expect(text).toContain('layers: local – · project ✓ · user-file – · global = /config')
})

test('a hand-written jevRouting key in the user settings file sits above /config', async ($, on) => {
  const w = world(on, {
    files: { [USER_FILE]: JSON.stringify({ jevRouting: { min_confidence: 0.9 } }) },
    jev: () => ok(jevBody('haiku', 0.8)),
  })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')

  expect(models(w)).toEqual([SONNET])
  expect((await jev($)).text).toMatch(/min_confidence\s+0\.9\s+← user-file/)
})

test('a project file can switch routing off but never on; the local file can', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { files: { [PROJECT]: JSON.stringify({ jevRouting: { enabled: true, policy: 'both', min_confidence: 0 } }) } })
  await start($)
  await turn($, 'hi', SONNET, 't1')
  expect(w.fetches).toHaveLength(0)
  expect((await jev($)).text).toMatch(/enabled\s+false\s+← global/)

  w.files[LOCAL] = JSON.stringify({ jevRouting: { enabled: true } })
  await jev($, 'reload')
  await turn($, 'hi', SONNET, 't2')
  expect(w.fetches).toHaveLength(1)
  expect((await jev($)).text).toMatch(/enabled\s+true\s+← local/)
})

test('a settings file with a byte-order mark is read and rewritten without it', async ($, on) => {
  const w = world(on, {
    files: { [PROJECT]: BOM + JSON.stringify({ jevRouting: { min_confidence: 0.9 } }) },
    jev: () => ok(jevBody('haiku', 0.8)),
  })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  expect(models(w)).toEqual([SONNET])

  expect((await jev($, 'set policy both project')).text).toContain('set policy = both in project')
  expect(w.files[PROJECT]!.charCodeAt(0)).not.toBe(0xfeff)
  expect(JSON.parse(w.files[PROJECT]!)).toEqual({ jevRouting: { min_confidence: 0.9, policy: 'both' } })
})

test('an unreadable settings file is shown as such and left alone', async ($, on) => {
  const w = world(on, { files: { [PROJECT]: '{ not json' } })
  await start($)
  const text = (await jev($)).text
  expect(text).toContain('layers: local – · project ✗ · user-file – · global = /config')
  expect(text).toContain(`project: the settings file does not parse (`)
  expect((await jev($, 'set policy both project')).text).toContain('does not parse')
  expect(w.files[PROJECT]).toBe('{ not json')
})

test('a Windows working directory is shown with forward slashes and the files resolve', async ($, on) => {
  const w = world(on)
  await start($, 'D:\\side_project\\x')
  expect((await jev($, 'set policy both local')).text).toContain('set policy = both in local (D:/side_project/x/.claude/settings.local.json)')
  expect(Object.keys(w.files)).toEqual(['/side_project/x/.claude/settings.local.json'])
})

// ── /jev set, unset, on, off ───────────────────────────────────────────────

test('/jev set and unset edit only the jevRouting key of the local file and apply at once', async ($, on) => {
  const w = world(on, {
    files: { [LOCAL]: JSON.stringify({ outputStyle: 'x' }) },
    jev: () => ok(jevBody('opus', 0.92)),
  })
  await start($)

  expect((await jev($, 'set policy both')).text).toContain(`set policy = both in local (${LOCAL})`)
  expect(JSON.parse(w.files[LOCAL]!)).toEqual({ outputStyle: 'x', jevRouting: { policy: 'both' } })
  await turn($, 'design the migration strategy', SONNET, 't1')
  expect(models(w)).toEqual([OPUS])

  expect((await jev($, 'unset policy local')).text).toContain(`unset in local (${LOCAL})`)
  expect(JSON.parse(w.files[LOCAL]!)).toEqual({ outputStyle: 'x' })
  await turn($, 'design the migration strategy', SONNET, 't2')
  expect(models(w)).toEqual([OPUS, SONNET])
})

test('/jev set to project writes the shared file; bad input is refused', async ($, on) => {
  const w = world(on)
  await start($)

  expect((await jev($, 'set min_confidence 0.8 project')).text).toContain(`set min_confidence = 0.8 in project (${PROJECT})`)
  expect(JSON.parse(w.files[PROJECT]!)).toEqual({ jevRouting: { min_confidence: 0.8 } })
  expect((await jev($, 'set api_key abc local')).text).toContain('api_key is set in /config or TYPESAFE_API_KEY')
  expect((await jev($, 'set policy sideways')).text).toContain('expected down-only | both | none')
  expect((await jev($, 'set min_confidence 0.5 global')).text).toContain('no /config row')
  expect((await jev($, 'dance')).text).toContain('unknown: "dance"')
  expect(Object.keys(w.files)).toEqual([PROJECT])
})

test('/jev set … global goes through the /config row of this plugin', async ($, on) => {
  const rows = [{ key: 'jev-routing.min_confidence', value: 0.6, kind: 'number', provider: 'plugin' }]
  const w = world(on, { configRows: rows })
  await start($)

  expect((await jev($, 'set min_confidence 0.8 global')).text).toContain('set min_confidence = 0.8 in global (/config, pluginConfigs)')
  expect(w.configSets).toEqual([{ key: 'jev-routing.min_confidence', value: 0.8 }])
  expect((await jev($)).text).toMatch(/min_confidence\s+0\.8\s+← global/)
})

test('/jev set … global reports a refusal or a failure from the engine', async ($, on) => {
  const rows = [{ key: 'jev-routing.policy', value: 'down-only', kind: 'string', provider: 'plugin' }]
  let answer: () => unknown = () => ({ deny: 'managed by your organization' })
  const w = world(on, { configRows: rows, configSet: () => answer() })
  await start($)

  expect((await jev($, 'set policy both global')).text).toContain('global policy refused: managed by your organization')
  answer = () => { throw new Error('offline') }
  expect((await jev($, 'set policy both global')).text).toContain('global policy failed:')
  expect(w.configSets).toHaveLength(2)
  expect((await jev($)).text).toMatch(/policy\s+down-only\s+← global/)
})

test('/jev on and off override the setting for the session, and clear when they match it', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  expect(w.fetches).toHaveLength(0)
  expect(last(w)).toBe('jev → - (disabled)')

  expect((await jev($, 'on')).text).toContain('on for this session')
  expect(w.state.session).toBe(true)
  await turn($, 'which file defines register?', SONNET, 't2')
  expect(models(w)).toEqual([SONNET, HAIKU])
  expect((await jev($)).text).toContain('on · routes each turn with Jev (session override; /jev off restores the setting)')

  expect((await jev($, 'off')).text).toContain('off for this session')
  expect(w.state.session).toBe(null)
  await turn($, 'which file defines register?', SONNET, 't3')
  expect(models(w)).toEqual([SONNET, HAIKU, SONNET])
  expect((await jev($)).text).toContain('off · routes each turn with Jev\n')
})

test('a later enabled setting is followed again after /jev on, and after /jev set enabled', async ($, on) => {
  const w = world(on)
  await start($)
  await jev($, 'off')
  await jev($, 'on') // back to following the settings
  expect(w.state.session).toBe(null)
  await jev($, 'set enabled false local')
  await turn($, 'hi', SONNET, 't1')
  expect(w.fetches).toHaveLength(0)

  await jev($, 'on') // an override again
  expect(w.state.session).toBe(true)
  await jev($, 'set enabled true local') // an explicit setting clears the override
  expect(w.state.session).toBe(null)
  await turn($, 'hi', SONNET, 't2')
  expect(w.fetches).toHaveLength(1)
})

test('the session override held in host state survives a reload of the module', async ($, on) => {
  const w = world(on, { state: false })
  await start($)
  await turn($, 'hi', SONNET, 't1')

  expect(w.fetches).toHaveLength(0)
  expect((await jev($)).text).toContain('off · routes each turn with Jev (session override; /jev on restores the setting)')
})

test('JEV_ROUTING=off starts the session off', async ($, on) => {
  const w = world(on, { env: { JEV_ROUTING: 'off' } })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  expect(w.fetches).toHaveLength(0)
  expect((await jev($)).text).toContain('off · routes each turn with Jev (session override; /jev on restores the setting)')
})

test('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 starts the session off', async ($, on) => {
  const w = world(on, { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  expect(w.fetches).toHaveLength(0)
  expect(models(w)).toEqual([SONNET])
})

// ── language ───────────────────────────────────────────────────────────────

test('the language setting picks the sentences; identifiers stay', { options: { language: 'zh-TW' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  const text = (await jev($)).text
  expect(text).toContain('開 · 每一輪都用 Jev 挑模型')
  expect(text).toMatch(/min_confidence\s+0\.6\s+← global/)
  expect(text).toContain('最近一次: routed haiku conf=0.95')
  expect(w.statuses).toContain('jev → haiku (routed, effort low)')

  expect((await jev($, 'set policy sideways')).text).toContain('不是 policy 的合法值')
  expect((await jev($, 'off')).text).toContain('這個 session 關閉')
  expect((await jev($, 'dance')).text).toContain('不認識「dance」')
})

test('auto follows Claude Code\'s language setting, then the locale, then English', async ($, on) => {
  world(on, { settings: { language: 'zh-tw' } })
  await start($)
  expect((await jev($)).text).toContain('開 · 每一輪都用 Jev 挑模型')
})

test('auto reads the locale when Claude Code names no language', async ($, on) => {
  world(on, { env: { LANG: 'zh_TW.UTF-8' } })
  await start($)
  expect((await jev($)).text).toContain('開 · 每一輪都用 Jev 挑模型')
  expect((await jev($, 'set language en local')).text).toContain('set language = en in local')
  expect((await jev($)).text).toContain('on · routes each turn with Jev')
})

test('English when nothing names a language', async ($, on) => {
  world(on)
  await start($)
  expect((await jev($)).text).toContain('on · routes each turn with Jev')
})

// ── the optional log ───────────────────────────────────────────────────────

test('the log records decisions and command verbs, never the arguments of a command', async ($, on) => {
  const w = world(on, { env: { JEV_ROUTING_LOG: LOG } })
  await start($)
  await turn($, 'which file defines register?', SONNET, 't1')
  await spawn($, 'Find every file that imports parseSet.')
  expect((await jev($, 'set api_key sk-live-SECRET123 local')).text).toContain('api_key')
  await jev($, 'set policy both local')

  const text = w.files[LOG]
  expect(text).toContain('"ev":"module.load"')
  expect(text).toContain('"ev":"decision"')
  expect(text).toContain('"ev":"agent.decision"')
  expect(text).toContain('"reason":"routed"')
  expect(text).toContain('"prompt":"which file defines register?"')
  expect(text).toContain('"verb":"set","key":"policy","scope":"local"')
  expect(text).not.toContain('SECRET123')
  expect(text).not.toContain('test-key')
  // Each decision says whether the effort switch was on, beside the policy.
  const rows = text!.trim().split('\n').map(l => JSON.parse(l))
  expect(rows.filter(r => r.ev === 'decision' || r.ev === 'agent.decision').map(r => [r.policy, r.effortSwitch])).toEqual([['down-only', true], ['down-only', true]])
  // A subagent's row also says which model the engine started it on.
  expect(rows.filter(r => r.ev === 'agent.decision').map(r => [r.reason, r.model, r.startedModel])).toEqual([['routed', 'claude-haiku-5-5', 'claude-haiku-5-5']])
})

test('a log file that cannot be read back is left alone; a sibling file is started', async ($, on) => {
  const w = world(on, { env: { JEV_ROUTING_LOG: LOG }, files: { [LOG]: '{"ev":"OLD"}\n' }, readFails: LOG })
  await start($)

  expect(w.files[LOG]).toBe('{"ev":"OLD"}\n')
  const sibling = Object.keys(w.files).find(p => p.startsWith(`${LOG}.`) && p.endsWith('.jsonl'))
  expect(sibling).toBeDefined()
  expect(w.files[sibling!]).toContain('"ev":"session.start"')
})

test('/jev panel opens the panel in an interactive session and prints the status headless; /jev band hides for the session', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await jev($, 'panel')).text).toContain('no panel here; this is the status:\non · routes each turn with Jev')
  expect(w.statuses).not.toContain('open:jev')

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await jev($, 'panel')).text).toContain('Jev routing panel opened')
  expect(w.statuses).toContain('open:jev')

  expect((await jev($, 'band off')).text).toContain('band hidden for this session')
  expect(w.state.bandHidden).toBe(true)
  expect((await jev($, 'band on')).text).toContain('band shown for this session')
  expect(w.state.bandHidden).toBe(false)
  expect((await jev($, 'band sideways')).text).toContain('usage: /jev band on | off')
})

test('a log file that exists is appended to across module loads', async ($, on) => {
  const w = world(on, { env: { JEV_ROUTING_LOG: LOG }, files: { [LOG]: '{"ev":"OLD"}\n' } })
  await start($)

  const lines = w.files[LOG]!.trim().split('\n')
  expect(lines[0]).toBe('{"ev":"OLD"}')
  expect(lines[1]).toContain('"ev":"module.load"')
  expect(lines[2]).toContain('"ev":"session.start"')
})
