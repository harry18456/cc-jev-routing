import { test, expect, describe } from 'claude-code/testing'
import { LANGS, STRINGS, normalizeLang, pickLang } from './i18n.ts'

describe('normalizeLang', () => {
  test('reads the spellings Claude Code, the OS and people use', async () => {
    expect(normalizeLang('zh-tw')).toBe('zh-TW')
    expect(normalizeLang('zh-TW')).toBe('zh-TW')
    expect(normalizeLang('zh-Hant')).toBe('zh-TW')
    expect(normalizeLang('zh_TW.UTF-8')).toBe('zh-TW')
    expect(normalizeLang('zh')).toBe('zh-TW')
    expect(normalizeLang('en')).toBe('en')
    expect(normalizeLang('en-US')).toBe('en')
    expect(normalizeLang('en_US.UTF-8')).toBe('en')
  })
  test('leaves everything else alone', async () => {
    expect(normalizeLang('ja')).toBe(null)
    expect(normalizeLang('')).toBe(null)
    expect(normalizeLang(undefined)).toBe(null)
    expect(normalizeLang(42)).toBe(null)
    expect(normalizeLang('english')).toBe(null)
  })
})

describe('pickLang', () => {
  test('the setting first, then Claude Code, then the locale, then English', async () => {
    expect(pickLang('en', 'zh-tw', 'zh_TW.UTF-8')).toBe('en')
    expect(pickLang('auto', 'zh-tw', 'en_US.UTF-8')).toBe('zh-TW')
    expect(pickLang('auto', undefined, 'zh_TW.UTF-8')).toBe('zh-TW')
    expect(pickLang('auto', 'ja', 'ja_JP.UTF-8')).toBe('en')
    expect(pickLang(undefined, undefined, undefined)).toBe('en')
  })
})

describe('the string tables', () => {
  test('every language answers every key with the same shape', async () => {
    const keys = Object.keys(STRINGS.en).sort()
    for (const lang of LANGS) {
      expect(Object.keys(STRINGS[lang]).sort()).toEqual(keys)
      for (const k of keys) expect(typeof (STRINGS[lang] as any)[k]).toBe(typeof (STRINGS.en as any)[k])
    }
  })
  test('identifiers survive translation', async () => {
    const zh = STRINGS['zh-TW']
    expect(zh.setDone('policy', 'both', 'local', '/p/.claude/settings.local.json')).toContain('policy = both')
    expect(zh.statusHeader(false, true, 'on')).toContain('/jev on')
    expect(zh.unknownKey('colour', 'min_confidence, policy')).toContain('min_confidence, policy')
    expect(zh.paneWrites('project', '/p/.claude/settings.json')).toContain('/p/.claude/settings.json')
  })
})
