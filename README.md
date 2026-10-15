English | [繁體中文](README.zh-TW.md)

# jev-routing

Runs each Claude Code turn — and each subagent — on the cheapest model that can handle it. Before the first model request of a turn, the plugin asks **Jev** (TypeSafe's *System One*, a small classifier API) which tier the prompt needs — **haiku**, **sonnet** or **opus** — and rewrites that turn's model. The answer takes under half a second and costs a fraction of a cent. Everything else stays as it was: same context, same tools, same permissions.

Once installed there is nothing to remember. Start sessions on the model you normally use; lookups, renames and other mechanical work run on haiku, the rest stays where it is. The status line shows every decision: `jev → haiku (routed)`.

Highlights:

- **Down-only by default.** A turn is never routed *above* the session's model.
- **Subagents too.** Each subagent's model is picked from its brief. A subagent starts with an empty cache, so this never costs a cache rewrite — it is the one saving with no catch.
- **`effort-only` when you want the cache untouched.** The model never changes; a haiku-tier prompt runs at low effort, an opus-tier prompt at high. Changing effort between turns keeps the prompt cache (measured).
- **A confidence gate.** Below `min_confidence` (0.6) the session's model stays. On 62 prompts labelled blind by three raters, every routed decision above the gate matched the consensus label.
- **Fails open.** A timeout (2 s), an HTTP error, a missing key, a routed model that gives no response: the turn runs on the session's model and the reason shows in `/jev status`. Three Jev failures in a row (an exhausted quota, a dead key, an outage) pause the asking for five minutes, so a broken Jev costs you nothing but one status line.
- **A band and a panel.** One line above the prompt shows the last decision with an on/off button; `/jev panel` (or the band's *settings* button) opens a panel with one button per setting. Both can be hidden.
- **Settings in three layers.** Global in `/config`, per project in `.claude/settings.json`, personal per project in `.claude/settings.local.json`; `/jev set` and the panel write them.

## What it saves, measured

Scripted sessions, the same prompts with routing off and on (October 2026, Claude Code 2.1.300, first-party API):

| Session | Routing off | Routing on (`down-only`) |
|---|---:|---:|
| 10 turns on **sonnet**: 4 lookups, 2 small edits, 1 test, 2 explanations, 1 analysis | US$0.417 | **US$0.309 (−26%)** |
| 4 turns on **opus**: 2 lookups, 1 test, 1 long analysis | US$1.218 | **US$1.317 (+8%)** |
| One file-lookup turn on sonnet | US$0.115 | US$0.010 |
| One subagent (count files) spawned from a sonnet session | US$0.224 | US$0.099 |

Why the opus session lost: **every model you touch writes the conversation into its own cache once.** Routing lookups to haiku saves their cost, but when the next opus-tier turn arrives, opus has to write the whole context into *its* cache, at opus prices. The dearer the session model and the larger the context at that moment, the smaller the net saving. Sonnet sessions came out well ahead; a short opus session with one long opus turn did not. Subagent routing and `effort-only` have no such cost.

Jev itself: p50 ≈ 400 ms inside a turn (p90 ≈ 750 ms), 500–700 input tokens at US$0.042 per million, output free — about US$0.00003 per decision.

## Requirements

- Claude Code with mod support (tested on 2.1.299 and 2.1.300)
- A TypeSafe API key for Jev — <https://typesafe.ai>
- Sessions on the first-party Claude API. The tiers map to `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5`; see *Known limits* for Bedrock, Vertex and gateways.

## Installation

```
/plugin marketplace add harry18456/cc
/plugin install jev-routing@harry18456
```

The install asks for the **TypeSafe API key**; it goes into the platform's secure store, never into a settings file. Restart Claude Code to take effect. Without a key the plugin stays idle and says so once in the status line.

### Load locally (no marketplace)

```
export TYPESAFE_API_KEY=...        # PowerShell: $env:TYPESAFE_API_KEY = "..."
claude --plugin-dir <path to this repo>
```

A side-loaded plugin has no install dialog, so the key comes from the environment. The other settings are in `/config` as usual.

## The band and the panel

```
jev ▸ on · down-only · haiku (routed) 0.95   off   settings   hide
```

The band sits above the prompt. Its buttons answer a mouse click, or the keyboard once the band has focus (`ctrl+x` then `tab`): `o` toggles routing for the session, `s` opens the panel. *hide* removes it for the session (`/jev band on` brings it back); the `band` setting removes it for good. It steps aside while Claude Code shows its own feedback survey.

```
Jev routing · on                                   [1] turn off
policy          down-only   ← global               [2] next: both
min_confidence  0.6         ← global               [3] −0.1  [4] +0.1
subagents       true        ← global               [5] turn off
band            shown       ← global               [6] hide
key: env · last: haiku (routed) 0.95 · subagent: none yet
buttons 2–6 write to local: <project>/.claude/settings.local.json   [7] write to project instead
Esc closes · /jev status prints this as text · /config holds the global values
```

The panel opens with `/jev panel` or the band's *settings* button; its digits work while it has focus, `Esc` closes it. Buttons 2–6 persist to the local file (personal) or, after button 7, to the project file (shared with the repo); button 1 is the session switch. In a plain terminal the panel sits above the prompt; in a full-screen terminal it docks beside the transcript.

Both work best under Claude Code's full-screen rendering (`/tui fullscreen`, the `tui` setting): the panel docks, and the buttons answer the mouse. A plugin cannot switch that for you (`tui` is not a `/config` row and `/tui` is not a command a hook may run), so when the session is not full-screen the band and the panel just say so.

Everything the plugin says — the band, the panel, `/jev`'s replies, the status line — comes in English or Traditional Chinese. The `language` setting defaults to `auto`: it follows Claude Code's own `language` setting (`/config` → Language), then the system locale, else English. Keys, reasons, tiers and paths stay as they are in both languages.

## Commands

| Command | Does |
|---|---|
| `/jev` or `/jev status` | The effective settings, where each one comes from, the key source, the last decision and the last subagent decision, a local tally of Jev calls with an estimated cost, and whether Jev is paused |
| `/jev panel` | Open the settings panel (prints the status where there is no panel, e.g. `-p`) |
| `/jev on` / `/jev off` | Routing on or off for this session only (kept across a plugin reload; cleared when it matches the setting again) |
| `/jev band on` / `/jev band off` | Show or hide the band for this session |
| `/jev set <key> <value> [local\|project\|global]` | Write a setting (scope defaults to `local`) |
| `/jev unset <key> [local\|project]` | Remove it from that file |
| `/jev reload` | Re-read the settings files |

## Settings

| Key | Values | Default | Meaning |
|---|---|---|---|
| `min_confidence` | 0–1 | 0.6 | Below this Jev confidence the turn keeps the session's model |
| `policy` | `down-only` \| `both` \| `effort-only` | `down-only` | `down-only` never picks a tier above the session's model; `both` also routes up (and pays the cache rewrite); `effort-only` never switches models and moves the effort instead |
| `enabled` | `true` \| `false` | `true` | Off keeps every turn on the session's model |
| `subagents` | `true` \| `false` | `true` | Also route each subagent from its brief, under the same policy relative to the model it would have used |
| `band` | `true` \| `false` | `true` | Show the band above the prompt |
| `language` | `auto` \| `en` \| `zh-TW` | `auto` | The language of the band, the panel and `/jev`; `auto` follows Claude Code's `language` setting |

The gate in numbers: on the 62 blind-labelled prompts, every threshold from 0.35 up gave 0 wrong routes; 0.6 routed 48 of 62, 0.5 routed 49, 0.35 routed 52. Lower it if you want more routing; the misses below 0.35 were all close calls between neighbouring tiers.

Layers, highest first:

1. **local** — `<project>/.claude/settings.local.json`, key `"jevRouting"`, personal and usually git-ignored
2. **project** — `<project>/.claude/settings.json`, key `"jevRouting"`, shared with the repo. It can switch routing or subagent routing **off**, never on: an `enabled: true` or `subagents: true` there is ignored.
3. **user file** — `~/.claude/settings.json`, key `"jevRouting"`, hand-written (handy for headless runs); read, never written
4. **global** — the plugin's rows in `/config` (also `claude plugin configure jev-routing@harry18456`)

```json
{
  "jevRouting": { "min_confidence": 0.8, "policy": "down-only", "enabled": true, "subagents": true }
}
```

`/jev set min_confidence 0.8 project` writes exactly that and keeps the rest of the file (re-indented with two spaces). A project file can change the threshold, the policy and the off switches; it can never supply a key or an endpoint. (Claude Code applies `pluginConfigs` at the user level only, which is why the file layers use their own key.)

`/jev set … global` goes through the same path as the `/config` menu and needs an interactive session.

## Environment

| Variable | Meaning |
|---|---|
| `TYPESAFE_API_KEY` | The key, when it is not set in `/config` |
| `JEV_ROUTING=off` | Start the session with routing off (headless runs) |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Claude Code's own switch; when set, the session starts with routing off |
| `JEV_TIMEOUT_MS` | Jev timeout, default `2000` |
| `JEV_ROUTING_LOG` | Path of a JSONL log: every decision (with the first 120 characters of the prompt), each step's usage, each subagent decision, `/jev` verbs and the working directory. Nothing is written when unset. |

## How it works

One module, `hooks/register.ts`:

1. `turn.start` remembers the prompt text of the turn, bound to the turn's id. A continuation (no typed prompt), a slash command's line or a turn the engine starts itself (a background task's notification) has nothing of yours to judge and stays on the session's model.
2. The turn's first `turn.step` sends to `https://api.typesafe.ai/v1/systemone` the prompt plus the exchange before it — the previous user prompt and the previous assistant reply, each cut to 300 characters — with one `choice` question (the criteria are in `hooks/question.ts`), racing a 2 s timeout. The previous exchange is what lets a short follow-up ("and the other one?") be judged in context; the question tells Jev not to let an unrelated previous task move the tier of a new one.
3. The gates run in order: confidence below `min_confidence` → keep; the session's own tier → keep; under `down-only`, a session model whose id names no tier → keep, a tier above the session's → keep; under `effort-only`, the effort moves instead of the model; otherwise route.
4. Only a routed decision names a model (`next({ ...e, model })`) and only an effort decision names an effort. Later steps of the same turn reuse it; every other step passes through with whatever the engine resolved, fallbacks included. A routed model that returns no response hands the retry back to the session's model. `turn.complete` forgets the turn.
5. `agent.spawn` does the same once per subagent, from the brief alone, relative to the model the call named or the parent's; a routed decision sets the subagent's `model`.
6. Every reason is visible: `routed`, `effort-down`, `effort-up`, `keep-low-confidence`, `keep-same`, `keep-policy`, `keep-unknown-model`, `disabled`, `no-key`, `no-prompt`, `paused`, `error`.
7. Each successful call adds its input tokens to a tally in the plugin's own store, shown by `/jev status` and the panel as `jev spend: N calls · T input tokens ≈ US$…`. It is an estimate at the documented price: TypeSafe's API has no balance or usage endpoint (checked: every likely path answers 404 and the responses carry no quota headers), so the real balance is only in TypeSafe's console.

## Privacy and security

- **What goes to api.typesafe.ai:** the prompt text of each turn, up to 300 characters of the previous user prompt and of the previous assistant reply, and each subagent's brief. Nothing else: no attachments, no tool output, no file contents, no other part of the transcript. For a project where even that is too much, turn it off there: `/jev set enabled false project`.
- The key is read from the secure store (`/config`) or the environment. The plugin never writes it anywhere; `/jev set api_key …` is refused and the log records only the verb of a command, never its arguments.
- With `JEV_ROUTING_LOG` set, the log on your own disk holds the first 120 characters of each prompt and the working directory. Leave it unset unless you are debugging.
- A project settings file is read whether or not the folder is trusted. It can turn routing off, lower or raise the confidence gate, and pick the policy; it cannot turn routing on, and it cannot name a key or an endpoint.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is honoured: the session starts with routing off.
- A failing Jev never blocks a turn.

## Known limits

- **The cache accounting above.** On an expensive session model, `down-only` can cost more than it saves when heavy turns follow routed ones. If that is your pattern, use `policy effort-only` (no cache effect) and keep `subagents` on.
- Routing judges the prompt and the exchange just before it, not the whole conversation.
- `effort-only` leaves subagents' models alone (a spawn has no effort to set).
- The target ids are the first-party ones. On Bedrock, Vertex or a gateway that serves other ids, a routed step gets no response and the turn continues on the session's model; use `effort-only` there. A session model whose id carries no tier word (an inference-profile ARN, a custom alias) is never routed under `down-only`.
- Skill selection is not part of this plugin.

## Development

```
claude plugin validate .
claude plugin test .          # 89 tests, no network: Jev, the clock, the store, the transcript and the files are mocked; the band and the panel are mounted on every surface and their buttons pressed
```

## Credits

[Jev](https://typesafe.ai) by TypeSafe. The idea of a per-turn router in Claude Code comes from Gary Chen's video on Jev; the measurements above come from a lab notebook that compared the mod against hand-labelled prompts and scripted sessions.

## License

MIT
