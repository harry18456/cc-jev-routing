import { test, expect, mock } from 'claude-code/testing'

// The band above the prompt and the /jev panel, mounted the way a surface
// mounts them. Host state is the kit's own here (not mocked), so a button
// press draws the instance again.

const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const LOCAL = '/repo/.claude/settings.local.json'
const PROJECT = '/repo/.claude/settings.json'

const jevBody = (choice: string, confidence: number) =>
  JSON.stringify({ answers: { tier: { choice, confidence, probabilities: { haiku: 0, sonnet: 0, opus: 0, [choice]: confidence } } }, usage: { input_tokens: 500 } })
const ok = (text: string) => ({ value: { ok: true, status: 200, headers: {}, text } })

function world(on: any, options: { env?: Record<string, string>; files?: Record<string, string>; jev?: () => unknown; settings?: Record<string, unknown> } = {}) {
  const w = {
    files: { ...(options.files ?? {}) } as Record<string, string>,
    steps: [] as string[],
    statuses: [] as string[],
    opened: [] as string[],
    toasts: [] as string[],
    clock: mock.clock(on, { now: 1_000 }),
  }
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', USERPROFILE: '/home/me', ...(options.env ?? {}) })
  mock.store(on, {})
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('fs.exists', ($: any, e: any) => ({ value: norm(e.path) in w.files }))
  on('fs.read', ($: any, e: any) => ({ value: w.files[norm(e.path)] ?? '' }))
  on('fs.write', ($: any, e: any) => { w.files[norm(e.path)] = e.text; return { value: undefined } })
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('ui.status', ($: any, e: any) => { w.statuses.push(e.text); return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { w.toasts.push(String(e.text ?? e.message ?? JSON.stringify(e))); return { value: undefined } })
  on('ui.open', ($: any, e: any) => { w.opened.push(e.id); return { value: { id: e.id } } })
  on('config.list', () => ({ value: [] }))
  on('session.messages', () => ({ value: [] }))
  on('settings.read', () => ({ value: options.settings ?? {} }))
  on('http.fetch', () => (options.jev ? options.jev() : ok(jevBody('haiku', 0.95))))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($: any, e: any) {
    w.steps.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  // The engine's own band, drawn when ours yields: an empty Box.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }) as any)
  return w
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as any
const PANE = { title: 'Jev routing', isFocused: true, bodyColumns: 64, placement: 'inline' } as any
const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
const jev = ($: any, args = 'status') => $.command.run({ command: 'jev', args })
const mountBand = ($: any, props: any = BAND) => $.ui.mount({ plugin: 'jev-routing', surface: 'terminal', component: 'AbovePrompt', props })
const mountPane = ($: any) => $.ui.mount({ plugin: 'jev-routing', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'jev' })
async function turn($: any, prompt: string, turnId: string) {
  await $.turn.start({ turnId, text: prompt })
  const stream = $.turn.step({ turnId, index: 0, model: SONNET, effort: 'medium', messageCount: 1 })
  for await (const _chunk of stream) { /* drain */ }
  await stream.result
  await $.turn.complete({ turnId, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
}
const bandText = async (ui: any) => (await ui.find({ type: 'Text', text: /jev ▸/ }))?.text

test('the band shows the state and the last decision; its button turns routing off and back on', async ($, on) => {
  const w = world(on)
  await start($)
  const band = await mountBand($)
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on')
  expect((await band.find({ key: 'toggle' }))?.props.label).toBe('off')
  expect((await band.find({ key: 'open' }))?.type).toBe('Button')
  expect((await band.find({ key: 'hide' }))?.type).toBe('Button')

  await turn($, 'which file defines register?', 't1')
  expect(w.steps).toEqual([HAIKU])
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on · haiku (routed) 0.95')
  expect((await (await mountPane($)).find({ type: 'Text', text: /jev spend: 1 calls · 500 input tokens/ }))).toBeDefined()

  await band.press({ key: 'toggle' })
  expect(await bandText(band)).toBe('jev ▸ off · down-only · effort on')
  expect((await band.find({ key: 'toggle' }))?.props.label).toBe('on')
  expect((await jev($)).text).toContain('off · routes each turn with Jev (session override; /jev on restores the setting)')
  await turn($, 'which file defines register?', 't2')
  expect(w.steps).toEqual([HAIKU, SONNET])

  await band.press({ key: 'toggle' })
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on · - (disabled)')
  expect((await jev($)).text).toContain('on · routes each turn with Jev\n')
})

test('the band shows the effort switch, so sessions that differ only there look different', async ($, on) => {
  world(on)
  await start($)
  const band = await mountBand($)
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on')
  await jev($, 'set effort false local')
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort off')
})

test('the settings button opens the panel', async ($, on) => {
  const w = world(on)
  await start($)
  const band = await mountBand($)
  await band.press({ key: 'open' })
  expect(w.opened).toEqual(['jev'])
})

test('the band yields to the survey, to band:false and to its own hide button', { options: { band: false } }, async ($, on) => {
  world(on)
  await start($)
  expect(await bandText(await mountBand($))).toBe(undefined)

  await jev($, 'set band true local')
  const band = await mountBand($)
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on')
  expect(await bandText(await mountBand($, { ...BAND, hasSurvey: true }))).toBe(undefined)

  await band.press({ key: 'hide' })
  expect(await bandText(band)).toBe(undefined)
  await jev($, 'band on')
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on')
})

test('without a key the band says where to set it and offers no toggle', async ($, on) => {
  world(on, { env: { TYPESAFE_API_KEY: '' } })
  await start($)
  const band = await mountBand($)
  expect(await bandText(band)).toBe('jev ▸ no API key · /config → TypeSafe API key')
  expect(await band.find({ key: 'toggle' })).toBe(undefined)
  expect((await band.find({ key: 'open' }))?.type).toBe('Button')
})

test('the panel shows every setting with its source; its buttons write the local file, or the project file on request', async ($, on) => {
  const w = world(on, { files: { [LOCAL]: JSON.stringify({ outputStyle: 'x' }) } })
  await start($)
  const pane = await mountPane($)
  const row = async (re: RegExp) => (await pane.find({ type: 'Text', text: re }))?.text
  expect(await row(/^Jev routing · on$/)).toBe('Jev routing · on')
  expect(await row(/policy\s+down-only\s+← global/)).toBeDefined()
  expect(await row(/effort\s+true\s+← global/)).toBeDefined()
  expect(await row(/min_confidence\s+0\.6\s+← global/)).toBeDefined()
  expect(await row(/subagents\s+true\s+← global/)).toBeDefined()
  expect(await row(/band\s+shown\s+← global/)).toBeDefined()
  expect(await row(/key: env · last: no decision yet · subagent: none yet/)).toBeDefined()
  expect(await row(/buttons 2–7 write to local: \/repo\/\.claude\/settings\.local\.json/)).toBeDefined()

  await pane.press({ key: 'policy' })
  expect(JSON.parse(w.files[LOCAL]!)).toEqual({ outputStyle: 'x', jevRouting: { policy: 'both' } })
  expect(await row(/policy\s+both\s+← local/)).toBeDefined()
  expect((await pane.find({ key: 'policy' }))?.props.label).toBe('next: none')

  await pane.press({ key: 'conf-down' })
  expect(await row(/min_confidence\s+0\.5\s+← local/)).toBeDefined()
  await pane.press({ key: 'conf-up' })
  await pane.press({ key: 'conf-up' })
  expect(await row(/min_confidence\s+0\.7\s+← local/)).toBeDefined()

  await pane.press({ key: 'subagents' })
  expect(await row(/subagents\s+false\s+← local/)).toBeDefined()
  await pane.press({ key: 'effort' })
  expect(await row(/effort\s+false\s+← local/)).toBeDefined()
  expect((await pane.find({ key: 'effort' }))?.props.label).toBe('turn on')
  expect(JSON.parse(w.files[LOCAL]!).jevRouting).toEqual({ policy: 'both', min_confidence: 0.7, subagents: false, effort: false })

  await pane.press({ key: 'scope' })
  expect(await row(/buttons 2–7 write to project: \/repo\/\.claude\/settings\.json/)).toBeDefined()
  await pane.press({ key: 'policy' })
  expect(JSON.parse(w.files[PROJECT]!)).toEqual({ jevRouting: { policy: 'none' } })
  expect(await row(/policy\s+both\s+← local/)).toBeDefined() // local still wins over project

  await pane.press({ key: 'toggle' })
  expect(await row(/^Jev routing · off \(session override\)$/)).toBeDefined()
  expect((await jev($)).text).toContain('off · routes each turn with Jev (session override')
  expect(w.toasts).toEqual([])
})

test('the panel hides and shows the band; a band turned off by its setting is turned on again by the button', { options: { band: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  const pane = await mountPane($)
  const band = await mountBand($)
  expect(await bandText(band)).toBe(undefined)
  expect((await pane.find({ key: 'band' }))?.props.label).toBe('show')

  await pane.press({ key: 'band' })
  expect(JSON.parse(w.files[LOCAL]!)).toEqual({ jevRouting: { band: true } })
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on')
  expect((await pane.find({ key: 'band' }))?.props.label).toBe('hide')

  await pane.press({ key: 'band' })
  expect(await bandText(band)).toBe(undefined)
  expect((await pane.find({ type: 'Text', text: /band\s+hidden/ }))).toBeDefined()
})

test('a refused write shows as a toast, not a crash', async ($, on) => {
  const w = world(on, { files: { [LOCAL]: '{ not json' } })
  await start($)
  const pane = await mountPane($)
  await pane.press({ key: 'policy' })
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('does not parse')
  expect(w.files[LOCAL]).toBe('{ not json')
})

test('the band and the panel speak the chosen language', { options: { language: 'zh-TW' } }, async ($, on) => {
  world(on)
  await start($)
  const band = await mountBand($)
  expect(await bandText(band)).toBe('jev ▸ 開 · down-only · effort 開')
  expect((await band.find({ key: 'toggle' }))?.props.label).toBe('關')
  expect((await band.find({ key: 'open' }))?.props.label).toBe('設定')
  expect((await band.find({ key: 'hide' }))?.props.label).toBe('隱藏')

  const pane = await mountPane($)
  expect((await pane.find({ type: 'Text', text: /Jev 路由 · 開/ }))?.text).toBe('Jev 路由 · 開')
  expect((await pane.find({ key: 'policy' }))?.props.label).toBe('下一個：both')
  expect((await pane.find({ type: 'Text', text: /按鈕 2–7 寫到 local/ }))).toBeDefined()
  await band.press({ key: 'toggle' })
  expect(await bandText(band)).toBe('jev ▸ 關 · down-only · effort 開')
  expect((await pane.find({ type: 'Text', text: /Jev 路由 · 關（session 覆寫）/ }))).toBeDefined()
})

test('outside full-screen rendering the band and the panel point at /tui fullscreen; in it they stay quiet', async ($, on) => {
  world(on, { settings: { tui: 'default' } })
  await start($)
  const band = await mountBand($)
  expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on · /tui fullscreen works better here (docked panel, mouse)')
  const pane = await mountPane($)
  expect((await pane.find({ type: 'Text', text: /\/tui fullscreen/ }))?.props.color).toBe('yellow')
})

test('with tui fullscreen, or no tui setting at all, there is no hint', async ($, on) => {
  world(on, { settings: { tui: 'fullscreen' } })
  await start($)
  expect(await bandText(await mountBand($))).toBe('jev ▸ on · down-only · effort on')
  expect(await (await mountPane($)).find({ type: 'Text', text: /\/tui fullscreen/ })).toBe(undefined)
})

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`the band and the panel draw on ${surface}`, async ($, on) => {
    world(on)
    await start($)
    const band = await $.ui.mount({ plugin: 'jev-routing', surface, component: 'AbovePrompt', props: BAND })
    expect(await bandText(band)).toBe('jev ▸ on · down-only · effort on')
    const pane = await $.ui.mount({ plugin: 'jev-routing', surface, component: 'Pane', props: PANE, requestId: 'jev' })
    expect((await pane.find({ type: 'Text', text: /Jev routing/ }))?.text).toBe('Jev routing · on')
  })
}
