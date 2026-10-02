# PW Budget — Stock, Distributors, Credit & Analytics

A dead-simple stock-purchasing app for a print shop (DTF / garment printing).
Tap **＋ New Purchase**, type the distributor and item, quantity and amount
paid — unit price is calculated automatically, new distributors/items are saved
into dropdowns for next time, credit purchases compute the balance and
%-cleared on their own, and the analytics dashboard shows exactly what any
item costs.

**Zero installs — pure Python standard library** on the server, and the app
itself is a **Progressive Web App (PWA)** that installs onto phones and runs
**completely offline** once installed.

---

## Two ways the app runs

| Mode | When | Data lives | Internet? |
|---|---|---|---|
| **Offline PWA** | Installed via "Add to Home Screen" (or `…?offline` in the URL) | `localStorage` on the phone | **No — fully offline** |
| **Server app** | Opened in a normal browser tab | `ledger.db` on the server | Yes |

The installed app is a proper PWA: it opens in its own window with its own
icon, and every feature — purchases, credits, budgets, analytics **and the
built-in calculator** — works in airplane mode. The full Python backend was
ported to a client-side engine in `public/app/db.js` with the *same* API
contract, so nothing in the UI changes.

> Note: the two modes keep separate data. If the boss uses the browser version
> and then installs, the installed copy starts fresh (empty). Install first,
> then use the app from the home-screen icon.

## What the boss sees

- **Dashboard** — monthly spend, outstanding credit, budget headroom, charts,
  most-bought items, recent purchases, credit watch, plus a **reminders**
  strip: overdue credit (“X is 60 days old — pay it”), credits ageing past 30
  days, budget over/90% burn, and unit-price spikes — worst first, hidden when
  everything is quiet. The **Credits** tab carries a live count badge.
- **Purchases** — filter / search / paginate every entry; move entries between
  branches; delete.
- **Credits** — outstanding accounts with balance + %-settled progress and
  payment history; "Pay now" records later payments and recomputes everything.
  Each open credit shows how **old** it is (⏳ 60+ days = overdue) and an
  *Oldest open credit* KPI, so nothing quietly rots.
- **Analytics** — spend per item, most-bought by quantity, per distributor,
  payment mix, monthly trend, unit-price trends.
- **Budget** — year + month + total + savings target; ⚡ auto-distributes the
  spendable amount across items from purchase history; editable percentages;
  plan vs actual.
- **Branches** — add shops/plants; clicking a branch opens its dashboard.
- **🧮 Calculator** — the floating button (bottom-right, chat-widget style)
  opens a calculator on any screen. Keyboard, √, %, x², decimals, operator
  precedence, errors handled.
- **☀️ / 🌙 Bright or dark screen** — the toggle in the top bar (and the
  *Appearance* switch inside **Your shop identity**) repaints the whole app:
  onyx-&-gold **dark** (default) or a **bright** paper screen with the same
  gold accents, re-tuned for daylight contrast — tables, charts, dialogs,
  calculator and the browser's theme colour all follow. Saved per device under
  `pwbudget.theme.v1` and applied before first paint, so there is no flash.
  Works identically offline and in server mode.

## Run the server

```
python server.py          # → http://127.0.0.1:8000
python server.py 8123     # optional: different port
python server.py --demo   # optional: fresh DB with 6 months of sample data
```

- **First launch starts clean** — one default `Main Shop`, no test data.
- `--demo` seeds 6 months of realistic purchases.
- Data lives in `ledger.db` next to `server.py`.

## Websites served

| URL | What it is |
|---|---|
| `/` | **PRAXIS company site** — brand landing for the studio (products, story, contact). |
| `/pw-budget/` | **PW Budget download site** — features + step-by-step install for iPhone (Safari → Share → Add to Home Screen) and Android (Chrome → Install app). |
| `/app/` | The app itself (PWA). Also `index.html`, `sw.js`, `manifest.webmanifest` and `icons/` live here. |
| `/api/*` | JSON API (server mode). |

## Install on a phone (once, over Wi-Fi)

1. Open the **PRAXIS site** (e.g. `https://<tunnel>.trycloudflare.com/`), then the **PW Budget** product page (`/pw-budget/`).
2. **iPhone/iPad**: open in *Safari* → Share → **Add to Home Screen** → Add.
   **Android**: open in *Chrome* → ⋮ → **Install app** / **Add to Home screen**.
3. Tap the new **PW Budget** icon — it launches standalone and works offline.

There is no `.apk` because the boss has an iPhone — iOS can't install APKs.
The PWA *is* the iOS-native install path (it gets its own icon, window, and
runs offline). The download page says exactly this.

## Look & branding (one design system)

Every surface — landing page (`/`), download page (`/pw-budget/`), the app
(`/app/`) and the PWA icons — is built from the same onyx-&-gold tokens:

- `public/theme.css` (marketing pages) and `public/app/styles.css` (the app)
  carry an **identical token block**: `--bg #07070a`, `--bg2 #0b0b10`,
  `--panel #121218`, `--ink #f4efe3`, `--muted/--sub #a49b89`,
  `--gold #d4af37`, `--gold-hi #f7e7a8`, `--radius 14px`, `--btn-radius 12px`,
  `--shadow`, plus the amber/green/red/teal/violet accent set. Change both
  files together when you retune the palette.
- Shared geometry: 12px buttons (gold-grad + sheen sweep on hover, gold ghost
  variant), 14px cards with the same gradient/border/shadow, 20px pills,
  gold `:focus-visible` ring, `color-scheme: dark`.
- **Icons follow the front page**: the mark is the faceted gold pyramid from
  `public/logo.svg`, drawn on the app's onyx→bronze tile by
  `python tools/make_icons.py` → `public/app/icons/*.png` (PWA + home screen),
  `public/favicon.svg` and `public/favicon.ico` (browser tabs).

## Going live on Render

`render.yaml` ships with the repo:

1. Push to GitHub → Render → **New → Blueprint** (auto-detects `render.yaml`).
2. You get `/`, `/pw-budget/`, `/app/` **and** the live `/api` backend.
   `server.py` picks up Render's `$PORT` and binds `0.0.0.0` via `HOST`.
3. **Free plan:** `ledger.db` lives on the instance disk and is reset on each
   redeploy. On a paid plan attach a disk mounted at `/var/data` and add the
   env var `PWBUDGET_DATA_DIR=/var/data` (already supported — see `render.yaml`).

No backend needed? Create a **Static Site** with publish directory `public`
instead — the PWA detects the missing `/api` and switches to its offline
storage engine. Same for `vercel.json` and `netlify.toml`.

## Going live with a stable link

The dev tunnel uses Cloudflare *quick tunnels* — the URL is temporary and
changes when cloudflared restarts. The installed app keeps working offline
regardless, but for a permanent shareable link do this once:

```
# 1) Download the binary (run as admin once to login):
cloudflared-windows-amd64.exe tunnel login

# 2) Give the tunnel a name, then point it at the app:
cloudflared-windows-amd64.exe tunnel create pwbudget
cloudflared-windows-amd64.exe tunnel route dns pwbudget app.yourdomain.com
cloudflared-windows-amd64.exe tunnel run pwbudget
```

and use the local `--url` flag pointing at `http://localhost:8123` (or edit the
tunnel's config file's ingress). Any static host works too because the app is
fully client-side after install.

## Data model

```
branches         shops / plants — every purchase belongs to one
distributors     suppliers, auto-registered on first use
products         items with a default unit, auto-registered on first use
purchases        date, branch, distributor, product, qty + unit, total paid,
                 unit price (auto), payment method; credit carries original
                 price + amount paid
credit_payments  later payments against a credit purchase (drives balance)
budgets          year + month + total + savings target + item allocations (%)
```

Offline engine (`public/app/db.js`) mirrors this JSON-in-`localStorage`.

## HTTP API (server mode)

```
GET  /api/meta                      branches, distributors, products, units, currency
GET  /api/branches                  list branches        POST /api/branches {name}   create
GET  /api/purchases?[branch_id&month&frm&to&distributor&product&payment&owed&q&page&page_size]
POST /api/purchases                 {date, branch_id, distributor, product, unit, quantity,
                                     total_amount, payment_method, credit_paid?, memo}
DELETE /api/purchases/<id>          delete a purchase (and its credit payments)
POST /api/purchases/<id>/pay        {date, amount}  repay credit — balance re-computed
POST /api/purchases/<id>/move       {branch_id}     send the entry to another branch
GET  /api/credits?branch_id=        open + settled credit list, outstanding totals
GET  /api/analytics?branch_id=&n=6  item / distributor / monthly / payment-mix split,
                                     unit-price trends, credit totals
GET  /api/budget?year=&month=&branch_id=          current plan or auto-suggestion
POST /api/budget                    {year, month, branch_id, total_amount, save_amount,
                                     allocations:[{name, percent}]}
```

Example:

```
curl -X POST http://127.0.0.1:8000/api/purchases -H "Content-Type: application/json" \
  -d '{"date":"2026-09-22","branch_id":1,"distributor":"Ceda Industrial Supplies",
       "product":"DTF Powder","unit":"bag","quantity":200,"total_amount":21600,
       "payment_method":"Credit","credit_paid":5000}'
```

Server computes unit price (108.00), finds/creates the distributor and product,
and stashes balance (16,600) and %-cleared (23.1%).

## Tests

```
node smoke_test.js
```

Runs the **real** `public/app/app.js` + `public/app/db.js` headlessly in Node
with a DOM stub, in **both modes** (offline engine + server via fetch). Covers
every view, cash/credit entry, later payments, budget auto-distribute, branch
creation + navigation, analytics, and the calculator math. Server smoke data
is deleted by the harness; run `python tools/cleanup_smoke.py` afterwards if
anything lingers (it also reports the clean state).

```
node audit_calculations.js
```

Answers *"is the arithmetic actually right?"* in three sections:

1. **Calculator** — drives the real `calcEval()`/`calcPush()` with ~70
   expressions, simulated key taps and malformed input. Guards against the
   class of bug where the keypad's `−` (U+2212) didn't match the tokenizer's
   ASCII `-` and every subtraction answered *Error*.
2. **Engine parity** — replays one identical call sequence against the offline
   engine *and* a live `server.py`, then requires matching status codes,
   figures and error strings. Opaque row ids are ignored (the engines ship
   different seed catalogs by design); everything else must match, because a
   user should see the same numbers online and offline.
3. **Invariants** — arithmetic that must hold whatever the engine: credit
   `paid + balance == total`, `qty × unit_price == total`, every analytics
   breakdown summing to its total, `spendable == total - save`, allocation
   percents summing to 100 after 1dp rounding, and the validation rules that
   keep them true.

Self-contained — it starts its own server on a free port against a throwaway
data directory, so it never touches your real `ledger.db`. Exit code is
non-zero on any failure.

## Tools / config

- `tools/make_icons.py` — regenerate the PWA icons **and** `public/favicon.ico`
  from the front-page pyramid mark (pure stdlib PNG writer).
- `tools/check_static.py` — verify every page/asset/MIME is served.
- `tools/cleanup_smoke.py` — wipe any leftover smoke-test rows.
- **Currency** — `CURRENCY` in `server.py` *and* `CURRENCY` in `public/app/db.js`.
- **Payment methods** — `PAYMENT_METHODS` in both files too.
- **App data** remains in `ledger.db` for server mode; offline data is in the
  phone's `localStorage` under key `pwbudget.v1`.

## Roadmap ideas

The AI / automation direction (features, inference approach, constraints) is
written down in [`docs/AI_AUTOMATION_PLAN.md`](docs/AI_AUTOMATION_PLAN.md),
together with a summary of how this codebase is put together.

- Receipt OCR: snap a supplier invoice → distributor, item, amount pre-filled.
- Low-stock warnings per item (credit age, budget burn and price-spike
  reminders already ship — see Dashboard).
- CSV export of purchases and credits.
- Simple PIN lock on the installed app.