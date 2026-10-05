# Session status — handoff notes

> **Read this first when starting a new session.** It is a snapshot of where
> work stopped, what is green, and what is left. Last updated **2026-10-05**:
> Phase 3 README edits done, Phases 1–3 committed as `aa6eb20`.
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
node smoke_test.js          -> 152 passed, 0 failed
node audit_calculations.js  -> 160 passed, 0 failed (79 parity steps, 9 shared constants)
python tools/cleanup_smoke.py   -> clean (branches: Main Shop; purchases: 0)
python tools/check_static.py    -> OK
```

Notes:

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
  custom OpenAI-compatible), key + model, *Test connection*, *Forget*.
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

---

## 6. Rules that must keep holding

- **Keyless parity.** With `AI_API_KEY` set, `server.py` legitimately answers
  better than `db.js`. Parity is only meaningful with the key cleared.
- **The three AI routes are async offline.** `PWDB.request()` returns a
  Promise for `/api/ai/extract|instruct|statement`; every caller must `await`.
  Synchronous routes (including `/api/income`) must stay sync.
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
- Bump `CACHE` in `public/app/sw.js` whenever `app.js`/`db.js`/`styles.css`/
  `index.html` change (cache-first SW).

---

## 7. Known blockers / deferred work

- **Phase 0 never landed** (chosen last in an earlier session, then postponed
  in favour of Phase 3). Still missing and still important:
  - **Zero backup / restore / export for the end user.** The PWA stores
    everything in `localStorage["pwbudget.v1"]`.
  - `save()` in `db.js` **silently swallows quota errors** — a full device can
    lose a write with no warning.
  - No first-run onboarding, no CSV export reachable by the shop owner
    (there *is* an admin `EXPORT_KINDS` path, incl. the new `"income"`).
- **Real vision provider untested in a browser.** CORS for the three offered
  providers is now **measured**: preflight passes for Groq (204), Gemini (200)
  and OpenRouter (204), each returning a readable
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

---

## 8. Next phase (not started)

| Phase | What | Notes from the plan |
|---|---|---|
| 4 | Knowledge base: `documents` / `references`, `/api/search`, then ask-your-books chat | FTS5 server-side; tokenizer + scorer in `db.js`; embeddings only when online. "Worthless until phases 2–3 have produced data" — they now do. |
| 5 | Builder | Declarative JSON patch against a field whitelist. Never HTML, never `eval`'d JS, never SQL. Riskiest surface. |

Other roadmap ideas in `README.md`: low-stock warnings per item, CSV export
for the owner, PIN lock on the installed app.

**Suggested first move in a new session:** pick **Phase 0** (backup/restore +
making `db.js`'s silent `save()` quota failure loud) — the biggest real-world
risk — or run the still-unanswered **browser CORS check** against a real
vision provider (§7), which decides whether live capture actually works before
Phase 4 build on top of it.
