// Every sentence the person sees, in English and Traditional Chinese. Keys,
// reasons, tiers, layer names and paths stay as they are in both: they are
// identifiers the README and the log use too. No `$` here.

export type Lang = 'en' | 'zh-TW'
export const LANGS: readonly Lang[] = ['en', 'zh-TW']

// `zh`, `zh-tw`, `zh-Hant`, `zh_TW.UTF-8` … → zh-TW; `en`, `en-US`, `en_US.UTF-8` → en; anything else → null.
export function normalizeLang(raw: unknown): Lang | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (v === '') return null
  if (/^zh\b|^zh[-_]/.test(v)) return 'zh-TW'
  if (/^en\b|^en[-_]/.test(v)) return 'en'
  return null
}

// The language the mod speaks: the setting when it names one, otherwise Claude
// Code's own `language` setting, otherwise the environment's locale, otherwise English.
export function pickLang(setting: unknown, claudeLanguage: unknown, envLocale: unknown): Lang {
  return normalizeLang(setting) ?? normalizeLang(claudeLanguage) ?? normalizeLang(envLocale) ?? 'en'
}

export type Strings = {
  // the command's menu entry
  commandDescription: string
  // status (/jev status)
  statusHeader: (isOn: boolean, override: boolean, restoreVerb: 'on' | 'off') => string
  statusLayers: (files: string) => string
  statusKeyNone: string
  statusLast: (last: string | null) => string
  statusLastAgent: (last: string | null) => string
  effective: (parts: string) => string
  onOff: (isOn: boolean) => string
  // command replies
  sessionSwitched: (isOn: boolean) => string
  panelOpened: string
  noPanel: string
  bandUsage: string
  bandSwitched: (shown: boolean) => string
  reloaded: string
  unknownVerb: (verb: string) => string
  setDone: (key: string, value: string, scope: string, path: string) => string
  unsetDone: (scope: string, path: string) => string
  setGlobalDone: (key: string, value: string) => string
  noGlobalRow: (key: string) => string
  globalRefused: (key: string, why: string) => string
  globalFailed: (key: string, why: string) => string
  noCwd: string
  cannotRead: (path: string, why: string) => string
  // parse errors (config.ts)
  setUsage: (keys: string, scopes: string) => string
  unknownKey: (key: string, keys: string) => string
  badValue: (raw: string, key: string, hint: string) => string
  badScope: (scopes: string) => string
  unsetUsage: (keys: string) => string
  unsetGlobal: string
  unsetScope: string
  notJsonObject: string
  doesNotParse: (why: string) => string
  notTouching: string
  cannotReadFile: (why: string) => string
  // the band
  bandNoKey: string
  bandToggle: (isOn: boolean) => string
  bandSettings: string
  bandHide: string
  // the panel
  paneTitle: (isOn: boolean, override: boolean) => string
  paneToggle: (isOn: boolean) => string
  paneNext: (policy: string) => string
  paneBandValue: (state: 'shown' | 'hidden' | 'off') => string
  paneBandButton: (visible: boolean) => string
  paneLast: (key: string, last: string | null, agent: string | null) => string
  paneWrites: (scope: string, path: string) => string
  paneScopeButton: (other: string) => string
  paneFooter: string
  // the status line
  statusLineSwitched: (isOn: boolean, override: boolean) => string
  statusLineNoKey: string
  // shown while the session is not in full-screen rendering, where the panel docks and the mouse works
  tuiHint: string
  // the running tally of Jev calls, kept locally (TypeSafe exposes no balance endpoint)
  statusSpend: (calls: number, tokens: number, usd: string, since: string) => string
  // Jev paused after repeated failures; `until` is a clock time
  statusPaused: (until: string, why: string) => string
}

const en: Strings = {
  commandDescription: 'Jev model routing: status · panel · on · off · band on|off · set <key> <value> [local|project|global] · unset <key> [local|project] · reload',
  statusHeader: (isOn, override, restoreVerb) => `${isOn ? 'on' : 'off'} · routes each turn with Jev${override ? ` (session override; /jev ${restoreVerb} restores the setting)` : ''}`,
  statusLayers: files => `layers: ${files} · global = /config`,
  statusKeyNone: ' (set it in /config or export TYPESAFE_API_KEY; nothing is routed until then)',
  statusLast: last => `last: ${last ?? 'no decision yet'}`,
  statusLastAgent: last => `last subagent: ${last ?? 'none yet'}`,
  effective: parts => `effective: ${parts}`,
  onOff: isOn => (isOn ? 'on' : 'off'),
  sessionSwitched: isOn => `${isOn ? 'on' : 'off'} for this session`,
  panelOpened: 'Jev routing panel opened (Esc closes it)',
  noPanel: 'no panel here; this is the status:',
  bandUsage: 'usage: /jev band on | off (for this session; the band setting is /jev set band true|false)',
  bandSwitched: shown => `band ${shown ? 'shown' : 'hidden'} for this session`,
  reloaded: 'layers reloaded',
  unknownVerb: verb => `unknown: "${verb}". usage: /jev status | panel | on | off | band on|off | set <key> <value> [local|project|global] | unset <key> [local|project] | reload`,
  setDone: (key, value, scope, path) => `set ${key} = ${value} in ${scope} (${path})`,
  unsetDone: (scope, path) => `unset in ${scope} (${path})`,
  setGlobalDone: (key, value) => `set ${key} = ${value} in global (/config, pluginConfigs)`,
  noGlobalRow: key => `global ${key}: this session has no /config row for it (plugin rows exist in interactive sessions; headless runs set it in ~/.claude/settings.json pluginConfigs or with --settings)`,
  globalRefused: (key, why) => `global ${key} refused: ${why}`,
  globalFailed: (key, why) => `global ${key} failed: ${why}`,
  noCwd: 'no working directory known; cannot find the project settings file',
  cannotRead: (path, why) => `cannot read ${path}: ${why}`,
  setUsage: (keys, scopes) => `usage: /jev set <${keys}> <value> [${scopes}]`,
  unknownKey: (key, keys) => `unknown key "${key}"; keys: ${keys} (api_key is set in /config or TYPESAFE_API_KEY, never here)`,
  badValue: (raw, key, hint) => `"${raw}" is not valid for ${key}: expected ${hint}`,
  badScope: scopes => `scope must be one of ${scopes}`,
  unsetUsage: keys => `usage: /jev unset <${keys}> [local|project]`,
  unsetGlobal: 'global values live in /config; change them there',
  unsetScope: 'scope must be local or project',
  notJsonObject: 'the settings file is not a JSON object',
  doesNotParse: why => `the settings file does not parse (${why})`,
  notTouching: '; not touching it',
  cannotReadFile: why => `cannot read it (${why})`,
  bandNoKey: 'no API key · /config → TypeSafe API key',
  bandToggle: isOn => (isOn ? 'off' : 'on'),
  bandSettings: 'settings',
  bandHide: 'hide',
  paneTitle: (isOn, override) => `Jev routing · ${isOn ? 'on' : 'off'}${override ? ' (session override)' : ''}`,
  paneToggle: isOn => (isOn ? 'turn off' : 'turn on'),
  paneNext: policy => `next: ${policy}`,
  paneBandValue: state => state,
  paneBandButton: visible => (visible ? 'hide' : 'show'),
  paneLast: (key, last, agent) => `key: ${key} · last: ${last ?? 'no decision yet'} · subagent: ${agent ?? 'none yet'}`,
  paneWrites: (scope, path) => `buttons 2–7 write to ${scope}: ${path}`,
  paneScopeButton: other => `write to ${other} instead`,
  paneFooter: 'Esc closes · /jev status prints this as text · /config holds the global values',
  statusLineSwitched: (isOn, override) => `jev: ${isOn ? 'on' : 'off'}${override ? ' for this session' : ''}`,
  statusLineNoKey: 'jev: no API key — set it in /config (TypeSafe API key) or TYPESAFE_API_KEY',
  tuiHint: '/tui fullscreen works better here (docked panel, mouse)',
  statusSpend: (calls, tokens, usd, since) => `jev spend: ${calls} calls · ${tokens} input tokens ≈ US$${usd} since ${since} (local estimate at the documented price; TypeSafe shows the balance in its console only)`,
  statusPaused: (until, why) => `jev paused until ${until} after repeated failures (${why}); turns stay on the session model meanwhile`,
}

const zhTW: Strings = {
  commandDescription: 'Jev 模型路由：status · panel · on · off · band on|off · set <key> <value> [local|project|global] · unset <key> [local|project] · reload',
  statusHeader: (isOn, override, restoreVerb) => `${isOn ? '開' : '關'} · 每一輪都用 Jev 挑模型${override ? `（session 覆寫；/jev ${restoreVerb} 會回到設定值）` : ''}`,
  statusLayers: files => `層級: ${files} · global = /config`,
  statusKeyNone: '（到 /config 設定，或 export TYPESAFE_API_KEY；設好前不會路由）',
  statusLast: last => `最近一次: ${last ?? '還沒有決定'}`,
  statusLastAgent: last => `最近一次 subagent: ${last ?? '還沒有'}`,
  effective: parts => `生效值: ${parts}`,
  onOff: isOn => (isOn ? '開' : '關'),
  sessionSwitched: isOn => `這個 session ${isOn ? '開啟' : '關閉'}`,
  panelOpened: 'Jev 路由面板已打開（Esc 關閉）',
  noPanel: '這裡沒有面板，以下是狀態：',
  bandUsage: '用法：/jev band on | off（只對這個 session；永久設定用 /jev set band true|false）',
  bandSwitched: shown => `band 這個 session ${shown ? '顯示' : '隱藏'}`,
  reloaded: '設定層已重新讀取',
  unknownVerb: verb => `不認識「${verb}」。用法：/jev status | panel | on | off | band on|off | set <key> <value> [local|project|global] | unset <key> [local|project] | reload`,
  setDone: (key, value, scope, path) => `已在 ${scope} 設定 ${key} = ${value}（${path}）`,
  unsetDone: (scope, path) => `已從 ${scope} 移除（${path}）`,
  setGlobalDone: (key, value) => `已在 global 設定 ${key} = ${value}（/config, pluginConfigs）`,
  noGlobalRow: key => `global ${key}：這個 session 沒有對應的 /config 列（互動 session 才有；headless 請改 ~/.claude/settings.json 的 pluginConfigs，或用 --settings）`,
  globalRefused: (key, why) => `global ${key} 被拒絕：${why}`,
  globalFailed: (key, why) => `global ${key} 失敗：${why}`,
  noCwd: '不知道工作目錄，找不到專案設定檔',
  cannotRead: (path, why) => `無法讀取 ${path}：${why}`,
  setUsage: (keys, scopes) => `用法：/jev set <${keys}> <value> [${scopes}]`,
  unknownKey: (key, keys) => `不認識的鍵「${key}」；可用：${keys}（api_key 只能在 /config 或 TYPESAFE_API_KEY 設定，不在這裡）`,
  badValue: (raw, key, hint) => `「${raw}」不是 ${key} 的合法值：應為 ${hint}`,
  badScope: scopes => `scope 必須是 ${scopes} 其中之一`,
  unsetUsage: keys => `用法：/jev unset <${keys}> [local|project]`,
  unsetGlobal: 'global 的值在 /config；請到那裡改',
  unsetScope: 'scope 必須是 local 或 project',
  notJsonObject: '設定檔不是 JSON 物件',
  doesNotParse: why => `設定檔無法解析（${why}）`,
  notTouching: '；不動它',
  cannotReadFile: why => `無法讀取（${why}）`,
  bandNoKey: '沒有 API key · /config → TypeSafe API key',
  bandToggle: isOn => (isOn ? '關' : '開'),
  bandSettings: '設定',
  bandHide: '隱藏',
  paneTitle: (isOn, override) => `Jev 路由 · ${isOn ? '開' : '關'}${override ? '（session 覆寫）' : ''}`,
  paneToggle: isOn => (isOn ? '關閉' : '開啟'),
  paneNext: policy => `下一個：${policy}`,
  paneBandValue: state => ({ shown: '顯示', hidden: '隱藏', off: '關' })[state],
  paneBandButton: visible => (visible ? '隱藏' : '顯示'),
  paneLast: (key, last, agent) => `key: ${key} · 最近: ${last ?? '還沒有決定'} · subagent: ${agent ?? '還沒有'}`,
  paneWrites: (scope, path) => `按鈕 2–7 寫到 ${scope}：${path}`,
  paneScopeButton: other => `改寫到 ${other}`,
  paneFooter: 'Esc 關閉 · /jev status 會印成文字 · global 的值在 /config',
  statusLineSwitched: (isOn, override) => `jev: ${isOn ? '開' : '關'}${override ? '（這個 session）' : ''}`,
  statusLineNoKey: 'jev: 沒有 API key — 到 /config（TypeSafe API key）或 TYPESAFE_API_KEY 設定',
  tuiHint: '/tui fullscreen 體驗較好（面板貼側、可用滑鼠）',
  statusSpend: (calls, tokens, usd, since) => `jev 用量: ${calls} 次 · ${tokens} input tokens ≈ US$${usd}，自 ${since} 起（本機依公告單價估算；餘額只能在 TypeSafe console 看）`,
  statusPaused: (until, why) => `jev 連續失敗，暫停到 ${until}（${why}）；期間每一輪都用 session 模型`,
}

export const STRINGS: Record<Lang, Strings> = { en, 'zh-TW': zhTW }
export const EN = en
