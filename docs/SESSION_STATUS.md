# Session status — handoff notes

> **Read this first when starting a new session.** It is a snapshot of where
> work stopped, what is green, and what is left. Last updated **2026-10-07**:
> the **voice overlay** ("speak to the app") landed and is **committed** —
> five green commits this cycle: `ba851c7` (assistant v2 + presets + parser
> salvage, the pre-voice baseline), then `06db82c` (`/api/ai/voice`),
> `3e29ce7` (overlay core), `fd0d951` (microphone/backends/transcribe) and
> `d2cdec2` (apply/undo/gate). Working tree clean, all four test commands
> green (§2). Earlier commits: `aa6eb20` (phases 1–3), `fb8c641` (Phase 0),
> `caf607e` (Google-first AI connection), `4efa62e` (mobile UI).
>
> The product spec lives in `docs/AI_AUTOMATION_PLAN.md`; this file is only
> about *state of the work*.

---

## 1. The goal (one paragraph)

Take PW Budget from a stock/credit/budget app into a product a Ghanaian
print-shop owner will actually use, built around an **AI capture pipeline** —
camera scan of receipts and ledger books → extraction → human confirmation →
recording — plus MoMo/bank **statement ingestion** and a knowledge base that
links money spent to items and references. The whole platform should feel
**AI native**: the app and its parts are the model's body, and the owner
decides how much of that body the model may reach (the *coverage* matrix).

Constraints that are **not negotiable** (they break tests if violated):

- Pure Python stdlib server, no build step, no npm dependencies.
- `server.py` and `public/app/db.js` must mirror **every** endpoint with
  identical status codes, figures and error strings — parity is enforced.
- Images are **transient**: never stored; `documents`/`income` store extracted
  text and provenance, never bytes.
- The AI key lives only in `localStorage["pwbudget.ai.v1"]` and is sent to
  nothing but the chosen provider — never to this project's server.
- Model prompts live in the parity pair (`server.py` ↔ `db.js`), never in the
  UI.
- Nothing auto-commits: the model proposes, a human confirms, the ordinary
  write path records.

---

## 2. Where work stopped — all tests green

Run from the repo root:

```
node smoke_test.js          -> 301 passed, 0 failed
node audit_calculations.js  -> 174 passed, 0 failed (13 shared constants)
python tools/cleanup_smoke.py   -> clean (branches: Main Shop; smoke debris removed —
                                   the owner's own purchases are real data and stay)
python tools/check_static.py    -> OK
```

Notes:

- The smoke **boot check tolerates real purchases** (it fails only on rows
  carrying a smoke stamp or a smoke fixture's name): a ledger that records
  daily can never be empty again, and 280 other checks pass with the owner's
  rows present.

- `smoke_test.js` does **not** start a server. Start one first:
  `python server.py 8123`, and run `python tools/cleanup_smoke.py` after.
- `audit_calculations.js` starts and kills its own servers against throwaway
  data dirs, and forces `AI_API_KEY=""`.
- **Do not** leave a stale `python server.py 8123` running between sessions.
  Twice now an old process from an earlier session stayed bound to 8123 and
  answered requests, so smoke failed with `/api/income → 404`. Check with
  `netstat -ano | Select-String ":8123"` and kill the old PID before testing.

---

## 3. What has shipped

### Phase 1 — AI plumbing ✅
- `POST /api/ai/extract`, `/api/ai/instruct`, `/api/ai/statement` in **both**
  engines.
- `ai_client` / `ai_call` in `server.py` via stdlib `urllib`, with fixture
  replay under `fixtures/ai/`.
- Fixture digest:
  `sha256(json.dumps({"kind":k,"payload":p}, sort_keys=True, ensure_ascii=False, default=str))`
  → `fixtures/ai/<digest>.json`. The **prompt is not part of the digest**, so
  prompt edits do not invalidate recorded fixtures.

### Phase 2 — camera → entry ✅
- 📷 *Scan a slip* / 📋 *Paste text* in the New-purchase dialog.
- Canvas downscale to 1500px JPEG 0.7 before upload.
- `uncertain[]` review card with tappable option chips.
- `state.scanQueue`: multi-line slips save one line at a time through the
  ordinary `submitEntry` → `POST /api/purchases`.

### Phase 2b — AI-native surface ✅
- **AI connection** dialog: provider select (Groq / Gemini / OpenRouter /
  DeepSeek / custom OpenAI-compatible), key + model, *Test connection*, *Forget*.
- **AI status strip** on every screen (`on` / `off` / `bad` + coverage).
- **Coverage** matrix — `capture` gates the scan bar, `catalogue` + `money`
  gate `payload.context`, `app` gates the instruction box.
- Model plumbing in `db.js`: `setProvider` / `aiChat` / `aiCall`.
- With a device key configured, `app.js` bypasses `api()` and calls `PWDB`
  directly in **both** modes.

### Phase 3 — income + statement ingest ✅ (this session)

**`server.py`**
| Piece | Anchor |
|---|---|
| `income` table + `idx_income_date` / `idx_income_branch` | `SCHEMA`, line 162 |
| `income_query(conn, params)` | line 674 |
| `analytics()` | line 721 |
| analytics `income_map` (769), `series[].income` (792), `totals.income`/`net` (798) | |
| `meta()` (line 940) months = purchases **UNION** income | |
| `GET/POST /api/income`, `DELETE /api/income/{id}` | line 1817 (inserted before `# ---- credits`) |
| `_create_income` | line 1916 |
| `EXPORT_KINDS` includes `"income"` | line 972 |
| hoisted prompts | `AI_PROMPT_INSTRUCT` 1118, `AI_PROMPT_STATEMENT_IMAGE` 1119, `AI_PROMPT_STATEMENT_TEXT_PREFIX` 1120 |
| `ai_instruct` uses the constant | line 1469/1480 |
| `ai_statement` uses the constants | line 1630/1637/1648 |

**`public/app/db.js`**
| Piece | Anchor |
|---|---|
| seed `income: []` (line 66) + `load()` backfill | top of file |
| `incomeQuery(params)` | line 193 |
| `createIncome(payload)` | line 498 |
| `analytics()` income fields | line 223 |
| `metaData().months` unions both tables | line 418 |
| same 3 prompt constants | after `AI_PROMPT_TEXT_PREFIX` |
| `aiInstruct` now **async + model path** | line 874 |
| `aiStatement` now **async + model path** | line 1018, helper `statementResult` 1042 |
| `/api/income` GET/POST/DELETE routes | line 1131 |
| all three `/api/ai/*` routes return **Promises** | `request()` dispatcher, line 1210 |

**`public/app/app.js`**
| Piece | Anchor |
|---|---|
| `state.income`, `state.stmt` | line ~16 |
| `loadIncome()` (KPIs + list + pager + capture gating) | line 722 |
| `readStatement()` / `renderStatement()` | 781 / 805 |
| `recordStatement()` / `clearStatement()` | 857 / 885 |
| `openIncomeDialog()` / `submitIncome()` | 914 / 925 |
| `TITLES.income`, `switchView` branch, more-tab highlight | 1226, 1231 |
| `VIEWS` deep-link list includes `income` | `init()` |
| `populateFilters` fills `#income-month`, `populateBranches` fills `#i-branch` | |
| dashboard: *Money in this month* KPI (`data-goto="income"`) + money-in series in the spend chart; `COLORS.income` | `loadDashboard` |
| `#kpis` delegated `[data-goto]` listener | `bindAll()` |
| money-in + statement bindings | `bindAll()` |

**`public/app/index.html`** — nav button (line 109, `hide-sm`), More-sheet
button (line 355), `#view-income` (207) with `#stmt-card` (210), `#income-dialog`
(431).

**`public/app/styles.css`** — money-in block appended at the end of the file
(`.import-bar`, `.stmt-text`, `.stmt-sum`, `.stmt-warn`, `.stmt-rows`,
`.stmt-row`, `.stmt-dir`, `.kpi[data-goto]`, one `@media (max-width: 760px)`).

**`public/app/sw.js`** — `CACHE = "pwbudget-v21"` (bump on *every* asset edit).

**Tests** — `audit_calculations.js`: 14 income parity steps added (empty, 4 ×
400s, 2 × 201, list, branch filter, month filter, search, 404 delete, delete,
final), `income:delete` runs before `analytics:final`/`meta:final` so both
see it; `CONTRACT` grew from 6 to 9 names. `smoke_test.js`: `income` in the
view loop, 7 new checks × 2 modes, a `global.__stmtTicks` hook in the DOM
stub for `document.querySelectorAll("#stmt-rows .stmt-tick")`, `reset()` on
the stub `El`, income cleanup loop.
`tools/cleanup_smoke.py` also wipes `income` where
`memo LIKE 'smoke-%' OR reference LIKE 'SMK%' OR source LIKE 'Smoke takings%'`.

---

### Assistant v2 — the agentic pass ✅ (committed in `ba851c7`)

The chat assistant was reworked from a thin prompt wrapper into an agent that
knows its own limits, speaks between turns, and offers a small set of
**human-approved write powers**. Four parts, all landed and green:

**A — honesty + retry.**
- `AGENT_TOOLS` grew to 24: added `get_purchase`, `compare_months`,
  `get_reminders`, `price_trend`, `top_suppliers`, `navigate`,
  `search_income`, `budget_health`, `import_slip`, `propose_coverage`
  (`free: true` — always attached), `backup_books`; `make_report` args are now
  `{kind, format, month?, year?, branch_id?}`.
- Tools whose coverage is off are described to the model as
  `name [locked]` + a `LOCKED — the owner has not switched on "…"` line
  (`agentLocked` / `agentLockReason`), never silently dropped — and
  `AI_PROMPT_AGENT` tells the model to never claim a locked hand and to offer
  `propose_coverage` only when widening access would help. The prompt edit is
  byte-identical in `server.py` and `db.js`.
- `agentTurn()` retries once on a failed model call (1500ms, then 1200ms) and
  returns `{reply, actions, failed}`; `agentLoop` marks the message
  `retry: true` + breaks, and the card renders **Try again** (binding `retry`)
  instead of a dead end.
- `capAgentHistory()` runs in `saveAgent()`: sheds old hidden read-results
  beyond 6, caps at 120 messages, never drops a pending card.

**B — richer reads + talk between turns.**
- 8 new read cases in `agentRunTool` (`price_trend` returns an item's average
  unit price per month + % move, `compare_months` prints a `spend …` line,
  `navigate` opens a view behind the panel, etc.).
- `agentBriefing()` (client-side, works keyless) runs on `agentOpen()` and
  renders “here is where the shop stands”: quiet/alerts line, top items,
  distributor split, and where the assistant can reach
  (`agentAlerts(force)` has a 30s cache; `agentDashboardData()` feeds it).
- `agentFollowups(msg)` turns the last exchange into ≤2 quick chips;
  `agentChips()` is coverage-aware (a money-off chip carries `act: "open-ai"`).
- `agentContext()` now includes reminders; `renderAgentStatus()` appends
  `N locked by coverage`.

**C — write powers (every one still behind an Approve tap).**
- `propose_coverage` (`free`) — proposes flipping a coverage switch; approving
  runs `setAiArea` + `saveAI` + re-renders, and the inverse turns it off.
- `import_slip` — one pasted slip → `agentSlipCards()` → one pending card per
  line (`agentLoop` expands it; no card of its own).
- `backup_books` — returns a file card into `AGENT_FILES` (same backup JSON
  the *Your data* screen builds).
- `agentApproveAll(mid)` / `agentDecide(…, {silent})` — **Approve all N** on a
  multi-card message; each card still goes through the ordinary
  `agentExecute` path.
- `agentReportModel(kind, opts)` takes `month`/`year`/`branch_id` and filters
  purchases/income/credits/budget/overview with `bq`; `agentBuildReport`
  passes args through. Report **file name is unchanged** (smoke asserts it).

**D — polish, docs, tests.**
- Auto-speak new replies when voice is on (skipped on failure); bindings for
  `approve-all`, `retry`, `open-ai`; styles for `.agent-brief`,
  `.agent-follow`, `.agent-retry`, `.acard-acts.bulk`.
- **Bug fixes found on the way**: the API row shape is `product`/`total`
  (NOT `product_name`/`total_amount`); credit figures live at
  `row.credit.*`. Corrected in `agentRowToPurchaseArgs`, `delete_purchase`
  (card + detail), `move_purchase`, `search_purchases`, `get_purchase`, and
  the purchases section of `agentReportModel`.
- `CACHE = "pwbudget-v29"` in `sw.js`.
- **Interface: the glass drawer.** The assistant no longer covers the app as a
  flat panel — a dimmed, blurred scrim sits behind it and the shell becomes a
  full-height sheet with rounded top on a phone, or a floating right-hand
  card (min 470px, inset 14px) on a screen ≥760px. Glass header with an
  avatar orb, title and a live status pill (green dot = model attached),
  ghost icon controls; bot replies get a small ✦ avatar, new rows/cards fade
  and rise in once (identity-tracked `AGENT_SEEN` WeakSets, so a re-render
  never re-animates); the composer is one rounded capsule (attach · input ·
  mic · gradient send) with a gold focus ring; approval cards get icon tiles;
  the empty state gets a floating gold orb. Closes on ✕, Esc, or a tap on
  the scrim. `prefers-reduced-motion` strips every transform.
- **Tests**: 13 new smoke checks × 2 modes (locked lines, coverage proposal,
  briefing, chips, follow-ups, retry, slip expansion, backup file, approve-all
  + cleanup, history cap, new reads, navigate, month-scoped report), harness
  exports grew to match; suite is **229 passed / 0 failed** (the presets
  extension in §3.6 added one check, §3.7 three more), audit
  **173 passed / 0 failed**, `check_static` + `cleanup_smoke` green.

Rules that held: exactly **4** coverage areas (never add a 5th; defaults
`capture` + `catalogue`), no internet search, no bank/PSD2/POS connections
ever, nothing auto-commits.

---

### Phase 0 — your data, out loud ✅ (this session, committed as `fb8c641`)

Two halves: a write that cannot be stored must never look saved, and the owner
must be able to take their records with them.

**Storage failures are loud (both engines).**

| Piece | Anchor |
|---|---|
| `STORAGE_FULL_ERROR` — the one shared sentence | `db.js` next to `LS_KEY`, `server.py` next to `CURRENCY` |
| `SAVE_ERROR` / `SAVE_ATTEMPTS`, `save()` records instead of swallowing | `db.js` storage block |
| `request()` wraps `route()`: snapshot → run → **507 + rollback** if the write did not stick | `db.js` dispatcher |
| `PWDB.storageStatus()` / `exportData()` / `importData()` | `PWDB` export |
| `server.py` `_storage_error()` maps `sqlite3.OperationalError` (disk / readonly / unable to open) → **507** | HTTP verbs, before the generic 500 |
| `renderStorageBanner()` — persistent red banner until a write succeeds | `app.js`, called from `offlineRequest()`'s `finally` and from `api()` on 507 |

Rollback means memory and storage stay in step: a failed write leaves **no**
half-saved purchase (the offline smoke checks row counts before/after). The
server half was probed for real: `attrib +R ledger.db` →
`POST /api/purchases` → `507 {"error":"storage is full — …"}` with the record
absent from the list afterwards.

**Backup / restore / CSV export — `#data-dialog`, "Your data".**

- Entry points: **More sheet → Your data**, the **profile dialog** row, and the
  storage banner (which jumps straight to it).
- **Backup** → one `pwbudget-backup-YYYY-MM-DD.json` in the *offline engine's own
  shape*, whichever engine is live — so a file taken against the server restores
  into the offline copy and vice versa. Server mode assembles it through the
  ordinary APIs (meta, paged purchases/income, credits incl. payments, budgets
  read back per month × branch).
- **Restore** → replays through the ordinary create paths, **additive only**:
  a record already present (date + product + total + branch, or date + source +
  amount + reference) is counted and skipped. Safe to run twice, safe on a
  device that already holds records, no new endpoints to mirror.
- **CSV** → purchases / credits / money-in, with a BOM so Excel opens it right.
- Read fan-out is **batched** (`pool(…, 4)`): ~72 parallel `GET /api/budget`
  requests tripped the server's connection backlog, the app saw one refused
  connection and switched itself to offline mode for the rest of the session.

**Tests** — 13 new smoke checks (152 → 165): credits/purchases/money-in CSV
headers, backup table coverage (both modes), restore-after-delete (both modes),
and offline-only quota checks — a refused write answering 507 with the row
rolled out of the store, the banner raising then clearing itself, and
`importData()` round-tripping a backup while refusing junk *and* refusing to
replace the books when there is no room to store them. `FakeStorage`
gained a `fail` flag, `El` a `click()`, and the harness exports the new
functions. `CACHE = "pwbudget-v23"`.

---

### Mobile UI pass — sheets, thumbs, insets ✅ (this session)

No browser is attached to this session (§5), so this was found by parsing
`styles.css` rather than by looking at it. Four defects:

| Was broken on a phone | Fix |
|---|---|
| `dialog { padding: 0 }` sat on the *forms* — Money in, AI settings and **Your data** rendered flush to the screen edge with no room for the home bar | the sheet owns the padding, the forms are `padding: 0`, so a dialog with no form wrapper is indented like one with |
| The More sheet is ~430px tall and had no `max-height`: held sideways its first entries sat off the top, unreachable | `max-height: calc(100dvh - 10px)` + scroll, `overscroll-behavior: contain` |
| The keypad is `overflow: hidden` inside a `76vh` shell — a phone sideways lost its bottom keys | keys are the only flexible child (`flex: 1 1 auto; min-height: 0; overflow-y: auto`), head/screen/foot pinned |
| `.branch-pick select` and both statement textareas were 13px, which makes **Safari on iOS jump the viewport** into them on focus | 16px everywhere; 13px comes back only at `≥900px and (pointer: fine)` |

Also: `92vh`/`76vh` → `dvh` (plain `vh` is the *tall* viewport, so a sheet can
overrun the screen while Safari's bar is showing); `--safe-l`/`--safe-r` folded
into `--gutter-l`/`--gutter-r` on the header, tab bar, main, both sheets, the
toast, the banners and the two FABs, so a notched phone held sideways doesn't
hide them behind the camera (no-ops in portrait); `.top-actions` made shrinkable
— at 320px with the Offline badge up, the header pushed the page sideways; and
`.storage-banner` given its own desktop slot, since it had inherited a tab-bar
offset for a layout that has no tab bar.

**44px is the floor on touch** — `@media (max-width: 899px), (pointer: coarse)`
lifts `.btn.small`, the row Pay/Move/Delete icons, `.seg-btn`, the review chips,
the AI strip, the calculator head buttons, statement rows, the theme switch and
the identity pill to 44px, and puts `min-height: 44px` under every field and
picker. The rest of the app already sat at 44–58px (`.btn`, `.nav-btn` 50, the
calculator keys 46, `.check` 44) — these were the outliers. **The pointer, not
the width, decides**, because a tablet or a phone turned sideways lands in the
≥900px desktop layout while still being poked with a finger.

`CACHE = "pwbudget-v24"`. Tests unchanged (160 audit / 165 smoke) — none of
this is observable to them; the only proof that matters is a real handset.

---

### Voice overlay — speak to the books ✅ (this session, `06db82c` → `d2cdec2`)

The owner-approved voice plan, five small green commits:

**1 — the route (`06db82c`).** `POST /api/ai/voice` in both engines behind the
shared prompt `AI_PROMPT_VOICE` (**contract 12 → 13**): the model answers with
exactly one JSON `{reply, actions}`, ≤6 *flat* actions from the whitelist
`add_item | update_item | delete_item | set_total {amount, save} | add_note |
ask_clarification`, destructive ops carry `confirm`. Three audit parity steps
pin the route (empty line, bad key, history echo).

**2 — the overlay (`3e29ce7`).** `public/app/voice.js` + panel markup/styles +
the `window.PWApp` bridge (appended after `initCalc()`): draggable glass panel
(mic fab bottom-left, Ctrl+Shift+Space hotkey, drag-to-move), the number
engine — per-language lexicons **en/fr/tw/ga/ee/ha**, digit pass + word
spans, connector/scale walk — `voiceParseReply` (salvages stray braces the
way `agentParse` does), the strict validator (amounts must have been spoken,
rows must exist for update/delete, ask-only replies carry no actions),
history, chips, drag. Smoke harness grew `_voice_${mode}.js` loading +
10 checks × 2 modes. Fixed on the way: the span builder excluded scale words
("five hundred" parsed as 5), and a smoke lang check read the language after
switching back.

**3 — capture (`fd0d951`).** `voiceSttProvider()` picks the engine:
Groq/OpenAI key + microphone → **whisper** (push-to-talk, `MediaRecorder` →
b64 → `POST /api/ai/transcribe` — `whisper-large-v3-turbo` on Groq else
`whisper-1`, 400 `AI_NOTHING_ERROR` without audio/provider, `source:""` when
unreachable); else **webspeech** (live recognition, final result
auto-submits); else typing with a plain hint. Consent is asked on the first
tap (`pwbudget.voice.mic.v1`), audio is in-memory only; the 🔊 chip toggles
TTS read-aloud. `_ai_transcribe()` in `server.py` + `aiTranscribe()` in
`db.js` mirror byte-for-byte. 7 checks × 2 modes.

**4 — apply/undo (`d2cdec2`).** Chips became tappable: re-validate against
the amounts really spoken (`VOICE.amounts` travels with the batch), gate on
`aiAllows("app")` first (localized hint, no dialog on refusal), confirm
`delete_item`/`set_total`, convert the cedi amount to percent of spendable,
`renderBudgetBody` + `saveBudget`, journal the change (voice rows get a gold
rail via `.jrow.voiced`), and render **↩ Undo** — one-step restore of
rows/total/save, re-save, reversal journal row. `add_note` writes the
journal only; an `ask_clarification` chip refocuses the text box.
`CACHE = "pwbudget-v32"`. 6 checks × 2 modes.

**Tests** — smoke **265 → 275**, audit unchanged (**174**; the two transcribe
parity steps came with commit 3), `check_static` OK, `cleanup_smoke` clean.

**Two harness constraints worth remembering:** every apply-check captures the
live budget first and restores total/save/rows before finishing (the server
DB keeps the owner's real budget), and voice undo appends a reversal journal
row instead of setting `undone: true` — the later check *"the change log
renders what happened"* asserts `!html.includes("undone")`.

---

### Chat view — two-column shell, sessions, bulk cards ✅ (this session, `4b97065` → `2fe0123`)

The owner's chat rework, four small green commits. The floating glass
drawer (§3.7) is **gone** — the assistant is an app section now.

**1 — the shell (`4b97065`).** `#view-chat` is a two-column layout: a
sidebar (brand + collapse, Chats/Projects/Logs links, Recents/Projects
containers, the shop identity with its Settings / Your data / Theme menu)
and the conversation column (top bar with the status pill, thread, full
composer). `#agent-shell`, `#agent-scrim` and the journal popup dialog were
deleted; the change log moved into a **Logs pane of the view** and
`openJournal()` navigates there. `#agent-fab` stays as a shortcut — it and
the nav's Assistant pill light up when a card waits. `switchView` gained
`chat` (in `VIEWS`, `AGENT_VIEWS`, `TITLES`); the engine, ids, voice
overlay and journal are untouched. The sidebar is a slide-in drawer under
768px (burger + scrim + Escape) and collapses on desktop. `CACHE v33`.

**2 — sessions (`c4a1fbf`).** Storage became
`{sessions[], cur, projects[], journal, voice, seq, jseq, ui{collapsed}}`
under the same key; v1's flat conversation migrates into one session.
**Every reload archives the open chat** (full history, keyword auto-title
from the first user message's significant words — renames pinned by
`renamed: true`) and opens a fresh empty one; an empty active session is
reused, so no litter. The sidebar gained ＋ New chat, a search box over
titles **and** message text (with a hit snippet), day buckets (Pinned /
Today / Yesterday / Previous 7 days / Older), a per-row ⋯ popover (rename /
move to project / pin / delete behind a confirm), and projects (create,
click-to-filter, delete without taking chats). `saveAgent()` writes
`AGENT.messages` back onto its session first (tests poke it directly),
caps at 20 sessions (oldest unpinned shed), and re-renders the sidebar;
collapse persists in `ui.collapsed`; `beforeunload` saves. The
pending-card badge (pill, FAB, nav) counts **across all sessions** and
lights even with no model attached — approving is a local act. 8 checks.
`CACHE v34`. One bug the tests caught: the row menu's *Move* both opened
the project list and executed a move — split into `move` (mode) /
`setproj` (execute).

**3 — bulk (`2fe0123`).** The same-tool dedupe in `agentLoop` is gone:
every write action in a reply becomes its own card, extracted as
`agentPlanCards(actions)` with `AGENT_BULK_MAX = 40` per tool and
`Record a purchase (3 of 12)` numbering; **Approve all N** (already
rendered per message) now really does carry a batch. `AI_PROMPT_AGENT`
gained the matching rule — restock / whole month / sample data → all of
it in one reply, one action per record, ≤40, items and suppliers from the
catalogue — written **byte-identically** in `db.js` and `server.py`
(audit still 174/0, contract 13). `agentParse`'s peel now strips trailing
digits and separators too (`…}]5}` — the junk that reached the owner as
raw reply text) before the balance fixer, stopping at a quote so reply
text is never eaten. 2 checks. `CACHE v35`.

**Tests** — smoke **275 → 301**, audit **174**, `check_static` OK,
`cleanup_smoke` clean (the owner's 2 real purchases are tolerated by
design — the boot invariant now fails only on smoke debris).

---

## 4. What was outstanding — now DONE (2026-10-05)

1. **README Phase 3 edits — done.** Added `income` to the data model, the
   three `/api/income` routes to the API list, a **Money in** bullet under
   *What the boss sees*, the corrected `source` note (`db.js` can now produce
   `model` with a device key), "**the nine** constants" in Tests §5, and the
   shipped statement-ingestion roadmap bullet was dropped.
2. **Committed — `aa6eb20`** *AI capture pipeline phases 1-3: ai routes,
   slip capture, AI-native surface, income + statement ingest.*
   13 files, 3784 insertions: the 11 modified files plus
   `docs/SESSION_STATUS.md` and `fixtures/ai/…json`.
3. **Tests re-run green after the doc edits** — audit 160, smoke 148,
   `cleanup_smoke.py` clean, `check_static.py` OK.

### 5. Provider presets fixed (2026-10-05) — Google first

The AI connection dialog is now genuinely *select provider → paste key → Save*:

- **`AI_PROVIDERS` (`app.js`) rebuilt against live data.** Dead/stale ids
  dropped: `groq/compound` (no longer in Groq's API enum), `qwen/qwen3.6-27b`
  (exists but not on the free plan), `openai/gpt-oss-20b:free` (no longer
  free). Free, verified ids now offered — Groq `openai/gpt-oss-120b` /
  `openai/gpt-oss-20b` / `qwen/qwen3.8-27b`; OpenRouter `openrouter/free`,
  `google/gemma-4-31b-it:free`, `qwen/qwen3.8-27b:free`,
  `thinkingmachines/inkling:free`.
- **Gemini leads and is the default** (`id` stayed `"gemini"` — changing it
  would break stored configs and the smoke assertion on the option value).
  Each preset carries a `note` rendered under the picker.
- **`aiOwnModel()`** — a model id that belongs to *another* provider is
  discarded instead of being sent to the wrong endpoint (it used to survive
  a provider switch and fail only after the key was accepted). Unknown ids
  on *custom* endpoints are left alone. Save persists `aiModel()`, never the
  raw field.
- `CACHE` bumped to `pwbudget-v22`; 2 new smoke checks × 2 modes (152).
- **CORS measured, not assumed** (relevant to §7 below): `OPTIONS` preflight →
  Groq 204, Gemini 200, OpenRouter 204, **Ollama Cloud 405** — so Ollama Cloud
  is server-side only and is not offered as a device key. All three offered
  providers return a readable `Access-Control-Allow-Origin`.

### 6. Presets extended (2026-10-07) — DeepSeek, Claude via OpenRouter

A research pass over the four big platforms (Claude / Gemini / DeepSeek /
ChatGPT), applied as app changes — nothing here touches the parity pair:

- **DeepSeek preset added** (`AI_PROVIDERS` in `app.js`, before *Custom*):
  OpenAI-compatible base `https://api.deepseek.com/v1`, ids `deepseek-v4-flash`
  / `deepseek-v4-flash-vision-exp` / `deepseek-v4-pro` (read off DeepSeek's own
  pricing docs), label *cheap, reads photos*, note says pay-per-use — **no
  free-tier promise**. Cheapest vision-capable option (~$0.15/1M tokens in,
  off-peak).
- **OpenRouter datalist reaches Claude**: `anthropic/claude-haiku-4.5`, verified
  against OpenRouter's live `GET /api/v1/models`. A paid id among the free
  ones — the picker note says so, and the cross-provider rule keeps it on this
  preset alone.
- **DeepSeek CORS measured, not assumed**: `OPTIONS` from this app's own origin
  → 200 with `access-control-allow-origin: http://127.0.0.1:8123` and
  `access-control-allow-headers: authorization,content-type`.
- **Claude direct and OpenAI direct deliberately skipped**: a direct Claude
  preset needs a second wire format (Anthropic messages + the
  `anthropic-dangerous-direct-browser-access` header) in *both* engines for no
  free tier; OpenAI's browser CORS is flaky (its Responses API stopped sending
  the header in Jan 2026) and also has no free tier — GPT models stay reachable
  through Groq/OpenRouter.
- 1 new smoke check × 2 modes; presets stay generic (`aiOwnModel()` needed no
  change — new ids are on exactly one preset).

### 7. The lost approval — root cause and fix (2026-10-07)

The owner reported: an approved assistant change never showed up in
purchases/budget/dashboard after an F5. Investigation (read-only) of Edge's
`Local Storage\leveldb` for origin `http://127.0.0.1:8123` showed the whole
story in `pwbudget.agent.v1`:

- Their Gemini-key session asked for a banner purchase (40 GH₵) + budget; the
  assistant correctly proposed **only** `propose_coverage` first (area `app` —
  purchase/budget tools are locked without it). The owner approved it; the
  journal has exactly that one entry (`jid 1`, `undone: false`). No
  `create_purchase` card was ever rendered, so there was nothing else to
  approve — and `ledger.db` (0 purchases) agrees.
- The follow-up model reply (the one meant to carry the purchase) was stored
  as **raw JSON**: `… "payment_method":"cash"}}]}}` — one stray `}` too many.
  `agentParse` ran a single strict `JSON.parse`, threw *Extra data*, fell
  back to "raw text becomes the reply", and **silently dropped the
  `actions` array** — the card the owner expected never existed.

Fix — `agentParse` (`app.js`) now salvages in order: the exact object (as
before), incremental peel of stray trailing closers, the object sliced out of
surrounding prose, and a balance pass that closes a string/container a
cut-off reply left open. Unparseable text still becomes the reply (contract
unchanged); only now a stray brace can no longer swallow an approval.
3 new smoke checks × 2 modes pin each path — including their exact reply
string. Suite **229 / 0**.

---

## 5. Environment / tooling gotchas (cost real time this session)

- **PowerShell**: `&&` is not a valid statement separator in this version.
  Chain with `;` and check `$LASTEXITCODE` if you need to branch.
- A **stale server on 8123** silently answers and makes tests fail in
  confusing ways — see §2.
- Multi-line text containing quotes in a `python -c "..."` one-liner gets
  mangled by PowerShell. **Write a temp `.py` under `tools/` instead**, run it,
  then delete it.
- Temp scripts used this session and already deleted:
  `_check_prompts.py`, `_dump_prompts.py`, `_js_prompts.py`, `_tail.py`,
  `_sync_prompts.py`, `_dedupe_ai.py`, `_hoist_statement.py`,
  `_orig_prompts.json`, `check_prompts.py`. The permanent home for the
  contract check is **audit section 5**, not a separate script.
- **A burst of parallel `fetch`es can quietly downgrade the whole app.**
  `api()` calls `serverDown()` on the *first* network error, which sets
  `serverAvailable = false` for the rest of the session — every later request
  then reads the local store instead of the server. In tests this shows up as
  "why does server mode suddenly see an empty/old store?"; the symptom is a
  handful of `PW Budget: server API unreachable` warnings. Keep read fan-out
  bounded (`pool(items, fn, 4)`).
- **No desktop browser is attached to this session** — `browser.tabs.list()`
  answers `[browser.disconnected]`, and repeating it does not help. Visual work
  has to be reasoned out of the source and validated by *parsing* it (brace /
  paren / comment balance, every declaration parses, an audit of every rule that
  can size a control). Say plainly that nothing was seen rather than implying
  it was; the check that still needs a handset is in §7.

---

## 6. Rules that must keep holding

- **Keyless parity.** With `AI_API_KEY` set, `server.py` legitimately answers
  better than `db.js`. Parity is only meaningful with the key cleared.
- **The five AI routes are async offline.** `PWDB.request()` returns a
  Promise for `/api/ai/extract|instruct|statement|voice|transcribe`; every
  caller must `await`. Synchronous routes (including `/api/income`) must stay
  sync.
- **Income validation order mirrors purchases**: date → branch_id → amount →
  source. Error strings must match byte-for-byte between engines.
- `income` row JSON uses **`amount`**; purchase rows use **`total`**.
- Income amount parse: server uses inline `try: amount = _r2(float(str(...)))`
  (not `_to_float`, which is banker's rounding); `db.js` uses
  `toFloat` = `r2(parseFloat(v))`.
- Income list envelope mirrors `purchasesQuery`:
  `{rows, total, page, pages, page_size}`, default `page_size` 25, max 200,
  sort `date DESC, id DESC`.
- Key order in JSON matters for the parity harness: `series` is
  `month, spend, income, buys, credit_new`; `totals` is
  `spend, income, net, buys, …`.
- `analytics.series[].income` is only injected for months inside the window
  and respects `branch_id`.
- Statement ingest is gated by the **existing** `capture` coverage area — do
  **not** add a 5th area; smoke asserts `data-area=` count === 5 (4 areas + 1
  template literal) and the settings dialog renders exactly 4 switches.
- `db.js`'s `applyPatch` / server's `_apply_patch` run the **same field
  whitelist** over model output as over user text — never trust a model field
  name directly.
- **Purchase rows use `product` / `total`** (not `product_name` /
  `total_amount` — that shape belongs to the backup JSON envelope only), and
  credit figures live nested at `row.credit` (`paid`, `balance`, `percent`).
- **`AI_PROMPT_AGENT` and `AI_PROMPT_VOICE` are among the 13 shared
  constants** — every edit must be mirrored byte-for-byte in `server.py` and
  `public/app/db.js` or audit fails. Prompt text lives only in that pair,
  never in the UI. `/api/ai/transcribe` has no prompt but the same parity
  duty: same payload `{audio, mime, lang}`, same status codes, same
  `source:""` failure shape.
- **The assistant never writes by itself.** Every write tool renders a card
  with an Approve tap (`agentExecute` is the only writer); coverage-off tools
  are *described* to the model as locked, never hidden; `propose_coverage` is
  the one `free: true` tool and is never gated by `app`. Exactly **4**
  coverage areas — never add a 5th (smoke asserts the count).
- **Every voice chip is also a human tap.** The overlay validates at ask time
  *and again at apply time* against the amounts that were really spoken
  (`VOICE.amounts`), checks `aiAllows("app")` before touching anything,
  confirms `delete_item` / `set_total`, and keeps exactly one step of undo.
  Microphone consent is asked before the first listen
  (`pwbudget.voice.mic.v1`); audio is transient — recorded in memory,
  transcribed, dropped (same rule as images). Voice chrome strings ship
  en+fr only; the number lexicons cover en/fr/tw/ga/ee/ha.
- **The chat is a session list, not one thread.** `pwbudget.agent.v1` holds
  `{sessions[], cur, projects[], journal, voice, seq, jseq, ui}`; every page
  load archives the open chat under its keyword title (a rename sticks via
  `renamed`) and opens an empty one — `AGENT.messages` always points at the
  active session's array and `saveAgent()` writes it back before persisting.
  The pending badge counts cards across **all** sessions. `agentPlanCards`
  may turn a reply into up to `AGENT_BULK_MAX = 40` cards per tool, numbered,
  and the same-tool dedupe must not come back.
- Bump `CACHE` in `public/app/sw.js` whenever `app.js`/`db.js`/`styles.css`/
  `index.html` change (cache-first SW). Current: `pwbudget-v35`.

---

## 7. Known blockers / deferred work

- **Phase 0 landed** (this session, see §3): backup / restore / CSV export is
  reachable from *Your data*, and a refused write now returns 507 with the
  store rolled back plus a persistent banner. Still not done in that area:
  - **First-run onboarding** (nothing tells a new owner to download a backup).
  - The **admin** `EXPORT_KINDS` CSV path still exists alongside the new
    owner-facing export; they are separate code paths.
  - `importData()` accepts a whole-store replace, but **no UI offers it** —
    restore is additive by design, so a "wipe and restore" flow (explicit,
    confirmed) is a deliberate future decision, not an oversight.
  - The red banner only appears **after** a write fails; a device that is
    already full at load time shows it on boot (`init()` calls
    `renderStorageBanner()`), but there is no proactive free-space check.
- **Real vision provider untested in a browser.** CORS for the offered
  providers is now **measured**: preflight passes for Groq (204), Gemini (200),
  OpenRouter (204) and DeepSeek (200), each returning a readable
  `Access-Control-Allow-Origin` — so the browser is allowed to call them.
  What is still untested is a **real key** making a real vision call (no key
  in this session, and no desktop browser connected). If it is ever blocked,
  `aiChat` returns `null`, the built-in rules run, and the strip goes red with
  `Could not reach <model> — using built-in rules instead.`
  Note **Ollama Cloud is not an option here**: its preflight answers 405 with
  no CORS headers, so it works from `server.py` only.
- Preset model IDs in the settings datalist may be stale — *Test connection*
  is the workaround.
- `save()` aside, no real-device check of the new Money in view has happened;
  only the headless DOM-stub smoke has.
- **The mobile UI pass (§3) has never been seen on a handset** — it was derived
  by parsing `styles.css`, not by rendering it. Before trusting it, look at
  *More → Your data*, the **Money in** dialog (both used to render flush to the
  screen edge), the **More sheet** and the **calculator** held sideways (both
  used to clip), and tap a few controls for size.
- **The assistant v2 pass (§3) has only been exercised headless** (smoke's DOM
  stub, offline + server modes). Not yet checked on a handset: the brief card,
  follow-up chips, **Approve all**, the *Try again* card, and voice auto-speak.
  Also still untested with a **real attached model** — the failure/retry path
  was proven against an unreachable endpoint, not a live provider rate-limit.
- **The voice overlay (§3) has only been exercised headless.** Unverified on a
  handset: the drag-to-move panel, mic consent + real `getUserMedia`,
  live Web Speech recognition, TTS read-aloud, and chip taps against the real
  budget view. The **STT matrix has never run against a live key**: whisper
  transcription was only exercised as a mocked recorder → route contract
  (400 without audio, `source:""` when unreachable), and Web Speech only
  against the harness's fake recognizer. Web Speech itself truly transcribes
  **en/fr** — tw/ga/ee/ha need the Whisper path (a key). The wake word
  ("Hey Budget") is deliberately **dormant**, not half-built: nothing listens
  until the mic is tapped.

---

## 8. Next phase (not started)

| Phase | What | Notes from the plan |
|---|---|---|
| 4 | Knowledge base: `documents` / `references`, `/api/search`, then ask-your-books chat | FTS5 server-side; tokenizer + scorer in `db.js`; embeddings only when online. "Worthless until phases 2–3 have produced data" — they now do. |
| 5 | Builder | Declarative JSON patch against a field whitelist. Never HTML, never `eval`'d JS, never SQL. Riskiest surface. |

Other roadmap ideas in `README.md`: low-stock warnings per item, PIN lock on
the installed app. (CSV export for the owner has since shipped — *Your data*.)

**Suggested first move in a new session:** everything through the voice
overlay is committed (`d2cdec2`) and green — **review in a browser**
(http://127.0.0.1:8123/app/, server restarted this session on :8123): open the
🎤 overlay, allow the mic once, say *"set the budget to 5,000 cedis, add 800
for transport"* in any of the six languages, tap the chips, undo, and check
the change log's gold-railed rows. Then pick **Phase 4** (knowledge base /
`documents` / `references` / ask-your-books) — or close the standing gaps in
§7 first: a **real-key** STT/extract round trip (browser CORS already measured
for all presets) and the handset pass over assistant + voice.
