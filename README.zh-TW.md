[English](README.md) | 繁體中文

# jev-routing

讓 Claude Code 的每一個 turn、每一個 subagent 都跑在「夠用的最便宜模型」上。每個 turn 第一次呼叫模型之前，plugin 先問 **Jev**（TypeSafe 的 *System One*，一個小型分類 API）這個 prompt 需要哪一級 —— **haiku**、**sonnet** 或 **opus** —— 然後改寫該 turn 的模型。問一次不到半秒，花不到一分錢。其他東西都不變：同一份 context、同樣的工具、同樣的權限。

裝好後不用記任何東西。照常用你平常的模型開 session；查檔案、改名這類機械工作會跑在 haiku，其餘留在原模型。狀態列每個決定都看得到：`jev → haiku (routed)`。

特色：

- **預設只往下。** turn 永遠不會被路由到比 session 模型*更高*的一級。
- **subagent 也路由。** 每個 subagent 的模型由它的任務說明決定。subagent 一開始就沒有 cache，所以這項永遠不會多付 cache 重寫 —— 這是唯一沒有副作用的省法。
- **不想動 cache 就用 `effort-only`。** 模型永遠不換；haiku 級的 prompt 用低 effort、opus 級用高 effort。實測換 effort 不會讓 prompt cache 失效。
- **信心門檻。** Jev 信心低於 `min_confidence`（0.6）就留在 session 模型。62 題由三位標籤者盲標，門檻之上的每一次路由都跟共識一致。
- **失敗就放行。** 逾時（2 秒）、HTTP 錯誤、沒有 key、被路由的模型沒有回應：turn 照常跑 session 模型，原因顯示在 `/jev status`。Jev 連續失敗三次（額度用完、key 失效、服務掛掉）就暫停問它五分鐘，所以 Jev 壞掉只會讓你多看到一行狀態。
- **一條 band、一個面板。** prompt 上方一行顯示最近一次決定和開關；`/jev panel`（或 band 上的 *settings*）打開面板，每個設定一顆按鈕。兩者都能藏起來。
- **設定分三層。** 全域在 `/config`，專案在 `.claude/settings.json`，個人專案層在 `.claude/settings.local.json`；`/jev set` 與面板都能寫。

## 實測省多少

同一組 prompt 用腳本跑兩次，路由關與開（2026 年 10 月，Claude Code 2.1.300，第一方 API）：

| session | 路由關 | 路由開（`down-only`） |
|---|---:|---:|
| **sonnet** 10 輪：4 查詢、2 小修改、1 寫測試、2 解釋、1 分析 | US$0.417 | **US$0.309（−26%）** |
| **opus** 4 輪：2 查詢、1 寫測試、1 長分析 | US$1.218 | **US$1.317（+8%）** |
| sonnet 上一個查檔案的 turn | US$0.115 | US$0.010 |
| 從 sonnet session 派一個 subagent 數檔案 | US$0.224 | US$0.099 |

opus 那條為什麼虧：**每碰一個模型，那個模型就要把整段對話寫進自己的 cache 一次。** 查詢丟給 haiku 省了那幾輪，但下一個 opus 級的 turn 來時，opus 要用 opus 的價錢把整段 context 寫進*它的* cache。session 模型越貴、那一刻的 context 越大，淨省就越少。sonnet session 明顯划算；短的 opus session 加一個長 opus turn 就不划算。subagent 路由與 `effort-only` 沒有這個代價。

Jev 本身：turn 內 p50 約 400 ms（p90 約 750 ms），每次 500–700 input tokens，每百萬 US$0.042，output 不計費 —— 每個決定約 US$0.00003。

## 需求

- 支援 mod 的 Claude Code（在 2.1.299 與 2.1.300 測過）
- 一把 TypeSafe 的 Jev API key —— <https://typesafe.ai>
- 走第一方 Claude API 的 session。三個級別對應 `claude-haiku-5-5`、`claude-sonnet-5-5`、`claude-opus-5-5`；Bedrock、Vertex 與 gateway 見「已知限制」。

## 安裝

```
/plugin marketplace add harry18456/cc
/plugin install jev-routing@harry18456
```

安裝時會問 **TypeSafe API key**；它會存進平台的安全儲存區，不會寫進任何 settings 檔。重開 Claude Code 生效。沒有 key 時 plugin 什麼都不做，狀態列提示一次。

### 本機載入（不經 marketplace）

```
export TYPESAFE_API_KEY=...        # PowerShell：$env:TYPESAFE_API_KEY = "..."
claude --plugin-dir <這個 repo 的路徑>
```

側載的 plugin 沒有安裝對話框，所以 key 要從環境變數給。其他設定照常在 `/config`。

## band 與面板

```
jev ▸ on · down-only · haiku (routed) 0.95   off   settings   hide
```

band 在 prompt 上方。按鈕可以用滑鼠點，或在 band 取得焦點後用鍵盤（`ctrl+x` 再 `tab`）：`o` 切換這個 session 的路由，`s` 打開面板。*hide* 把它藏起來到 session 結束（`/jev band on` 叫回來）；`band` 設定可以永久關掉。Claude Code 顯示自己的意見問卷時，band 會讓位。

```
Jev routing · on                                   [1] turn off
policy          down-only   ← global               [2] next: both
min_confidence  0.6         ← global               [3] −0.1  [4] +0.1
subagents       true        ← global               [5] turn off
band            shown       ← global               [6] hide
key: env · last: haiku (routed) 0.95 · subagent: none yet
buttons 2–6 write to local: <專案>/.claude/settings.local.json   [7] write to project instead
Esc closes · /jev status prints this as text · /config holds the global values
```

面板用 `/jev panel` 或 band 的 *settings* 打開；面板有焦點時數字鍵有效，`Esc` 關閉。按鈕 2–6 寫進 local 檔（個人），按過 7 之後改寫 project 檔（跟 repo 走）；按鈕 1 是 session 開關。一般終端裡面板在 prompt 上方；全螢幕終端裡貼在對話旁邊。

兩者在 Claude Code 的全螢幕繪製下最好用（`/tui fullscreen`，也就是 `tui` 設定）：面板會貼側、按鈕可以用滑鼠點。plugin 沒辦法替你切（`tui` 不是 `/config` 的列，`/tui` 也不是 hook 能呼叫的指令），所以 session 不是全螢幕時，band 和面板只會提示一句。

plugin 說的每一句話 —— band、面板、`/jev` 的回覆、狀態列 —— 有英文和繁體中文兩套。`language` 設定預設 `auto`：跟隨 Claude Code 自己的 `language` 設定（`/config` → Language），其次系統語系，否則英文。鍵名、原因、級別、路徑在兩種語言裡都不翻。

## 指令

| 指令 | 作用 |
|---|---|
| `/jev` 或 `/jev status` | 目前生效的設定、每一項來自哪一層、key 的來源、最近一次決定、最近一次 subagent 決定、本機累計的 Jev 用量與估算費用、Jev 是否暫停中 |
| `/jev panel` | 打開設定面板（沒有面板的地方，例如 `-p`，就印狀態） |
| `/jev on` / `/jev off` | 只對這個 session 開關路由（plugin 重載後仍記得；跟設定值相同時就自動解除） |
| `/jev band on` / `/jev band off` | 這個 session 顯示或隱藏 band |
| `/jev set <key> <value> [local\|project\|global]` | 寫入設定（scope 預設 `local`） |
| `/jev unset <key> [local\|project]` | 從該檔移除 |
| `/jev reload` | 重新讀設定檔 |

## 設定

| 鍵 | 值 | 預設 | 意義 |
|---|---|---|---|
| `min_confidence` | 0–1 | 0.6 | Jev 信心低於此值時，turn 留在 session 模型 |
| `policy` | `down-only` \| `both` \| `effort-only` | `down-only` | `down-only` 永不選比 session 模型高的級別；`both` 也往上（並付出 cache 重寫）；`effort-only` 永不換模型，改動 effort |
| `enabled` | `true` \| `false` | `true` | 關閉時每個 turn 都用 session 模型 |
| `subagents` | `true` \| `false` | `true` | subagent 也依任務說明路由，同一套 policy、相對於它原本會用的模型 |
| `band` | `true` \| `false` | `true` | 在 prompt 上方顯示 band |
| `language` | `auto` \| `en` \| `zh-TW` | `auto` | band、面板與 `/jev` 的語言；`auto` 跟隨 Claude Code 的 `language` 設定 |

門檻的數字：62 題盲標資料上，0.35 以上的任何門檻都是 0 錯；0.6 路由 48/62、0.5 路由 49、0.35 路由 52。想多路由一點就調低；0.35 以下的錯都是相鄰級別的邊界題。

層級，高的先：

1. **local** —— `<專案>/.claude/settings.local.json` 的 `"jevRouting"` 鍵，個人用，通常被 git 忽略
2. **project** —— `<專案>/.claude/settings.json` 的 `"jevRouting"` 鍵，跟著 repo 走。它只能把路由或 subagent 路由**關掉**，不能打開：裡面的 `enabled: true`、`subagents: true` 會被忽略。
3. **user file** —— `~/.claude/settings.json` 的 `"jevRouting"` 鍵，手寫用（headless 很方便）；只讀不寫
4. **global** —— `/config` 裡這個 plugin 的列（也可用 `claude plugin configure jev-routing@harry18456`）

```json
{
  "jevRouting": { "min_confidence": 0.8, "policy": "down-only", "enabled": true, "subagents": true }
}
```

`/jev set min_confidence 0.8 project` 寫的就是這段，檔案其他內容保留（重新以兩個空白縮排）。專案檔能改門檻、策略與關閉開關；永遠給不了 key 或 endpoint。（Claude Code 的 `pluginConfigs` 只在 user 層生效，所以檔案層用自己的鍵。）

`/jev set … global` 走的是 `/config` 選單同一條路，要在互動 session 裡用。

## 環境變數

| 變數 | 意義 |
|---|---|
| `TYPESAFE_API_KEY` | `/config` 沒設 key 時用這個 |
| `JEV_ROUTING=off` | session 一開始就關閉路由（headless 用） |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Claude Code 自己的開關；有設時 session 一開始就關閉路由 |
| `JEV_TIMEOUT_MS` | Jev 逾時，預設 `2000` |
| `JEV_ROUTING_LOG` | JSONL log 路徑：每個決定（含 prompt 前 120 字）、每個 step 的用量、每個 subagent 決定、`/jev` 的動詞、工作目錄。沒設就不寫。 |

## 運作方式

一個模組 `hooks/register.ts`：

1. `turn.start` 記住這個 turn 的 prompt 文字，綁在 turn id 上。續行的 turn（沒有新輸入）、slash 指令那一行、或引擎自己發起的 turn（背景任務完成的通知）沒有你的東西可判，直接留在 session 模型。
2. turn 的第一個 `turn.step` 把 prompt 連同前一次對話 —— 上一則 user prompt 與上一則 assistant 回覆，各截 300 字 —— 送到 `https://api.typesafe.ai/v1/systemone`，問一題 `choice`（criteria 在 `hooks/question.ts`），同時跟 2 秒逾時賽跑。帶前一次對話是為了讓很短的追問（「那另一個呢？」）能在上下文裡判斷；題目也告訴 Jev 不要讓不相干的上一題影響新題的級別。
3. 依序過門：信心低於 `min_confidence` → 留；跟 session 同級 → 留；`down-only` 之下，session 模型 id 看不出級別 → 留、級別比 session 高 → 留；`effort-only` 之下改 effort 不改模型；其餘才路由。
4. 只有 `routed` 的決定會指定模型（`next({ ...e, model })`），只有 effort 決定會指定 effort。同一 turn 後面的 step 沿用；其他 step 一律照引擎解析出來的模型放行，fallback 也包含在內。被路由的模型若沒有回應，重試就回到 session 模型。`turn.complete` 時忘掉這個 turn。
5. `agent.spawn` 對每個 subagent 做一次同樣的事：只看任務說明，相對於呼叫指定的模型或父層的模型；路由了就設 subagent 的 `model`。
6. 每個原因都看得到：`routed`、`effort-down`、`effort-up`、`keep-low-confidence`、`keep-same`、`keep-policy`、`keep-unknown-model`、`disabled`、`no-key`、`no-prompt`、`paused`、`error`。
7. 每次成功的呼叫會把 input tokens 加進 plugin 自己的 store，`/jev status` 與面板顯示成 `jev 用量: N 次 · T input tokens ≈ US$…`。這是依公告單價的本機估算：TypeSafe 的 API 沒有餘額或用量端點（試過：常見路徑全部 404，回應也沒有額度 header），真正的餘額只能在 TypeSafe console 看。

## 隱私與安全

- **送到 api.typesafe.ai 的東西：** 每個 turn 的 prompt 文字、上一則 user prompt 與上一則 assistant 回覆各最多 300 字、每個 subagent 的任務說明。只有這些：沒有附件、沒有工具輸出、沒有檔案內容、沒有其他對話紀錄。連這都不行的專案就在那裡關掉：`/jev set enabled false project`。
- key 從安全儲存區（`/config`）或環境變數讀。plugin 不會把它寫到任何地方；`/jev set api_key …` 會被拒絕，log 只記指令的動詞，不記參數。
- 設了 `JEV_ROUTING_LOG` 時，你自己磁碟上的 log 會有每個 prompt 的前 120 字與工作目錄。不是在除錯就不要設。
- 專案的 settings 檔不管資料夾有沒有被信任都會讀。它能把路由關掉、調高調低信心門檻、選策略；不能把路由打開，也不能指定 key 或 endpoint。
- 尊重 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`：有設時 session 一開始就關閉路由。
- Jev 出錯永遠不會擋住 turn。

## 已知限制

- **上面的 cache 帳。** session 模型很貴時，`down-only` 在重的 turn 接在被路由的 turn 之後會倒貼。你的用法是這樣的話，改用 `policy effort-only`（不碰 cache），`subagents` 保持開。
- 路由只看 prompt 與前一次對話，不看整段對話。
- `effort-only` 不動 subagent 的模型（spawn 時沒有 effort 可設）。
- 目標模型 id 是第一方的那三個。在 Bedrock、Vertex 或提供其他 id 的 gateway 上，被路由的 step 不會有回應，turn 會接著用 session 模型跑完；那裡請用 `effort-only`。session 模型 id 看不出級別時（inference profile 的 ARN、自訂別名），`down-only` 之下永遠不路由。
- 挑 skill 不在這個 plugin 的範圍。

## 開發

```
claude plugin validate .
claude plugin test .          # 89 個測試，不連網：Jev、時鐘、store、對話紀錄、檔案都是 mock；band 與面板在四種 surface 掛載並按過每顆按鈕
```

## 致謝

[Jev](https://typesafe.ai) 出自 TypeSafe。「在 Claude Code 裡逐 turn 路由」的想法來自 Gary Chen 介紹 Jev 的影片；上面的數字來自一本實驗筆記，拿這個 mod 對照人工標籤的題目與腳本 session 量出來的。

## License

MIT
