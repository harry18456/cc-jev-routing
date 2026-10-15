import { test, expect, describe } from 'claude-code/testing'
import { DEFAULTS, SETTINGS_KEY, editSettingsText, effortFor, layerValues, parseSet, parseUnset, pickValid, resolve, statusText, type Layer } from './config.ts'

// The pure rules of config.ts: no `$`, no session, no disk.

describe('pickValid', () => {
  test('keeps only known keys with values that parse', async () => {
    expect(pickValid({ min_confidence: '0.8', policy: 'both', enabled: 'false', api_key: 'x', junk: 1 }))
      .toEqual({ min_confidence: 0.8, policy: 'both', enabled: false })
  })
  test('drops values out of range or of the wrong kind', async () => {
    expect(pickValid({ min_confidence: 1.5, policy: 'sideways', enabled: 'yes', subagents: 1 })).toEqual({})
    expect(pickValid(null)).toEqual({})
    expect(pickValid('text')).toEqual({})
  })
  test('knows the third policy and the subagents switch', async () => {
    expect(pickValid({ policy: 'effort-only', subagents: 'false' })).toEqual({ policy: 'effort-only', subagents: false })
  })
  test('reads the language in its usual spellings and refuses the rest', async () => {
    expect(pickValid({ language: 'zh-tw' })).toEqual({ language: 'zh-TW' })
    expect(pickValid({ language: 'EN' })).toEqual({ language: 'en' })
    expect(pickValid({ language: 'Auto' })).toEqual({ language: 'auto' })
    expect(pickValid({ language: 'ja' })).toEqual({})
    expect(parseSet('language fr')).toMatchObject({ error: expect.stringContaining('auto | en | zh-TW') })
  })
})

describe('layerValues', () => {
  test('a project file can switch routing and subagents off but never on', async () => {
    expect(layerValues('project', { enabled: true, subagents: true, policy: 'both' })).toEqual({ policy: 'both' })
    expect(layerValues('project', { enabled: false, subagents: false })).toEqual({ enabled: false, subagents: false })
  })
  test('the local file and the user file keep both directions', async () => {
    expect(layerValues('local', { enabled: true, subagents: true })).toEqual({ enabled: true, subagents: true })
    expect(layerValues('user-file', { enabled: true })).toEqual({ enabled: true })
  })
})

describe('effortFor', () => {
  test('haiku lowers to low, opus raises to high, each only in its direction', async () => {
    expect(effortFor('haiku', 'medium')).toBe('low')
    expect(effortFor('haiku', 'max')).toBe('low')
    expect(effortFor('haiku', 'low')).toBe(null)
    expect(effortFor('opus', 'medium')).toBe('high')
    expect(effortFor('opus', 'high')).toBe(null)
    expect(effortFor('opus', 'max')).toBe(null)
    expect(effortFor('sonnet', 'medium')).toBe(null)
  })
  test('an unknown or numeric effort is left alone', async () => {
    expect(effortFor('haiku', undefined)).toBe(null)
    expect(effortFor('haiku', 42)).toBe(null)
    expect(effortFor('opus', 'turbo')).toBe(null)
  })
})

describe('resolve', () => {
  const layers: Layer[] = [
    { name: 'local', values: { min_confidence: 0.5 }, path: '/p/.claude/settings.local.json', isPresent: true },
    { name: 'project', values: { min_confidence: 0.7, policy: 'both' }, path: '/p/.claude/settings.json', isPresent: true },
    { name: 'user-file', values: {}, path: '/h/.claude/settings.json', isPresent: false },
    { name: 'global', values: { enabled: true, min_confidence: 0.9 }, isPresent: true },
  ]
  test('the highest layer that sets a key wins, per key', async () => {
    const { effective, source } = resolve(layers)
    expect(effective).toEqual({ min_confidence: 0.5, policy: 'both', enabled: true, subagents: true, band: true, language: 'auto' })
    expect(source).toEqual({ min_confidence: 'local', policy: 'project', enabled: 'global', subagents: 'defaults', band: 'defaults', language: 'defaults' })
  })
  test('no layers means the defaults', async () => {
    const { effective, source } = resolve([])
    expect(effective).toEqual(DEFAULTS)
    expect(source).toEqual({ min_confidence: 'defaults', policy: 'defaults', enabled: 'defaults', subagents: 'defaults', band: 'defaults', language: 'defaults' })
  })
})

describe('parseSet', () => {
  test('parses key, value and scope; the scope defaults to local', async () => {
    expect(parseSet('min_confidence 0.8')).toEqual({ key: 'min_confidence', value: 0.8, scope: 'local' })
    expect(parseSet('policy both project')).toEqual({ key: 'policy', value: 'both', scope: 'project' })
    expect(parseSet('enabled false global')).toEqual({ key: 'enabled', value: false, scope: 'global' })
  })
  test('refuses api_key, unknown keys, bad values and bad scopes', async () => {
    expect(parseSet('api_key abc local')).toMatchObject({ error: expect.stringContaining('api_key') })
    expect(parseSet('colour red')).toMatchObject({ error: expect.stringContaining('unknown key') })
    expect(parseSet('policy sideways')).toMatchObject({ error: expect.stringContaining('down-only | both') })
    expect(parseSet('min_confidence 2')).toMatchObject({ error: expect.stringContaining('0 to 1') })
    expect(parseSet('enabled true nowhere')).toMatchObject({ error: expect.stringContaining('scope') })
    expect(parseSet('')).toMatchObject({ error: expect.stringContaining('usage') })
  })
})

describe('parseUnset', () => {
  test('local by default, project allowed, global refused', async () => {
    expect(parseUnset('min_confidence')).toEqual({ key: 'min_confidence', scope: 'local' })
    expect(parseUnset('policy project')).toEqual({ key: 'policy', scope: 'project' })
    expect(parseUnset('policy global')).toMatchObject({ error: expect.stringContaining('/config') })
    expect(parseUnset('nope')).toMatchObject({ error: expect.stringContaining('usage') })
  })
})

describe('editSettingsText', () => {
  test('creates the section in an empty or missing file', async () => {
    const r = editSettingsText(null, 'min_confidence', 0.8)
    expect('text' in r && JSON.parse(r.text)).toEqual({ [SETTINGS_KEY]: { min_confidence: 0.8 } })
  })
  test('keeps every other key of the file and of the section', async () => {
    const before = JSON.stringify({ outputStyle: 'x', [SETTINGS_KEY]: { policy: 'both' } })
    const r = editSettingsText(before, 'min_confidence', 0.8)
    expect('text' in r && JSON.parse(r.text)).toEqual({ outputStyle: 'x', [SETTINGS_KEY]: { policy: 'both', min_confidence: 0.8 } })
  })
  test('removes the section when its last key is unset', async () => {
    const before = JSON.stringify({ outputStyle: 'x', [SETTINGS_KEY]: { policy: 'both' } })
    const r = editSettingsText(before, 'policy', undefined)
    expect('text' in r && JSON.parse(r.text)).toEqual({ outputStyle: 'x' })
  })
  test('leaves a broken or non-object file alone', async () => {
    expect(editSettingsText('{ not json', 'policy', 'both')).toMatchObject({ error: expect.stringContaining('does not parse') })
    expect(editSettingsText('[1,2]', 'policy', 'both')).toMatchObject({ error: expect.stringContaining('not a JSON object') })
  })
})

describe('statusText', () => {
  test('names the effective value and its source per key, and the session override', async () => {
    const layers: Layer[] = [
      { name: 'local', values: {}, path: '/p/.claude/settings.local.json', isPresent: false },
      { name: 'project', values: { policy: 'both' }, path: '/p/.claude/settings.json', isPresent: true },
      { name: 'user-file', values: {}, path: '/h/.claude/settings.json', isPresent: true },
      { name: 'global', values: { min_confidence: 0.9, policy: 'down-only', enabled: true }, isPresent: true },
    ]
    const text = statusText({ layers, sessionEnabled: false, keySource: 'env', last: 'routed haiku conf=1 300ms' })
    expect(text).toContain('off · routes each turn with Jev (session override; /jev on restores the setting)')
    expect(text).toMatch(/min_confidence\s+0\.9\s+← global/)
    expect(text).toMatch(/policy\s+both\s+← project/)
    expect(text).toContain('layers: local – · project ✓ · user-file ✓ · global = /config')
    expect(text).toContain('api_key: env')
    expect(text).toContain('last: routed haiku conf=1 300ms')
    expect(text).not.toContain('last subagent')
    expect(statusText({ layers, sessionEnabled: null, keySource: 'env', last: null, lastAgent: null })).toContain('last subagent: none yet')
  })
  test('says how to set the key when there is none', async () => {
    const text = statusText({ layers: [], sessionEnabled: null, keySource: 'none', last: null })
    expect(text).toContain('on · routes each turn with Jev')
    expect(text).toContain('api_key: none (set it in /config or export TYPESAFE_API_KEY')
    expect(text).toContain('last: no decision yet')
  })
})
