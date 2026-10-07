"""
PW Budget - Print Shop Stock, Distributor, Credit & Analytics
==============================================================
Pure Python standard library. No installs.
Run:  python server.py   ->  http://127.0.0.1:8000
      /            PRAXIS company site
      /pw-budget/  PW Budget download site
      /app/        the PWA itself

Data model
  branches      shops / plants. Every purchase belongs to one branch.
  distributors  suppliers, auto-registered on first use (dropdown for later).
  products      items with a default unit, auto-registered on first use.
  purchases     the daily entry: date, branch, distributor, product, qty+unit,
                total paid, unit price (auto), payment method.
                Credit purchases carry original price + amount paid; balance
                and %-cleared are derived (later payments live in credit_payments).
  budgets       year+month plan: total + savings target + per-item allocations.
"""

import calendar
import csv
import datetime as dt
import hashlib
import hmac
import io
import json
import os
import random
import re
import secrets
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import urllib.request

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
CURRENCY = "GH\u20b5"
# Same sentence db.js uses when a write cannot be stored: the offline engine
# and this server must report an unsaved change identically (status 507).
STORAGE_FULL_ERROR = "storage is full — this change was not saved. Export a backup and free some space, then try again."

# Hosting: Render (or any PaaS) injects $PORT and expects the process on
# 0.0.0.0. Locally nothing changes: 127.0.0.1:8000 by default.
#   PWBUDGET_DATA_DIR  where ledger.db lives — point it at a mounted disk so
#                      the data survives redeploys (see render.yaml).
_data = os.environ.get("PWBUDGET_DATA_DIR") or str(BASE_DIR)
DATA_DIR = Path(_data)
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError:      # read-only/ephemeral filesystem: fall back to the app dir
    DATA_DIR = BASE_DIR
DB_PATH = DATA_DIR / "ledger.db"
HOST = os.environ.get("HOST") or "127.0.0.1"
# CLI: python server.py [port] [--demo]  (CLI port wins over $PORT)
#   --demo  seeds 6 months of sample data on a fresh database
PORT = 8000
try:
    PORT = int(os.environ.get("PORT") or 8000)
except ValueError:
    sys.exit("PORT must be an integer")
for _arg in sys.argv[1:]:
    if _arg in ("--demo", "--seed"):
        continue
    try:
        PORT = int(_arg)
    except ValueError:
        sys.exit(f"Usage: python server.py [port] [--demo]")

PAYMENT_METHODS = ["Cash", "Bank Transfer", "Mobile Money", "Credit"]
UNIT_SUGGESTIONS = ["bag", "roll", "pack", "set", "bottle", "kg",
                    "box", "piece", "litre", "carton", "can"]

# ---------------------------------------------------------------------------
# Admin (single-user) configuration
# ---------------------------------------------------------------------------
# The /admin directory is gated behind one account. The FIRST person to open
# /admin signs up (username + password) and that locks the account — no further
# signups are possible. You can instead pre-seed the account with env vars:
#   PWBUDGET_ADMIN_USER / PWBUDGET_ADMIN_PASS
# Sessions are random tokens stored in the DB and delivered via an HttpOnly
# cookie. The audit_log table is a hash chain, so any edit to a past entry
# breaks verification (useful for legal / accounting records).
COOKIE_NAME = "pwadmin_session"
SESSION_DAYS = 7
PBKDF2_ROUNDS = 200_000
MAX_FAILED_LOGINS = 8            # per IP before a cooldown kicks in
LOGIN_COOLDOWN_SEC = 300

# ---------------------------------------------------------------------------
# AI (optional) configuration
# ---------------------------------------------------------------------------
# Nothing in here is required to run the app. With no key, every /api/ai/*
# route falls back to the deterministic heuristic — which is exactly what
# public/app/db.js implements — so a keyless server and the offline engine
# answer byte-for-byte alike. audit_calculations.js relies on that and clears
# AI_API_KEY in the server it spawns.
#   AI_API_KEY           secret for an OpenAI-compatible endpoint
#   AI_BASE_URL          default https://api.openai.com/v1 (OpenAI, Groq,
#                        OpenRouter, DeepSeek, Ollama, ... — needs vision for
#                        the camera feature)
#   AI_MODEL             default gpt-4o-mini
#   AI_TIMEOUT           seconds, default 45
#   AI_FIXTURES          directory of recorded responses, replayed by request
#                        digest — the recorded-fixture mock from the plan
#   AI_FIXTURES_RECORD=1 write model responses into AI_FIXTURES as they land
AI_API_KEY = os.environ.get("AI_API_KEY") or ""
AI_BASE_URL = os.environ.get("AI_BASE_URL") or "https://api.openai.com/v1"
AI_MODEL = os.environ.get("AI_MODEL") or "gpt-4o-mini"
try:
    AI_TIMEOUT = float(os.environ.get("AI_TIMEOUT") or "45")
except ValueError:
    AI_TIMEOUT = 45.0
AI_FIXTURES = os.environ.get("AI_FIXTURES") or ""
AI_FIXTURES_RECORD = os.environ.get("AI_FIXTURES_RECORD") == "1"

SCHEMA = """
CREATE TABLE IF NOT EXISTS branches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS distributors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    unit_default  TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,
    branch_id       INTEGER NOT NULL REFERENCES branches(id),
    distributor_id  INTEGER REFERENCES distributors(id),
    product_id      INTEGER REFERENCES products(id),
    product_name    TEXT NOT NULL,
    unit            TEXT NOT NULL DEFAULT 'bag',
    quantity        REAL NOT NULL CHECK(quantity > 0),
    total_amount    REAL NOT NULL CHECK(total_amount > 0),
    unit_price      REAL NOT NULL CHECK(unit_price >= 0),
    payment_method  TEXT NOT NULL,
    credit_total    REAL,
    credit_paid     REAL,
    memo            TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS credit_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    amount      REAL NOT NULL CHECK(amount > 0),
    memo        TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
);
-- Money IN: takings, deposits, MoMo/bank credits. Without this the app only
-- ever reports spend, and statement ingest has nowhere to put a credit row.
CREATE TABLE IF NOT EXISTS income (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    branch_id  INTEGER NOT NULL REFERENCES branches(id),
    source     TEXT NOT NULL,
    reference  TEXT DEFAULT '',
    amount     REAL NOT NULL CHECK(amount > 0),
    memo       TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS budgets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id        INTEGER REFERENCES branches(id),
    year             INTEGER NOT NULL,
    month            INTEGER NOT NULL,
    total_amount     REAL NOT NULL DEFAULT 0,
    save_amount      REAL NOT NULL DEFAULT 0,
    allocations_json TEXT NOT NULL DEFAULT '[]',
    updated_at       TEXT DEFAULT (datetime('now')),
    UNIQUE(branch_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_purch_date   ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_purch_branch ON purchases(branch_id);
CREATE INDEX IF NOT EXISTS idx_purch_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_income_date   ON income(date);
CREATE INDEX IF NOT EXISTS idx_income_branch ON income(branch_id);
CREATE TABLE IF NOT EXISTS admin_user (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    username   TEXT NOT NULL,
    pass_salt  TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    detail    TEXT NOT NULL DEFAULT '',
    ip        TEXT NOT NULL DEFAULT '',
    prev_hash TEXT NOT NULL DEFAULT '',
    row_hash  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
"""


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _to_int(value, default=0):
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return default


def _to_float(value, default=0.0):
    try:
        return round(float(str(value)), 2)
    except (TypeError, ValueError):
        return default


def _month_list(end_date, n):
    """Oldest -> newest list of (year, month) tuples ending at end_date."""
    y, m = end_date.year, end_date.month
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(out))


def _month_bounds(year, month):
    first = dt.date(year, month, 1)
    last = dt.date(year, month, calendar.monthrange(year, month)[1])
    return first, last


# ---------------------------------------------------------------------------
# Auth (single admin user) + tamper-evident audit log
# ---------------------------------------------------------------------------
_LOGIN_ATTEMPTS = {}             # ip -> [count, first_ts]
_LOGIN_LOCK = threading.Lock()


def _utcnow():
    return dt.datetime.now(dt.timezone.utc)


def _hash_password(password, salt_hex):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ROUNDS
    ).hex()


def admin_exists(conn):
    return conn.execute("SELECT 1 FROM admin_user WHERE id = 1").fetchone() is not None


def create_admin_user(conn, username, password):
    salt = secrets.token_hex(16)
    conn.execute(
        "INSERT INTO admin_user(id, username, pass_salt, pass_hash) VALUES (1,?,?,?)",
        (username, salt, _hash_password(password, salt)),
    )
    conn.commit()


def verify_admin(conn, username, password):
    row = conn.execute("SELECT username, pass_salt, pass_hash FROM admin_user WHERE id = 1").fetchone()
    if not row:
        return None
    if not hmac.compare_digest(row["username"], username or ""):
        return None
    if not hmac.compare_digest(_hash_password(password or "", row["pass_salt"]), row["pass_hash"]):
        return None
    return row["username"]


def create_session(conn, username):
    token = secrets.token_urlsafe(32)
    exp = (_utcnow() + dt.timedelta(days=SESSION_DAYS)).isoformat()
    conn.execute(
        "INSERT INTO sessions(token, username, expires_at) VALUES (?,?,?)",
        (token, username, exp),
    )
    conn.commit()
    return token


def get_session(conn, token):
    if not token:
        return None
    row = conn.execute("SELECT username, expires_at FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return None
    try:
        exp = dt.datetime.fromisoformat(row["expires_at"])
    except ValueError:
        exp = _utcnow()
    if exp < _utcnow():
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return None
    return row["username"]


def destroy_session(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def _throttle_check(ip):
    """Return seconds to wait (0 if allowed). Sliding window brute-force guard."""
    now = _utcnow().timestamp()
    with _LOGIN_LOCK:
        rec = _LOGIN_ATTEMPTS.get(ip)
        if not rec or now - rec[1] > LOGIN_COOLDOWN_SEC:
            return 0
        if rec[0] >= MAX_FAILED_LOGINS:
            return int(LOGIN_COOLDOWN_SEC - (now - rec[1]))
        return 0


def _throttle_fail(ip):
    now = _utcnow().timestamp()
    with _LOGIN_LOCK:
        rec = _LOGIN_ATTEMPTS.get(ip)
        if not rec or now - rec[1] > LOGIN_COOLDOWN_SEC:
            _LOGIN_ATTEMPTS[ip] = [1, now]
        else:
            rec[0] += 1


def _throttle_clear(ip):
    with _LOGIN_LOCK:
        _LOGIN_ATTEMPTS.pop(ip, None)


def audit(conn, actor, action, detail="", ip=""):
    """Append a hash-chained entry. Returns the new row_hash."""
    detail = (detail or "")[:500]
    last = conn.execute("SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1").fetchone()
    prev = last["row_hash"] if last else ""
    ts = _utcnow().isoformat(timespec="seconds")
    row_hash = hashlib.sha256(f"{prev}|{ts}|{actor}|{action}|{detail}".encode("utf-8")).hexdigest()
    conn.execute(
        "INSERT INTO audit_log(ts, actor, action, detail, ip, prev_hash, row_hash)"
        " VALUES (?,?,?,?,?,?,?)",
        (ts, actor or "anonymous", action, detail, ip or "", prev, row_hash),
    )
    conn.commit()
    return row_hash


def audit_list(conn, limit=200, offset=0):
    limit = min(1000, max(1, limit))
    rows = conn.execute(
        "SELECT id, ts, actor, action, detail, ip, row_hash FROM audit_log"
        " ORDER BY id DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) c FROM audit_log").fetchone()["c"]
    return {"rows": [dict(r) for r in rows], "total": total}


def audit_verify(conn):
    """Walk the chain oldest->newest; any edit/insert/delete breaks it."""
    prev = ""
    count = 0
    for r in conn.execute("SELECT id, ts, actor, action, detail, prev_hash, row_hash"
                          " FROM audit_log ORDER BY id ASC").fetchall():
        expected = hashlib.sha256(
            f"{r['prev_hash']}|{r['ts']}|{r['actor']}|{r['action']}|{r['detail']}".encode("utf-8")
        ).hexdigest()
        if r["prev_hash"] != prev or expected != r["row_hash"]:
            return {"ok": False, "broken_at": r["id"], "verified": count}
        prev = r["row_hash"]
        count += 1
    return {"ok": True, "verified": count}



# ---------------------------------------------------------------------------
# Seed - 6 months of realistic DTF / print-shop stock purchases
# ---------------------------------------------------------------------------
BRANCH_SEED = ["Main Plant", "Accra Shop"]

PRODUCT_SEED = [
    ("DTF Powder",              "bag",     (80, 140), (40, 200)),
    ("PET Film - A3",           "roll",    (90, 160), (8, 40)),
    ("CMYK DTF Ink Set",        "set",     (700, 1200), (2, 8)),
    ("White DTF Ink",           "bottle",  (130, 240), (3, 12)),
    ("Hot-Melt Adhesive Powder", "bag",    (35, 65),  (15, 80)),
    ("Transfer Paper - A3",     "pack",    (45, 90),  (20, 90)),
    ("Heat Transfer Tape",      "roll",    (25, 55),  (4, 20)),
    ("Blank T-Shirts",          "piece",   (18, 42),  (30, 120)),
]

DIST_SEED = [
    "Ceda Industrial Supplies", "GoldLink Printing Distributors",
    "Future Ink Services", "TransDream Films", "UrbanStock Supplies",
    "Kumasi Bulk Traders",
]

PRODUCT_DIST = {
    "DTF Powder": ["Ceda Industrial Supplies", "Kumasi Bulk Traders"],
    "PET Film - A3": ["TransDream Films", "GoldLink Printing Distributors"],
    "CMYK DTF Ink Set": ["Future Ink Services", "GoldLink Printing Distributors"],
    "White DTF Ink": ["Future Ink Services", "Ceda Industrial Supplies"],
    "Hot-Melt Adhesive Powder": ["Ceda Industrial Supplies", "Kumasi Bulk Traders"],
    "Transfer Paper - A3": ["UrbanStock Supplies", "GoldLink Printing Distributors"],
    "Heat Transfer Tape": ["UrbanStock Supplies"],
    "Blank T-Shirts": ["UrbanStock Supplies", "Kumasi Bulk Traders"],
}

PURCHASE_MEMOS = [
    "", "", "", "", "", "monthly restock", "big job forward order",
    "client rush order", "warehouse stock-up",
]


def seed_demo(conn):
    rng = random.Random(11)
    today = dt.date.today()
    months = _month_list(today, 6)

    for name in BRANCH_SEED:
        conn.execute("INSERT INTO branches(name) VALUES (?)", (name,))
    dist_ids = {}
    for name in DIST_SEED:
        cur = conn.execute("INSERT INTO distributors(name) VALUES (?)", (name,))
        dist_ids[name] = cur.lastrowid
    prod_ids = {}
    for name, unit, _, _ in PRODUCT_SEED:
        cur = conn.execute("INSERT INTO products(name, unit_default) VALUES (?, ?)", (name, unit))
        prod_ids[name] = cur.lastrowid

    pm_weights = [38, 27, 18, 17]          # Cash, Bank, Mobile, Credit
    for (y, m) in months:
        last_day = calendar.monthrange(y, m)[1]
        is_current = (y, m) == (today.year, today.month)
        max_day = today.day if is_current else last_day
        branch = rng.choice([1, 2])         # 1=Main Plant, 2=Accra Shop

        count = rng.randint(9, 14)
        for _ in range(count):
            name, unit, (plo, phi), (qlo, qhi) = rng.choice(PRODUCT_SEED)
            day = rng.randint(1, min(28, max_day))
            qty = float(rng.randint(qlo, qhi))
            unit_price = round(rng.uniform(plo, phi), 2)
            total = round(qty * unit_price, 2)
            dist_name = rng.choice(PRODUCT_DIST[name])
            pm = rng.choices(PAYMENT_METHODS, weights=pm_weights)[0]
            memo = rng.choice(PURCHASE_MEMOS)

            credit_total = credit_paid = None
            if pm == "Credit":
                credit_total = total
                credit_paid = round(total * rng.uniform(0, 0.6), 2)

            conn.execute(
                """INSERT INTO purchases(date, branch_id, distributor_id, product_id,
                   product_name, unit, quantity, total_amount, unit_price,
                   payment_method, credit_total, credit_paid, memo)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (dt.date(y, m, day).isoformat(), branch, dist_ids[dist_name],
                 prod_ids[name], name, unit, qty, total, unit_price,
                 pm, credit_total, credit_paid, memo),
            )

    # settle a few older credit purchases and pay others down
    rows = conn.execute(
        """SELECT id, credit_total, credit_paid FROM purchases
           WHERE payment_method='Credit' AND credit_total > credit_paid
           ORDER BY date ASC"""
    ).fetchall()
    for idx, r in enumerate(rows):
        if idx % 3 == 0:                       # fully settled later
            amount = r["credit_total"] - r["credit_paid"]
        elif idx % 3 == 1:                     # partial pay-down
            amount = round((r["credit_total"] - r["credit_paid"]) * 0.5, 2)
        else:
            continue
        pay_date = dt.date.fromisoformat(
            conn.execute("SELECT date d FROM purchases WHERE id = ?", (r["id"],)).fetchone()["d"]
        ) + dt.timedelta(days=14)
        if pay_date <= today and amount > 0:
            conn.execute(
                "INSERT INTO credit_payments(purchase_id, date, amount, memo) VALUES (?,?,?,?)",
                (r["id"], pay_date.isoformat(), amount, "auto partial / full settlement"),
            )

    # seed a current-month budget from purchase history so the planner is alive
    rec = recommend_budget(conn, None, today.year, today.month)
    if rec:
        last_month = today.replace(day=1) - dt.timedelta(days=1)
        lm = last_month.strftime("%Y-%m")
        prev_spend = conn.execute(
            "SELECT COALESCE(SUM(total_amount), 0) s FROM purchases WHERE date LIKE ?",
            (lm + "-%",),
        ).fetchone()["s"]
        total = round(prev_spend * 1.05, -2) if prev_spend else 0
        save = round(total * 0.10, 2)
        if total > 0:
            conn.execute(
                "INSERT INTO budgets(branch_id, year, month, total_amount, save_amount, allocations_json)"
                " VALUES (NULL, ?, ?, ?, ?, ?)",
                (today.year, today.month, total, save, json.dumps(rec, ensure_ascii=False)),
            )

    conn.commit()


# ---------------------------------------------------------------------------
# Reporting / query helpers
# ---------------------------------------------------------------------------
def distributor_id(conn, name):
    if not name:
        return None
    row = conn.execute("SELECT id FROM distributors WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO distributors(name) VALUES (?)", (name.strip(),))
    return cur.lastrowid


def product_id(conn, name, unit):
    if not name:
        return None, name
    row = conn.execute("SELECT id, unit_default FROM products WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
    if row:
        if unit and not row["unit_default"]:
            conn.execute("UPDATE products SET unit_default = ? WHERE id = ?", (unit, row["id"]))
        return row["id"], row["unit_default"] or unit or "bag"
    cur = conn.execute("INSERT INTO products(name, unit_default) VALUES (?, ?)", (name.strip(), unit or "bag"))
    return cur.lastrowid, unit or "bag"


def credit_stats(conn, purchase_id=None, branch_id=None):
    """Return rows with current paid_total / balance / percent per credit purchase."""
    where = ["p.payment_method = 'Credit'"]
    args = []
    if purchase_id is not None:
        where.append("p.id = ?")
        args.append(purchase_id)
    if branch_id is not None:
        where.append("p.branch_id = ?")
        args.append(branch_id)
    rows = conn.execute(
        f"""
        SELECT p.id, p.date, p.branch_id, p.product_name, p.unit, p.quantity,
               p.total_amount, p.credit_paid, p.memo, d.name AS distributor,
               b.name AS branch,
               COALESCE(SUM(cp.amount), 0) AS payments
        FROM purchases p
        LEFT JOIN distributors d ON d.id = p.distributor_id
        JOIN branches b ON b.id = p.branch_id
        LEFT JOIN credit_payments cp ON cp.purchase_id = p.id
        WHERE {" AND ".join(where)}
        GROUP BY p.id
        ORDER BY p.date DESC
        """,
        args,
    ).fetchall()
    out = []
    for r in rows:
        paid = float(r["credit_paid"] or 0) + float(r["payments"] or 0)
        total = float(r["total_amount"])
        balance = max(round(total - paid, 2), 0.0)
        percent = round(paid / total * 100, 1) if total else 0.0
        out.append({
            "id": r["id"], "date": r["date"], "branch_id": r["branch_id"],
            "branch": r["branch"], "product": r["product_name"], "unit": r["unit"],
            "quantity": r["quantity"], "distributor": r["distributor"] or "",
            "total": total, "paid": round(paid, 2), "balance": balance,
            "percent": percent, "remaining": round(100 - percent, 1),
            "memo": r["memo"], "payments": [
                {"date": x["date"], "amount": x["amount"], "memo": x["memo"]}
                for x in conn.execute(
                    "SELECT date, amount, memo FROM credit_payments WHERE purchase_id = ? ORDER BY date",
                    (r["id"],),
                ).fetchall()
            ],
        })
    return out


def purchases_query(conn, params):
    where, args = ["1=1"], []
    if params.get("branch_id"):
        where.append("p.branch_id = ?")
        args.append(_to_int(params["branch_id"]))
    if params.get("month"):
        where.append("p.date LIKE ?")
        args.append(params["month"] + "-%")
    if params.get("frm"):
        where.append("p.date >= ?")
        args.append(params["frm"])
    if params.get("to"):
        where.append("p.date <= ?")
        args.append(params["to"])
    if params.get("distributor"):
        where.append("p.distributor_id = ?")
        args.append(_to_int(params["distributor"]))
    if params.get("product"):
        where.append("p.product_id = ?")
        args.append(_to_int(params["product"]))
    if params.get("payment"):
        where.append("p.payment_method = ?")
        args.append(params["payment"])
    if params.get("owed") == "1":
        where.append("p.payment_method = 'Credit'")
        where.append("p.credit_total > COALESCE(p.credit_paid,0) + "
                     "COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.purchase_id = p.id),0)")
    if params.get("q"):
        like = f"%{params['q']}%"
        where.append("(p.product_name LIKE ? OR p.memo LIKE ? OR p.unit LIKE ? OR d.name LIKE ?)")
        args.extend([like] * 4)

    base = f"""
        FROM purchases p
        LEFT JOIN distributors d ON d.id = p.distributor_id
        LEFT JOIN products pr  ON pr.id = p.product_id
        JOIN branches b ON b.id = p.branch_id
        WHERE {" AND ".join(where)}
    """
    total = conn.execute("SELECT COUNT(*) c " + base, args).fetchone()["c"]
    page = max(1, _to_int(params.get("page"), 1))
    page_size = min(200, max(1, _to_int(params.get("page_size"), 25)))
    pages = max(1, (total + page_size - 1) // page_size)

    rows = conn.execute(
        "SELECT p.*, d.name AS distributor, b.name AS branch " + base +
        " ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?",
        args + [page_size, (page - 1) * page_size],
    ).fetchall()

    out = []
    credit = {c["id"]: c for c in credit_stats(conn)} if total else {}
    for r in rows:
        cs = credit.get(r["id"])
        out.append({
            "id": r["id"], "date": r["date"], "branch_id": r["branch_id"],
            "branch": r["branch"], "distributor_id": r["distributor_id"],
            "distributor": r["distributor"] or "", "product_id": r["product_id"],
            "product": r["product_name"], "unit": r["unit"], "quantity": r["quantity"],
            "total": r["total_amount"], "unit_price": r["unit_price"],
            "payment_method": r["payment_method"], "memo": r["memo"],
            "credit": cs or None,
        })
    return {"rows": out, "total": total, "page": page, "pages": pages, "page_size": page_size}


def income_query(conn, params):
    """Money-in rows. Same envelope as purchases_query — {rows,total,page,
    pages,page_size} — so every pager and every parity step can treat them
    alike. `amount` is the money in; unlike purchases there is no quantity or
    unit price to derive."""
    where, args = ["1=1"], []
    if params.get("branch_id"):
        where.append("i.branch_id = ?")
        args.append(_to_int(params["branch_id"]))
    if params.get("month"):
        where.append("i.date LIKE ?")
        args.append(params["month"] + "-%")
    if params.get("frm"):
        where.append("i.date >= ?")
        args.append(params["frm"])
    if params.get("to"):
        where.append("i.date <= ?")
        args.append(params["to"])
    if params.get("q"):
        like = f"%{params['q']}%"
        where.append("(i.source LIKE ? OR i.reference LIKE ? OR i.memo LIKE ?)")
        args.extend([like] * 3)

    base = f"""
        FROM income i
        JOIN branches b ON b.id = i.branch_id
        WHERE {" AND ".join(where)}
    """
    total = conn.execute("SELECT COUNT(*) c " + base, args).fetchone()["c"]
    page = max(1, _to_int(params.get("page"), 1))
    page_size = min(200, max(1, _to_int(params.get("page_size"), 25)))
    pages = max(1, (total + page_size - 1) // page_size)

    rows = conn.execute(
        "SELECT i.*, b.name AS branch " + base +
        " ORDER BY i.date DESC, i.id DESC LIMIT ? OFFSET ?",
        args + [page_size, (page - 1) * page_size],
    ).fetchall()

    out = [{
        "id": r["id"], "date": r["date"], "branch_id": r["branch_id"],
        "branch": r["branch"], "source": r["source"], "reference": r["reference"],
        "amount": r["amount"], "memo": r["memo"],
    } for r in rows]
    return {"rows": out, "total": total, "page": page, "pages": pages, "page_size": page_size}


def analytics(conn, branch_id=None, months=6):
    today = dt.date.today()
    ml = _month_list(today, months)
    first = dt.date(*ml[0], 1)
    scope = ""
    args = [first.isoformat()]
    if branch_id is not None:
        scope = "AND p.branch_id = ?"
        args.append(branch_id)

    by_item = conn.execute(
        f"""
        SELECT p.product_name, p.unit, COUNT(*) AS buys,
               SUM(p.quantity) AS qty, SUM(p.total_amount) AS spend,
               SUM(p.total_amount) / SUM(p.quantity) AS avg_unit
        FROM purchases p
        WHERE p.date >= ? {scope}
        GROUP BY p.product_id, p.product_name, p.unit
        ORDER BY spend DESC
        """,
        args,
    ).fetchall()

    by_dist = conn.execute(
        f"""
        SELECT COALESCE(d.name, '—') AS name, COUNT(*) AS buys,
               SUM(p.total_amount) AS spend, SUM(p.quantity) AS qty
        FROM purchases p LEFT JOIN distributors d ON d.id = p.distributor_id
        WHERE p.date >= ? {scope}
        GROUP BY d.id ORDER BY spend DESC
        """,
        args,
    ).fetchall()

    monthly = conn.execute(
        f"""
        SELECT substr(p.date,1,7) AS ym, COUNT(*) AS buys,
               SUM(p.total_amount) AS spend,
               SUM(CASE WHEN p.payment_method='Credit' THEN p.total_amount ELSE 0 END) AS credit_new
        FROM purchases p WHERE p.date >= ? {scope}
        GROUP BY ym ORDER BY ym
        """,
        args,
    ).fetchall()

    # money in over the same window, so spend and takings sit side by side
    inc_scope = "AND i.branch_id = ?" if branch_id is not None else ""
    inc_args = [first.isoformat()] + ([branch_id] if branch_id is not None else [])
    income_map = {r["ym"]: (r["income"] or 0) for r in conn.execute(
        f"""
        SELECT substr(i.date,1,7) AS ym, SUM(i.amount) AS income
        FROM income i WHERE i.date >= ? {inc_scope}
        GROUP BY ym
        """,
        inc_args,
    ).fetchall()}

    pay_split = conn.execute(
        f"""
        SELECT p.payment_method AS pm, COUNT(*) AS buys, SUM(p.total_amount) AS spend
        FROM purchases p WHERE p.date >= ? {scope}
        GROUP BY p.payment_method ORDER BY spend DESC
        """,
        args,
    ).fetchall()

    monthly_map = {r["ym"]: {"spend": r["spend"], "buys": r["buys"],
                             "credit_new": r["credit_new"]} for r in monthly}
    series = [{
        "month": f"{y:04d}-{m:02d}",
        "spend": round(monthly_map.get(f"{y:04d}-{m:02d}", {}).get("spend") or 0, 2),
        "income": round(income_map.get(f"{y:04d}-{m:02d}") or 0, 2),
        "buys": monthly_map.get(f"{y:04d}-{m:02d}", {}).get("buys") or 0,
        "credit_new": round(monthly_map.get(f"{y:04d}-{m:02d}", {}).get("credit_new") or 0, 2),
    } for y, m in ml]

    total_spend = sum(r["spend"] for r in by_item)
    total_income = sum(income_map.values())
    top_items = [{
        "product": r["product_name"], "unit": r["unit"], "buys": r["buys"],
        "qty": r["qty"], "spend": round(r["spend"], 2),
        "avg_unit": round(r["avg_unit"], 2) if r["avg_unit"] else 0,
        "share": round(r["spend"] / total_spend * 100, 1) if total_spend else 0,
    } for r in by_item]

    # unit price trend for top 5 items
    unit_trend = []
    for item in top_items[:5]:
        pts = conn.execute(
            f"""
            SELECT substr(p.date,1,7) AS ym,
                   SUM(p.total_amount)/SUM(p.quantity) AS avg_unit, COUNT(*) AS n
            FROM purchases p
            WHERE p.product_name = ? AND p.date >= ? {scope}
            GROUP BY ym ORDER BY ym
            """,
            [item["product"], first.isoformat()] + ([branch_id] if branch_id is not None else []),
        ).fetchall()
        unit_trend.append({
            "product": item["product"],
            "points": [{"month": r["ym"], "avg": round(r["avg_unit"], 2)} for r in pts],
        })

    credits = credit_stats(conn, branch_id=branch_id)
    outstanding = sum(c["balance"] for c in credits)
    total_credit = sum(c["total"] for c in credits)

    return {
        "months": series,
        "top_items": top_items,
        "top_by_qty": sorted(top_items, key=lambda x: -x["qty"])[:8],
        "by_distributor": [{
            "name": r["name"], "buys": r["buys"], "spend": round(r["spend"], 2),
            "share": round(r["spend"] / total_spend * 100, 1) if total_spend else 0,
        } for r in by_dist],
        "payment_split": [{
            "method": r["pm"], "buys": r["buys"], "spend": round(r["spend"], 2),
        } for r in pay_split],
        "unit_trend": unit_trend,
        "totals": {
            "spend": round(total_spend, 2),
            "income": round(total_income, 2),
            "net": round(total_income - total_spend, 2),
            "buys": sum(r["buys"] for r in by_item),
            "items": len(by_item),
            "distributors": len(by_dist),
            "credit_outstanding": round(outstanding, 2),
            "total_credit": round(total_credit, 2),
            "credit_cleared": round(total_credit - outstanding, 2),
            "open_credit_count": len([c for c in credits if c["balance"] > 0.005]),
        },
    }


def recommend_budget(conn, branch_id, year, month):
    """Historical spend weights (6 months before the target month) -> item %"""
    first, _ = _month_bounds(year, month)
    months_before = _month_list((first - dt.timedelta(days=1)).replace(day=1), 6)
    hist_start = dt.date(*months_before[0], 1)
    scope = ""
    args = [hist_start.isoformat(), first.isoformat()]
    if branch_id is not None:
        scope = "AND p.branch_id = ?"
        args.insert(1, branch_id)

    rows = conn.execute(
        f"""
        SELECT p.product_name, SUM(p.total_amount) AS spend
        FROM purchases p
        WHERE p.date >= ? {scope} AND p.date < ?
        GROUP BY p.product_id, p.product_name
        ORDER BY spend DESC
        """,
        args,
    ).fetchall()
    total = sum(r["spend"] for r in rows) or 0
    if total <= 0:
        return []
    weights = [(r["product_name"], r["spend"] / total * 100) for r in rows[:6]]
    other = sum(r["spend"] for r in rows[6:])
    if other > total * 0.02:
        weights.append(("Other items", other / total * 100))
    # round to whole percent, fix drift on the biggest
    rounded = [(n, round(w, 1)) for n, w in weights]
    drift = 100 - sum(w for _, w in rounded)
    if rounded:
        rounded[0] = (rounded[0][0], round(rounded[0][1] + drift, 1))
    return [{"name": n, "percent": w} for n, w in rounded]


def budget_view(conn, branch_id, year, month):
    row = conn.execute(
        "SELECT * FROM budgets WHERE branch_id IS ? AND year = ? AND month = ?",
        (branch_id, year, month),
    ).fetchone()
    rec = recommend_budget(conn, branch_id, year, month)
    if row:
        alloc = json.loads(row["allocations_json"] or "[]")
        total, save = row["total_amount"], row["save_amount"]
        saved = True
    else:
        alloc = rec
        # default: last real month's spend as a starting budget + 10% suggested savings
        hist_spend = 0.0
        month_map = {s["month"]: s["spend"] for s in analytics(conn, branch_id, 12)["months"]}
        for hy, hm in _month_list(dt.date.today(), 4):
            val = month_map.get(f"{hy:04d}-{hm:02d}")
            if val:
                hist_spend = val
        total = round(hist_spend, -2) if hist_spend else 0
        save = round(total * 0.10, 2) if total else 0
        saved = False

    spendable = max(total - save, 0)
    scope = ""
    args = []
    if branch_id is not None:
        scope = "AND p.branch_id = ?"
        args.append(branch_id)
    spend_rows = conn.execute(
        f"SELECT p.product_name, SUM(p.total_amount) AS sp FROM purchases p WHERE 1=1 {scope}"
        " AND p.date LIKE ? GROUP BY p.product_name ORDER BY sp DESC",
        args + [f"{year:04d}-{month:02d}-%"],
    ).fetchall()
    actual = {r["product_name"]: round(float(r["sp"]), 2) for r in spend_rows}

    return {
        "saved": saved, "branch_id": branch_id, "year": year, "month": month,
        "total_amount": total, "save_amount": save, "spendable": round(spendable, 2),
        "allocations": [{
            "name": a["name"], "percent": a["percent"],
            "amount": round(spendable * a["percent"] / 100, 2),
            "actual": round(actual.get(a["name"]) or 0, 2),
        } for a in alloc],
        "recommended": rec,
        "actual_spend": round(sum(actual.values()), 2),
    }


def meta(conn):
    branches = [{"id": r["id"], "name": r["name"]} for r in conn.execute(
        "SELECT id, name FROM branches ORDER BY id").fetchall()]
    distributors = [r["name"] for r in conn.execute("SELECT name FROM distributors ORDER BY name").fetchall()]
    distributor_options = [{"id": r["id"], "name": r["name"]} for r in conn.execute(
        "SELECT id, name FROM distributors ORDER BY name").fetchall()]
    products = [{"name": r["name"], "unit": r["unit_default"]} for r in conn.execute(
        "SELECT name, unit_default FROM products ORDER BY name").fetchall()]
    product_options = [{"id": r["id"], "name": r["name"]} for r in conn.execute(
        "SELECT id, name FROM products ORDER BY name").fetchall()]
    # months with money in count too — an income-only month must be selectable
    months = sorted(
        {r["m"] for r in conn.execute(
            "SELECT DISTINCT substr(date,1,7) m FROM purchases UNION "
            "SELECT DISTINCT substr(date,1,7) m FROM income").fetchall()},
        reverse=True)
    return {
        "currency": CURRENCY,
        "branches": branches,
        "distributors": distributors,
        "distributor_options": distributor_options,
        "products": products,
        "product_options": product_options,
        "payment_methods": PAYMENT_METHODS,
        "units": UNIT_SUGGESTIONS,
        "months": months,
    }


# ---------------------------------------------------------------------------
# Export (CSV / JSON) - all readable business records for research / legal
# ---------------------------------------------------------------------------
EXPORT_KINDS = ("purchases", "income", "credits", "budgets", "audit", "analytics")


def _records_from(rows):
    out = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if isinstance(v, (list, dict)):
                d[k] = json.dumps(v, ensure_ascii=False)
        out.append(d)
    return out


def export_records(conn, kind, branch_id=None):
    """Return an ordered list of flat dict records for the given export kind."""
    if kind == "purchases":
        rows = conn.execute(
            """SELECT p.id, p.date, b.name AS branch, d.name AS distributor,
                      p.product_name AS product, p.unit, p.quantity, p.unit_price,
                      p.total_amount, p.payment_method, p.credit_total, p.credit_paid,
                      p.memo, p.created_at
               FROM purchases p
               LEFT JOIN branches b ON b.id = p.branch_id
               LEFT JOIN distributors d ON d.id = p.distributor_id
               ORDER BY p.date DESC, p.id DESC"""
        ).fetchall()
        return _records_from(rows)
    if kind == "credits":
        recs = []
        for c in credit_stats(conn, branch_id=branch_id):
            d = dict(c)
            d["payments"] = json.dumps(d.get("payments", []), ensure_ascii=False)
            recs.append(d)
        return recs
    if kind == "budgets":
        rows = conn.execute(
            """SELECT bu.id, bu.year, bu.month, b.name AS branch, bu.total_amount,
                      bu.save_amount, bu.allocations_json AS allocations, bu.updated_at
               FROM budgets bu LEFT JOIN branches b ON b.id = bu.branch_id
               ORDER BY bu.year DESC, bu.month DESC"""
        ).fetchall()
        return _records_from(rows)
    if kind == "audit":
        rows = conn.execute(
            "SELECT id, ts, actor, action, detail, ip, prev_hash, row_hash"
            " FROM audit_log ORDER BY id DESC"
        ).fetchall()
        return _records_from(rows)
    if kind == "analytics":
        return [analytics(conn, branch_id=branch_id, months=12)]
    return None


def to_csv(records):
    if not records:
        return ""
    cols = []
    for rec in records:
        for k in rec.keys():
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for rec in records:
        w.writerow(rec)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# AI extraction layer — phase 1 plumbing (docs/AI_AUTOMATION_PLAN.md)
# ---------------------------------------------------------------------------
# The governing rule: the model *proposes*, the human *confirms*, and the
# existing write path records. Nothing here writes to the database.
#
# Every route has a deterministic heuristic implementation that mirrors
# public/app/db.js exactly. A model is only consulted when AI_API_KEY is set
# (or a recorded fixture matches), so a keyless server and the offline engine
# answer identically — audit_calculations.js depends on that.

AI_IMAGE_ERROR = "image extraction needs an AI provider \u2014 paste the text instead"
AI_NOTHING_ERROR = "nothing to read \u2014 provide text or an image"
AI_READ_ERROR = "could not read that image \u2014 paste the text instead"

# Checked in order: the first keyword hit wins, so "Mobile Money" beats
# "money" and both beat "Cash". Mirrored as PAYMENT_HINTS in db.js.
PAYMENT_HINTS = [
    ("Mobile Money", ("mobile money", "momo", "telecel", "airteltigo", "mtn momo")),
    ("Bank Transfer", ("bank transfer", "bank", "transfer", "ghipss", "cheque", "check")),
    ("Credit", ("credit", "on credit", "owed")),
    ("Cash", ("cash",)),
]

ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")
SLASH_DATE_RE = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b")
WHOLE_DATE_RE = re.compile(r"^\s*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*$")
_NUM = r"\d+(?:\.\d+)?"
ITEM_4 = re.compile(rf"^(.+?)\s+({_NUM})\s+([A-Za-z]+)\s+({_NUM})$")
ITEM_3 = re.compile(rf"^(.+?)\s+({_NUM})\s+({_NUM})$")
TOTAL_RE = re.compile(rf"^(?:total|grand total|subtotal|amount paid|paid)\D*?({_NUM})\s*$", re.I)
_STRICT_NUM_RE = re.compile(rf"^-?{_NUM}$")

INSTR_FIELDS = (
    r"distributor|supplier|vendor|date|payment(?:\s+method)?|method|memo|note|"
    r"product|item|unit|quantity|qty|amount|total"
)
INSTR_SET_RE = re.compile(
    rf"^\s*(?:set|change|make|update|put|switch)\s+(?:the\s+)?({INSTR_FIELDS})\s*(?:to|=|:|as)\s*(.+)$",
    re.I)
INSTR_BARE_RE = re.compile(
    rf"^\s*({INSTR_FIELDS})\s*(?:is|=|:)\s*(.+)$", re.I)

FIELD_ALIASES = {
    "distributor": "distributor", "supplier": "distributor", "vendor": "distributor",
    "date": "date",
    "payment": "payment_method", "payment method": "payment_method", "method": "payment_method",
    "payment_method": "payment_method",
    "memo": "memo", "note": "memo",
    "product": "product", "item": "product",
    "unit": "unit",
    "quantity": "quantity", "qty": "quantity",
    "amount": "total_amount", "total": "total_amount",
    "total_amount": "total_amount",
}
NUMERIC_FIELDS = {"quantity", "total_amount"}
TEXT_LIMITS = {"distributor": 80, "product": 80, "unit": 20, "memo": 140}

# Statement headers we understand, lowercased -> canonical column name.
HEADER_MAP = {
    "date": "date", "transaction date": "date", "value date": "date", "posting date": "date",
    "description": "description", "details": "description", "narration": "description",
    "particulars": "description", "name": "description",
    "amount": "amount", "debit": "debit", "withdrawal": "debit", "dr": "debit",
    "credit": "credit", "deposit": "credit", "cr": "credit",
    "balance": "balance",
    "reference": "reference", "ref": "reference", "reference no": "reference",
    "transaction id": "reference", "transaction id": "reference",
    "transaction reference": "reference",
}

# The model contract — asked in exactly these words by both engines.
# audit_calculations.js compares these source literals against db.js's copies,
# because the server path (env key) and the device path (db.js, key from
# Settings) must ask the model for the same thing or the two engines drift.
AI_SYSTEM = "You extract bookkeeping records from receipts, ledger pages and bank statements. Answer with one JSON object only \u2014 no prose, no markdown. Never invent a figure you cannot read: leave it empty and list it under \"uncertain\" as {field, why, options[]}."
AI_PROMPT_IMAGE = "Read this bookkeeping image and return the purchase draft as JSON: {\"date\":\"YYYY-MM-DD\",\"distributor\":\"\",\"items\":[{\"product\":\"\",\"unit\":\"\",\"quantity\":0,\"total_amount\":0}],\"payment_method\":\"\",\"memo\":\"\"} plus \"uncertain\":[{field,why,options[]}]."
AI_PROMPT_TEXT_PREFIX = "Turn this note into a purchase draft JSON: {\"date\":\"\",\"distributor\":\"\",\"items\":[{\"product\":\"\",\"unit\":\"\",\"quantity\":0,\"total_amount\":0}],\"payment_method\":\"\",\"memo\":\"\"} plus \"uncertain\":[{field,why,options[]}]. Note:\n"
AI_PROMPT_INSTRUCT = "Apply this edit to the bookkeeping draft and return only {\"op\":\"update\",\"changes\":{...}} with an empty changes object if the instruction does not name a field. Whitelisted fields: "
AI_PROMPT_STATEMENT_IMAGE = "Read this statement image and return JSON {\"candidates\":[{\"date\":\"YYYY-MM-DD\",\"direction\":\"out|in\",\"amount\":0,\"description\":\"\",\"reference\":\"\"}],\"uncertain\":[{field,why,options[]}]}."
AI_PROMPT_STATEMENT_TEXT_PREFIX = "Read this statement text and return JSON {\"candidates\":[{\"date\":\"YYYY-MM-DD\",\"direction\":\"out|in\",\"amount\":0,\"description\":\"\",\"reference\":\"\"}],\"uncertain\":[{field,why,options[]}]}.\n"
AI_PROMPT_AGENT = "You are the control centre of PW Budget, a bookkeeping app for a small shop. The owner types instructions here; the app is your body and the tools below are your hands. Answer with one JSON object only \u2014 no prose, no markdown: {\"reply\":\"what you say to the owner\",\"actions\":[{\"tool\":\"tool_id\",\"args\":{}}]}. Rules: use only the tools listed below and only the arguments they declare; propose at most what the instruction needs; never claim a change already happened, because every write is a proposal the owner approves by hand \u2014 write \"I will\", not \"I did\"; when you need data first, ask for the read tools and wait for the result; when the owner refuses, adjust instead of repeating yourself; when nothing fits, say so plainly and name the closest tool. Tools marked [locked] are held by a coverage switch the owner has left off: never claim you can run one, and offer propose_coverage only when widening access would actually help."
AI_AGENT_OFFLINE = "I can think, but there is no model attached to this device. Add a free key under Settings \u2192 AI connection and I will take over from there."
AI_AGENT_DOWN = "I could not reach the model just now \u2014 check the connection and try again."


def _r2(x):
    """Matches db.js's r2 = Math.round(n * 100) / 100 exactly.

    Python's round() is banker's rounding, so round(0.125, 2) is 0.12 where
    the JavaScript would say 0.13 — a silent parity break. floor(x + 0.5) is
    what Math.round does, and on the same float inputs it lands identically.
    """
    return (float(x or 0) * 100 + 0.5) // 1 / 100


def _has_letter(s):
    return any(("a" <= c <= "z") or ("A" <= c <= "Z") for c in s)


def _find_date(text):
    """Any date in the text as YYYY-MM-DD, or '' — dd/mm/yyyy is assumed
    (Ghana/UK order) unless the other component is impossible."""
    m = ISO_DATE_RE.search(text)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    m = SLASH_DATE_RE.search(text)
    if m:
        a, b, c = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y = c + 2000 if c < 100 else c
        if a > 12 and b <= 12:
            day, mon = a, b
        elif b > 12 and a <= 12:
            day, mon = b, a
        else:
            day, mon = a, b
        if 1 <= mon <= 12 and 1 <= day <= 31:
            return f"{y:04d}-{mon:02d}-{day:02d}"
    return ""


def _find_payment(text):
    low = text.lower()
    for name, keys in PAYMENT_HINTS:
        for k in keys:
            if k in low:
                return name
    return ""


def _draft_uncertain(draft, total_line=None):
    """What a human should double-check before this draft is recorded.
    Shared by the heuristic and the model path so the shape never drifts."""
    items = draft.get("items") or []
    out = []
    if total_line is not None and len(items) > 1:
        out.append({
            "field": "total_amount",
            "why": "the total does not match the line items",
            "options": [_r2(sum(float(i.get("total_amount") or 0) for i in items)),
                        _r2(total_line)],
        })
    if not draft.get("date"):
        out.append({"field": "date", "why": "no date found", "options": []})
    if not draft.get("distributor"):
        out.append({"field": "distributor", "why": "no supplier name found", "options": []})
    if not draft.get("payment_method"):
        out.append({"field": "payment_method", "why": "no payment method found",
                    "options": ["Cash", "Credit"]})
    if not items:
        out.append({"field": "items", "why": "no item lines matched", "options": []})
    for i, it in enumerate(items):
        if not it.get("unit"):
            out.append({"field": f"items[{i}].unit", "why": "unit not readable",
                        "options": UNIT_SUGGESTIONS[:6]})
        if not (float(it.get("quantity") or 0) > 0):
            out.append({"field": f"items[{i}].quantity", "why": "quantity not readable",
                        "options": []})
        if not (float(it.get("total_amount") or 0) > 0):
            out.append({"field": f"items[{i}].total_amount", "why": "amount not readable",
                        "options": []})
    return out


def _extract_draft(text):
    """Turn pasted/scribed text into a purchase draft. Deliberately simple —
    db.js runs this same sequence, so any cleverness here is drift risk."""
    draft = {"date": "", "distributor": "", "items": [],
             "payment_method": "", "memo": ""}
    total_line = None
    memos = []

    for raw in str(text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if WHOLE_DATE_RE.match(line):
            if not draft["date"]:
                draft["date"] = _find_date(line)
            continue
        m = ITEM_4.match(line)
        if m:
            draft["items"].append({
                "product": m.group(1).strip()[:80],
                "quantity": _to_float(m.group(2)),
                "unit": m.group(3)[:20],
                "total_amount": _to_float(m.group(4)),
            })
            continue
        m = ITEM_3.match(line)
        if m:
            draft["items"].append({
                "product": m.group(1).strip()[:80],
                "quantity": _to_float(m.group(2)),
                "unit": "",
                "total_amount": _to_float(m.group(3)),
            })
            continue
        m = TOTAL_RE.match(line)
        if m:
            total_line = _to_float(m.group(1))
            continue
        pm = _find_payment(line)
        # ASCII range, not str.isdigit(): Python counts superscripts like '²'
        # as digits and JavaScript's \d does not.
        if pm and not any("0" <= c <= "9" for c in line):
            draft["payment_method"] = pm
            continue
        d = _find_date(line)
        if d:
            if not draft["date"]:
                draft["date"] = d
            continue
        if not draft["distributor"] and _has_letter(line):
            draft["distributor"] = line[:80]
            continue
        if _has_letter(line):
            memos.append(line[:140])

    # A receipt's printed total is authoritative when there is a single line.
    items = draft["items"]
    if total_line is not None and len(items) == 1:
        items[0]["total_amount"] = total_line

    if memos:
        draft["memo"] = "; ".join(memos)[:140]
    return draft, _draft_uncertain(draft, total_line)


def _normalise_draft(obj):
    """Keep only the keys we know about, in the shape the UI expects. The
    model is never trusted to choose its own schema."""
    src = obj if isinstance(obj, dict) else {}
    items = src.get("items") if isinstance(src.get("items"), list) else []
    out_items = []
    for it in items[:50]:
        if not isinstance(it, dict):
            continue
        out_items.append({
            "product": str(it.get("product") or "").strip()[:80],
            "unit": str(it.get("unit") or "").strip()[:20],
            "quantity": _to_float(it.get("quantity")),
            "total_amount": _to_float(it.get("total_amount")),
        })
    pm = str(src.get("payment_method") or "").strip()
    return {
        "date": _find_date(str(src.get("date") or "")) or "",
        "distributor": str(src.get("distributor") or "").strip()[:80],
        "items": out_items,
        "payment_method": pm if pm in PAYMENT_METHODS else "",
        "memo": str(src.get("memo") or "").strip()[:140],
    }


# -- model / fixture plumbing -----------------------------------------------
def _ai_available():
    return bool(AI_API_KEY or AI_FIXTURES)


def _fixture_file(kind, payload):
    if not AI_FIXTURES:
        return None
    blob = json.dumps({"kind": kind, "payload": payload}, sort_keys=True,
                      ensure_ascii=False, default=str)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return Path(AI_FIXTURES) / f"{digest}.json"


def _fixture_read(kind, payload):
    fp = _fixture_file(kind, payload)
    if not fp or not fp.is_file():
        return None
    try:
        return json.loads(fp.read_text(encoding="utf-8")).get("response")
    except (OSError, ValueError):
        return None


def _fixture_write(kind, payload, response):
    fp = _fixture_file(kind, payload)
    if not fp:
        return
    try:
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(json.dumps(
            {"request": {"kind": kind, "payload": payload}, "response": response},
            ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def _ai_chat(prompt, image=None, system=None):
    """OpenAI-compatible chat completion. Returns the model's text, or None on
    any failure — an unreachable model must never break a core path.
    `system` overrides the extraction contract for routes that are not about
    receipts (the agent chat); callers passing nothing keep AI_SYSTEM."""
    content = [{"type": "text", "text": prompt}]
    if image:
        url = image if str(image).startswith("data:") else f"data:image/jpeg;base64,{image}"
        content.append({"type": "image_url", "image_url": {"url": url}})
    body = json.dumps({
        "model": AI_MODEL, "temperature": 0,
        "messages": [{"role": "system", "content": system or AI_SYSTEM},
                     {"role": "user", "content": content}],
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{AI_BASE_URL.rstrip('/')}/chat/completions", data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {AI_API_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=AI_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["choices"][0]["message"]["content"].strip()
    except Exception:  # noqa: BLE001 — network, timeout, bad payload, bad JSON
        return None
    if text.startswith("```"):
        text = re.sub(r"^```[A-Za-z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def ai_call(kind, payload, prompt):
    """fixture -> model -> None (caller falls back to the heuristic).
    Returns (parsed_json, source) where source is 'fixture' or 'model'."""
    fx = _fixture_read(kind, payload)
    if fx is not None:
        return fx, "fixture"
    if not AI_API_KEY:
        return None, ""
    text = _ai_chat(prompt, payload.get("image"))
    if text is None:
        return None, ""
    try:
        parsed = json.loads(text)
    except ValueError:
        return None, ""
    if AI_FIXTURES:
        _fixture_write(kind, payload, parsed)
    return parsed, "model"


def _ai_input(payload):
    """(text, image, error) — a shared guard so all three routes refuse the
    same way. Images need a model; text never does."""
    text = str(payload.get("text") or "")
    image = str(payload.get("image") or "")
    if not text.strip() and not image:
        return "", "", {"error": AI_NOTHING_ERROR}
    if image and not text.strip() and not _ai_available():
        return "", "", {"error": AI_IMAGE_ERROR}
    return text, image, None


# -- route handlers ---------------------------------------------------------
def ai_extract(payload):
    text, image, err = _ai_input(payload)
    if err:
        return 400, err

    if image and not text.strip():
        # Only a model can read pixels; a heuristic on an empty string would
        # quietly hand back a blank draft.
        got, source = ai_call("extract", {"image": image}, AI_PROMPT_IMAGE)
        if got is None:
            return 400, {"error": AI_READ_ERROR}
        draft = _normalise_draft(got)
        return 200, {"ok": True, "draft": draft,
                     "uncertain": _draft_uncertain(draft), "source": source}

    # `context` is the user's scope at work: names/figures the owner has
    # allowed the model to see. Absent or empty it changes nothing, which is
    # how audit_calculations.js keeps replaying the recorded fixtures.
    ctx = str(payload.get("context") or "").strip()
    fixture = {"text": text}
    if ctx:
        fixture["context"] = ctx

    if _ai_available():
        got, source = ai_call(
            "extract", fixture,
            AI_PROMPT_TEXT_PREFIX + (ctx + "\n" if ctx else "") + text)
        if got is not None:
            draft = _normalise_draft(got)
            uncertain = got.get("uncertain") if isinstance(got.get("uncertain"), list) else []
            return 200, {"ok": True, "draft": draft,
                         "uncertain": uncertain, "source": source}

    draft, uncertain = _extract_draft(text)
    return 200, {"ok": True, "draft": draft, "uncertain": uncertain, "source": "heuristic"}


def _validate_change(field, value):
    """-> (True, normalised value) or (False, error message)."""
    raw = str(value or "").strip()
    if field == "date":
        d = _find_date(raw)
        return (True, d) if d else (False, "date must be YYYY-MM-DD")
    if field == "payment_method":
        for pm in PAYMENT_METHODS:
            if pm.lower() == raw.lower():
                return True, pm
        hit = _find_payment(raw)
        if hit:
            return True, hit
        return False, f"payment_method must be one of: {', '.join(PAYMENT_METHODS)}"
    if field in NUMERIC_FIELDS:
        num = raw.replace(",", "")
        if not _STRICT_NUM_RE.match(num) or not float(num) > 0:
            return False, f"{field} must be a positive number"
        return True, _r2(float(num))
    limit = TEXT_LIMITS.get(field, 80)
    if not raw:
        return False, f"{field} is required"
    return True, raw[:limit]


def _apply_patch(changes):
    """Model output passes through the same whitelist as user text. Anything
    that fails validation is dropped — never applied."""
    clean = {}
    for field, value in (changes or {}).items():
        name = FIELD_ALIASES.get(str(field).strip().lower())
        if not name:
            continue
        ok_flag, out = _validate_change(name, value)
        if ok_flag:
            clean[name] = out
    if not clean:
        return {"op": "none", "changes": {}}
    return {"op": "update", "target": "purchase_draft", "changes": clean}


def ai_instruct(payload):
    draft = payload.get("draft")
    if not isinstance(draft, dict):
        return 400, {"error": "draft is required"}
    instruction = str(payload.get("instruction") or "").strip()
    if not instruction:
        return 400, {"error": "instruction is required"}

    if _ai_available():
        got, source = ai_call(
            "instruct", {"draft": draft, "instruction": instruction},
            AI_PROMPT_INSTRUCT + ", ".join(sorted(set(FIELD_ALIASES.values())))
            + f".\nDraft: {json.dumps(draft, ensure_ascii=False)}\n"
            + f"Instruction: {instruction}")
        if got is not None:
            patch = _apply_patch(got.get("changes") if isinstance(got, dict) else {})
            return 200, {"ok": True, "patch": patch, "source": source}

    m = INSTR_SET_RE.match(instruction) or INSTR_BARE_RE.match(instruction)
    if not m:
        return 200, {"ok": True, "patch": {"op": "none", "changes": {}},
                     "source": "heuristic"}
    field = FIELD_ALIASES[m.group(1).strip().lower()]
    ok_flag, value = _validate_change(field, m.group(2))
    if not ok_flag:
        return 400, {"error": value}
    return 200, {"ok": True, "source": "heuristic",
                 "patch": {"op": "update", "target": "purchase_draft",
                           "changes": {field: value}}}


def _split_row(line, delim):
    cells, cur, quoted, i = [], "", False, 0
    while i < len(line):
        ch = line[i]
        if ch == '"':
            if quoted and i + 1 < len(line) and line[i + 1] == '"':
                cur += '"'
                i += 2
                continue
            quoted = not quoted
            i += 1
            continue
        if ch == delim and not quoted:
            cells.append(cur.strip())
            cur = ""
            i += 1
            continue
        cur += ch
        i += 1
    cells.append(cur.strip())
    return cells


def _cell(cells, idx):
    if idx is None or idx < 0 or idx >= len(cells):
        return ""
    return cells[idx]


def _row_numbers(text):
    src = ISO_DATE_RE.sub(" ", text)
    src = SLASH_DATE_RE.sub(" ", src)
    return [float(m.replace(",", "")) for m in re.findall(r"\d[\d,]*(?:\.\d+)?", src)]


def _parse_statement(text):
    """Statement/slip text -> candidate transactions.

    With a header row the columns drive everything (reliable). Without one we
    fall back to scanning each line, and *say so* through uncertain[] rather
    than guessing silently — a confident wrong figure is worse than a blank.
    """
    lines = [l for l in str(text or "").splitlines() if l.strip()]
    if not lines:
        return [], []
    delim = "\t" if "\t" in lines[0] else (";" if ";" in lines[0] else ",")
    rows = [_split_row(l, delim) for l in lines]

    cols = {}
    for i, cell in enumerate(rows[0]):
        key = HEADER_MAP.get(cell.strip().lower())
        if key and key not in cols:
            cols[key] = i
    data = rows[1:] if cols else rows

    candidates, uncertain = [], []
    for n, cells in enumerate(data):
        if not any(c for c in cells):
            continue
        row_text = " ".join(cells)
        date = _find_date(_cell(cells, cols.get("date"))) if "date" in cols \
            else _find_date(row_text)

        amount, direction = None, None
        if "debit" in cols or "credit" in cols:
            dv = _num_cell(cells, cols.get("debit"))
            cv = _num_cell(cells, cols.get("credit"))
            if dv is not None and dv > 0:
                amount, direction = dv, "out"
            elif cv is not None and cv > 0:
                amount, direction = cv, "in"
        if amount is None and "amount" in cols:
            av = _num_cell(cells, cols.get("amount"))
            if av is not None and av != 0:
                amount, direction = abs(av), ("out" if av < 0 else "in")

        if amount is None:
            found = _row_numbers(row_text)
            if found:
                amount = abs(found[0])
                if len(found) > 1:
                    uncertain.append({"field": f"rows[{n}].amount",
                                      "why": "more than one number in the row",
                                      "options": [_r2(abs(v)) for v in found[:4]]})
        if amount is None or amount <= 0:
            uncertain.append({"field": f"rows[{n}].amount",
                              "why": "amount not readable", "options": []})
            continue
        if not date:
            uncertain.append({"field": f"rows[{n}].date", "why": "no date found",
                              "options": []})

        if "description" in cols:
            desc = _cell(cells, cols.get("description"))
        else:
            # No description column: take the first readable cell and drop any
            # date from it, so "2026-09-22 Payment to Ceda" reads as a name.
            desc = next((c for c in cells if _has_letter(c)), "")
            if desc:
                desc = ISO_DATE_RE.sub("", desc)
                desc = SLASH_DATE_RE.sub("", desc).strip()
        if direction is None:
            direction = "out"
            uncertain.append({"field": f"rows[{n}].direction",
                              "why": "no debit/credit column \u2014 assumed money out",
                              "options": ["out", "in"]})

        candidates.append({
            "date": date,
            "direction": direction,
            "amount": _r2(amount),
            "description": desc[:60],
            "reference": _cell(cells, cols.get("reference"))[:40],
        })

    if not candidates:
        uncertain.append({"field": "candidates", "why": "no transactions found",
                          "options": []})
    return candidates, uncertain


def _num_cell(cells, idx):
    if idx is None:
        return None
    raw = _cell(cells, idx).replace(",", "")
    if not _STRICT_NUM_RE.match(raw):
        return None
    return float(raw)


def ai_statement(payload):
    text, image, err = _ai_input(payload)
    if err:
        return 400, err

    if image and not text.strip():
        got, source = ai_call(
            "statement", {"image": image}, AI_PROMPT_STATEMENT_IMAGE)
        if got is None:
            return 400, {"error": "could not read that image \u2014 paste the text instead"}
        cand = got.get("candidates") if isinstance(got.get("candidates"), list) else []
        unc = got.get("uncertain") if isinstance(got.get("uncertain"), list) else []
        return 200, {"ok": True, "candidates": cand[:200], "uncertain": unc,
                     "source": source}

    if _ai_available():
        got, source = ai_call(
            "statement", {"text": text},
            AI_PROMPT_STATEMENT_TEXT_PREFIX + text)
        if got is not None:
            cand = got.get("candidates") if isinstance(got.get("candidates"), list) else []
            unc = got.get("uncertain") if isinstance(got.get("uncertain"), list) else []
            return 200, {"ok": True, "candidates": cand[:200], "uncertain": unc,
                         "source": source}

    candidates, uncertain = _parse_statement(text)
    return 200, {"ok": True, "candidates": candidates, "uncertain": uncertain,
                 "source": "heuristic"}


def ai_agent(payload):
    """The agent's one call — mirror of db.js aiAgent().

    The model never touches a record here: it gets a description of the tools
    it may propose, whatever the owner's coverage lets it know, and the
    conversation so far, and it answers with what to say plus the actions it
    would like to run. Carrying those out — and asking permission first — is
    the app's job, not the model's."""
    msgs = payload.get("messages")
    if not isinstance(msgs, list):
        msgs = None
    text = str(payload.get("text") or "")
    if msgs is None and not text.strip():
        return 400, {"error": AI_NOTHING_ERROR}
    if not AI_API_KEY:
        return 200, {"text": AI_AGENT_OFFLINE, "source": "heuristic"}

    def _role(m):
        return str(m.get("role") or "user") if isinstance(m, dict) else "user"

    def _content(m):
        return str(m.get("content") or "") if isinstance(m, dict) else ""

    tools = [str(t) for t in (payload.get("tools") or [])
             if isinstance(t, (str, int, float)) and not isinstance(t, bool)]
    ctx = str(payload.get("context") or "")
    source = msgs if msgs is not None else [{"role": "user", "content": text}]
    lines = [f"{_role(m)}: {_content(m)[:2000]}" for m in source[-12:]]
    parts = ["Tools you may use:\n" + "\n".join(tools)]
    if ctx.strip():
        parts.append("What you already know:\n" + ctx[:4000])
    parts.append("Conversation:\n" + "\n".join(lines))
    parts.append("Reply with the JSON object now.")
    out = _ai_chat("\n\n".join(parts), None, AI_PROMPT_AGENT)
    if out is None:
        return 200, {"text": AI_AGENT_DOWN, "source": ""}
    return 200, {"text": out, "source": "model"}


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, body, status=200, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, obj, status=200, headers=None):
        self._send(json.dumps(obj, ensure_ascii=False), status, extra=headers)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    # -- cookies / identity ---------------------------------------------------
    def _cookie(self, name):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        for part in raw.split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v or None
        return None

    def _cookie_header(self, value, max_age=None):
        parts = [f"{COOKIE_NAME}={value}", "Path=/", "HttpOnly", "SameSite=Lax"]
        parts.append(f"Max-Age={SESSION_DAYS * 86400 if max_age is None else max_age}")
        if self.headers.get("X-Forwarded-Proto") == "https":
            parts.append("Secure")
        return "; ".join(parts)

    def _ip(self):
        fwd = self.headers.get("X-Forwarded-For")
        if fwd:
            return fwd.split(",")[0].strip()[:45]
        return self.address_string()

    def _actor(self, conn):
        return get_session(conn, self._cookie(COOKIE_NAME)) or "app"

    def _api(self, method, path, qs, payload):
        conn = get_db()
        actor = self._actor(conn)
        ip = self._ip()
        try:
            # ---- meta & misc ---------------------------------------------
            if path == "/api/health":
                return self.send_json({"ok": True})
            if path == "/api/meta":
                return self.send_json(meta(conn))

            # ---- branches ---------------------------------------------------
            if path == "/api/branches" and method == "GET":
                return self.send_json({"branches": meta(conn)["branches"]})
            if path == "/api/branches" and method == "POST":
                name = str(payload.get("name") or "").strip()[:60]
                if not name:
                    return self.send_json({"error": "branch name is required"}, 400)
                try:
                    cur = conn.execute("INSERT INTO branches(name) VALUES (?)", (name,))
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "branch already exists"}, 400)
                conn.commit()
                audit(conn, actor, "branch.create", f"id={cur.lastrowid} name={name}", ip)
                self.send_json({"ok": True, "id": cur.lastrowid, "name": name}, 201)
                return

            # ---- dropdown data ----------------------------------------------
            if path == "/api/distributors" and method == "GET":
                return self.send_json({"distributors": meta(conn)["distributors"]})
            if path == "/api/products" and method == "GET":
                return self.send_json({"products": meta(conn)["products"]})

            # ---- purchases ----------------------------------------------------
            if path == "/api/purchases" and method == "GET":
                p = {k: (v[0] if v else "") for k, v in qs.items()}
                return self.send_json(purchases_query(conn, p))
            if path == "/api/purchases" and method == "POST":
                return self._create_purchase(conn, payload)

            m = re.match(r"^/api/purchases/(\d+)/(pay|move)$", path)
            if m and method == "POST":
                pid = int(m.group(1))
                if conn.execute("SELECT id FROM purchases WHERE id = ?", (pid,)).fetchone() is None:
                    return self.send_json({"error": "purchase not found"}, 404)
                if m.group(2) == "move":
                    bid = _to_int(payload.get("branch_id"))
                    if not bid:
                        return self.send_json({"error": "branch_id required"}, 400)
                    conn.execute("UPDATE purchases SET branch_id = ? WHERE id = ?", (bid, pid))
                    conn.commit()
                    audit(conn, actor, "purchase.move", f"id={pid} -> branch {bid}", ip)
                    self.send_json({"ok": True, "id": pid})
                    return
                # pay toward credit
                date = self._valid_date(payload, conn)
                if isinstance(date, str):
                    return self.send_json({"error": date}, 400)
                amount = _to_float(payload.get("amount"))
                cs = credit_stats(conn, purchase_id=pid)
                if not cs:
                    return self.send_json({"error": "not a credit purchase"}, 400)
                balance = cs[0]["balance"]
                if amount <= 0:
                    return self.send_json({"error": "amount must be greater than zero"}, 400)
                if amount > balance + 0.005:
                    return self.send_json({"error": f"amount exceeds remaining balance ({CURRENCY}{balance:,.2f})"}, 400)
                conn.execute(
                    "INSERT INTO credit_payments(purchase_id, date, amount, memo) VALUES (?,?,?,?)",
                    (pid, date.isoformat(), amount, str(payload.get("memo") or "").strip()[:120]),
                )
                conn.commit()
                audit(conn, actor, "credit.payment", f"purchase {pid} +{amount}", ip)
                self.send_json({"ok": True, "id": pid, "credit": credit_stats(conn, purchase_id=pid)[0]}, 201)
                return

            m = re.match(r"^/api/purchases/(\d+)$", path)
            if m and method == "DELETE":
                pid = int(m.group(1))
                if conn.execute("SELECT id FROM purchases WHERE id = ?", (pid,)).fetchone() is None:
                    return self.send_json({"error": "purchase not found"}, 404)
                conn.execute("DELETE FROM purchases WHERE id = ?", (pid,))
                conn.commit()
                audit(conn, actor, "purchase.delete", f"id={pid}", ip)
                return self.send_json({"ok": True})

            # ---- income (money in) -----------------------------------------------
            if path == "/api/income" and method == "GET":
                p = {k: (v[0] if v else "") for k, v in qs.items()}
                return self.send_json(income_query(conn, p))
            if path == "/api/income" and method == "POST":
                return self._create_income(conn, payload)

            m = re.match(r"^/api/income/(\d+)$", path)
            if m and method == "DELETE":
                iid = int(m.group(1))
                if conn.execute("SELECT id FROM income WHERE id = ?", (iid,)).fetchone() is None:
                    return self.send_json({"error": "income not found"}, 404)
                conn.execute("DELETE FROM income WHERE id = ?", (iid,))
                conn.commit()
                audit(conn, actor, "income.delete", f"id={iid}", ip)
                return self.send_json({"ok": True})

            # ---- credits ----------------------------------------------------------
            if path == "/api/credits" and method == "GET":
                bid = _to_int((qs.get("branch_id") or [""])[0]) or None
                rows = credit_stats(conn, branch_id=bid)
                open_rows = [r for r in rows if r["balance"] > 0.005]
                closed = [r for r in rows if r["balance"] <= 0.005]
                return self.send_json({
                    "open": open_rows, "settled": closed,
                    "outstanding": round(sum(r["balance"] for r in rows), 2),
                    "open_count": len(open_rows),
                })

            # ---- analytics -----------------------------------------------------------
            if path == "/api/analytics" and method == "GET":
                bid = _to_int((qs.get("branch_id") or [""])[0]) or None
                n = min(24, max(3, _to_int(qs.get("n") and qs["n"][0], 6)))
                return self.send_json(analytics(conn, branch_id=bid, months=n))

            # ---- budget --------------------------------------------------------------
            if path == "/api/budget" and method == "GET":
                year = _to_int((qs.get("year") or [""])[0]) or dt.date.today().year
                month = _to_int((qs.get("month") or [""])[0]) or dt.date.today().month
                bid_raw = (qs.get("branch_id") or [""])[0]
                bid = _to_int(bid_raw) if bid_raw not in ("", "all") else None
                return self.send_json(budget_view(conn, bid, year, month))
            if path == "/api/budget" and method == "POST":
                year = _to_int(payload.get("year")) or dt.date.today().year
                month = _to_int(payload.get("month")) or dt.date.today().month
                bid_raw = payload.get("branch_id")
                bid = _to_int(bid_raw) if bid_raw not in (None, "", "all") else None
                total = _to_float(payload.get("total_amount"))
                save = _to_float(payload.get("save_amount"))
                alloc = payload.get("allocations")
                if alloc not in (None, []):
                    alloc = [{"name": str(a.get("name")), "percent": _to_float(a.get("percent"))} for a in alloc]
                else:
                    alloc = recommend_budget(conn, bid, year, month)
                if total <= 0:
                    self.send_json({"error": "total_amount must be greater than zero"}, 400)
                    return
                # explicit delete-then-insert: SQLite UNIQUE treats NULLs as distinct,
                # so "All branches" (branch_id IS NULL) needs manual dedupe.
                conn.execute(
                    "DELETE FROM budgets WHERE year = ? AND month = ? AND "
                    "(branch_id = ? OR (branch_id IS NULL AND ? IS NULL))",
                    (year, month, bid, bid),
                )
                conn.execute(
                    """INSERT INTO budgets(branch_id, year, month, total_amount, save_amount, allocations_json)
                       VALUES (?,?,?,?,?,?)""",
                    (bid, year, month, total, save, json.dumps(alloc, ensure_ascii=False)),
                )
                conn.commit()
                audit(conn, actor, "budget.save",
                      f"{year:04d}-{month:02d} branch={bid} total={total} save={save}", ip)
                return self.send_json({"ok": True, **budget_view(conn, bid, year, month)})

            # ---- AI extraction layer (proposal only — nothing is written) --
            # See docs/AI_AUTOMATION_PLAN.md. These never touch the database:
            # they return a draft/patch for a human to confirm, which is then
            # recorded through the ordinary /api/purchases path.
            if path == "/api/ai/extract" and method == "POST":
                status, body = ai_extract(payload or {})
                return self.send_json(body, status)
            if path == "/api/ai/instruct" and method == "POST":
                status, body = ai_instruct(payload or {})
                return self.send_json(body, status)
            if path == "/api/ai/statement" and method == "POST":
                status, body = ai_statement(payload or {})
                return self.send_json(body, status)
            if path == "/api/ai/chat" and method == "POST":
                status, body = ai_agent(payload or {})
                return self.send_json(body, status)

            return self.send_json({"error": "not found"}, 404)
        finally:
            conn.close()

    def _valid_date(self, payload, conn):
        raw = str(payload.get("date") or "").strip()
        try:
            return dt.date.fromisoformat(raw)
        except ValueError:
            return "date must be YYYY-MM-DD"

    def _create_income(self, conn, payload):
        """Money in. Validated in the same order as a purchase — date, branch,
        the number, then the name — so both engines reject in step."""
        date = self._valid_date(payload, conn)
        if isinstance(date, str):
            return self.send_json({"error": date}, 400)

        bid = _to_int(payload.get("branch_id"))
        branch = conn.execute("SELECT id FROM branches WHERE id = ?", (bid,)).fetchone() if bid else None
        if not branch:
            return self.send_json({"error": "a valid branch_id is required"}, 400)

        # parsed then rounded exactly as db.js's toFloat does (parseFloat -> r2):
        # round() alone is banker's rounding and would answer 0.12 where the
        # JavaScript says 0.13.
        try:
            amount = _r2(float(str(payload.get("amount"))))
        except (TypeError, ValueError):
            amount = 0.0
        if amount <= 0:
            return self.send_json({"error": "amount must be greater than zero"}, 400)

        source = str(payload.get("source") or "").strip()[:80]
        if not source:
            return self.send_json({"error": "source is required"}, 400)

        cur = conn.execute(
            "INSERT INTO income(date, branch_id, source, reference, amount, memo) "
            "VALUES (?,?,?,?,?,?)",
            (date.isoformat(), bid, source, str(payload.get("reference") or "").strip()[:40],
             amount, str(payload.get("memo") or "").strip()[:140]),
        )
        conn.commit()
        audit(conn, self._actor(conn), "income.create",
              f"id={cur.lastrowid} {source} amount={amount}", self._ip())
        return self.send_json({"ok": True, "id": cur.lastrowid}, 201)

    def _create_purchase(self, conn, payload):
        date = self._valid_date(payload, conn)
        if isinstance(date, str):
            return self.send_json({"error": date}, 400)

        bid = _to_int(payload.get("branch_id"))
        branch = conn.execute("SELECT id FROM branches WHERE id = ?", (bid,)).fetchone() if bid else None
        if not branch:
            return self.send_json({"error": "a valid branch_id is required"}, 400)

        qty = _to_float(payload.get("quantity"))
        if qty <= 0:
            return self.send_json({"error": "quantity must be greater than zero"}, 400)

        total = _to_float(payload.get("total_amount"))
        if total <= 0:
            return self.send_json({"error": "total amount must be greater than zero"}, 400)

        pm = str(payload.get("payment_method") or "").strip()
        if pm not in PAYMENT_METHODS:
            return self.send_json({"error": f"payment_method must be one of: {', '.join(PAYMENT_METHODS)}"}, 400)

        unit = str(payload.get("unit") or "").strip()[:20] or "bag"
        product_raw = str(payload.get("product") or "").strip()[:80]
        if not product_raw:
            return self.send_json({"error": "product name is required"}, 400)
        dist_raw = str(payload.get("distributor") or "").strip()[:80]
        if not dist_raw:
            return self.send_json({"error": "distributor name is required"}, 400)

        did = distributor_id(conn, dist_raw)
        p_id, unit = product_id(conn, product_raw, unit)
        unit_price = round(total / qty, 4)

        credit_total = credit_paid = None
        if pm == "Credit":
            credit_total = total
            credit_paid = _to_float(payload.get("credit_paid"))
            if credit_paid < 0:
                credit_paid = 0.0
            if credit_paid > total + 0.005:
                return self.send_json(
                    {"error": f"amount paid ({CURRENCY}{credit_paid:,.2f}) cannot exceed the original price ({CURRENCY}{total:,.2f})"},
                    400,
                )
            credit_paid = round(credit_paid, 2)

        memo = str(payload.get("memo") or "").strip()[:140]
        cur = conn.execute(
            """INSERT INTO purchases(date, branch_id, distributor_id, product_id,
               product_name, unit, quantity, total_amount, unit_price,
               payment_method, credit_total, credit_paid, memo)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (date.isoformat(), bid, did, p_id, product_raw, unit, qty, total,
             unit_price, pm, credit_total, credit_paid, memo),
        )
        conn.commit()
        audit(conn, self._actor(conn), "purchase.create",
              f"id={cur.lastrowid} {product_raw} qty={qty} total={total} method={pm}",
              self._ip())
        cs = None
        if pm == "Credit":
            cs = credit_stats(conn, purchase_id=cur.lastrowid)[0]
        return self.send_json({"ok": True, "id": cur.lastrowid, "credit": cs}, 201)

    # -- protected admin API (single user) ------------------------------------
    def _admin_api(self, method, path, qs, payload):
        conn = get_db()
        try:
            ip = self._ip()
            token = self._cookie(COOKIE_NAME)
            actor = get_session(conn, token)

            # public: session probe
            if path == "/admin/api/session" and method == "GET":
                return self.send_json({
                    "authed": bool(actor), "username": actor,
                    "signup_required": not admin_exists(conn),
                })

            # public: first-run signup (locks the single account)
            if path == "/admin/api/signup" and method == "POST":
                if admin_exists(conn):
                    return self.send_json({"error": "account already created"}, 403)
                username = str((payload or {}).get("username") or "").strip()[:40]
                password = str((payload or {}).get("password") or "")
                if len(username) < 3:
                    return self.send_json({"error": "username must be at least 3 characters"}, 400)
                if len(password) < 8:
                    return self.send_json({"error": "password must be at least 8 characters"}, 400)
                create_admin_user(conn, username, password)
                new_token = create_session(conn, username)
                audit(conn, username, "admin.signup", "account created", ip)
                return self.send_json(
                    {"ok": True, "username": username}, 200,
                    {"Set-Cookie": self._cookie_header(new_token)},
                )

            # public: login
            if path == "/admin/api/login" and method == "POST":
                wait = _throttle_check(ip)
                if wait > 0:
                    return self.send_json({"error": f"too many attempts, retry in {wait}s"}, 429)
                username = str((payload or {}).get("username") or "").strip()
                password = str((payload or {}).get("password") or "")
                user = verify_admin(conn, username, password)
                if not user:
                    _throttle_fail(ip)
                    audit(conn, username or "anonymous", "admin.login_failed", "bad credentials", ip)
                    return self.send_json({"error": "invalid username or password"}, 401)
                _throttle_clear(ip)
                new_token = create_session(conn, user)
                audit(conn, user, "admin.login", "session started", ip)
                return self.send_json(
                    {"ok": True, "username": user}, 200,
                    {"Set-Cookie": self._cookie_header(new_token)},
                )

            # public: logout
            if path == "/admin/api/logout" and method == "POST":
                if actor:
                    audit(conn, actor, "admin.logout", "session ended", ip)
                destroy_session(conn, token)
                return self.send_json(
                    {"ok": True}, 200, {"Set-Cookie": self._cookie_header("", max_age=0)}
                )

            # ---- everything below requires a valid session ----
            if not actor:
                return self.send_json({"error": "authentication required"}, 401)

            bid = _to_int((qs.get("branch_id") or [""])[0]) or None

            if path == "/admin/api/analytics" and method == "GET":
                n = min(24, max(3, _to_int((qs.get("n") or ["6"])[0], 6)))
                return self.send_json(analytics(conn, branch_id=bid, months=n))

            if path == "/admin/api/overview" and method == "GET":
                m = meta(conn)
                a = analytics(conn, branch_id=bid, months=12)
                counts = {
                    "purchases": conn.execute("SELECT COUNT(*) c FROM purchases").fetchone()["c"],
                    "branches": len(m["branches"]),
                    "distributors": len(m["distributor_options"]),
                    "products": len(m["product_options"]),
                    "audit_entries": conn.execute("SELECT COUNT(*) c FROM audit_log").fetchone()["c"],
                }
                return self.send_json({
                    "username": actor, "meta": m, "totals": a["totals"],
                    "months": a["months"], "counts": counts,
                    "top_items": a["top_items"][:8],
                    "by_distributor": a["by_distributor"],
                    "payment_split": a["payment_split"],
                    "audit": audit_verify(conn),
                })

            if path == "/admin/api/audit" and method == "GET":
                limit = min(1000, max(1, _to_int((qs.get("limit") or ["200"])[0], 200)))
                offset = max(0, _to_int((qs.get("offset") or ["0"])[0], 0))
                data = audit_list(conn, limit, offset)
                data["verify"] = audit_verify(conn)
                return self.send_json(data)

            if path == "/admin/api/export" and method == "GET":
                kind = (qs.get("type") or ["purchases"])[0]
                fmt = (qs.get("format") or ["csv"])[0].lower()
                if kind not in EXPORT_KINDS:
                    return self.send_json({"error": f"unknown export type '{kind}'"}, 400)
                if fmt not in ("csv", "json"):
                    return self.send_json({"error": "format must be csv or json"}, 400)
                records = export_records(conn, kind, branch_id=bid)
                audit(conn, actor, "data.export",
                      f"type={kind} format={fmt} rows={len(records)}", ip)
                stamp = _utcnow().strftime("%Y%m%d-%H%M%S")
                fname = f"pwbudget-{kind}-{stamp}.{fmt}"
                if fmt == "json":
                    body = json.dumps(records, ensure_ascii=False, indent=2)
                    ctype = "application/json; charset=utf-8"
                else:
                    body = to_csv(records)
                    ctype = "text/csv; charset=utf-8"
                return self._send(body, 200, ctype, {
                    "Content-Disposition": f'attachment; filename="{fname}"',
                })

            return self.send_json({"error": "not found"}, 404)
        finally:
            conn.close()

    # -- HTTP verbs -----------------------------------------------------------
    def _storage_error(self, exc):
        """sqlite3.OperationalError that means the disk would not take the
        write (full, read-only volume, unopenable file). db.js answers 507 for
        the same condition on a phone, so both engines say the same thing —
        loudly — instead of a generic 500 the UI reads as a mystery."""
        msg = str(exc).lower()
        if any(k in msg for k in ("disk", "readonly", "read-only", "unable to open")):
            self.send_json({"error": STORAGE_FULL_ERROR}, 507)
        else:
            self.send_json({"error": str(exc)}, 500)

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/admin/api/"):
                self._admin_api("GET", parsed.path, parse_qs(parsed.query), None)
            elif parsed.path.startswith("/api/"):
                self._api("GET", parsed.path, parse_qs(parsed.query), None)
            else:
                self._static(parsed.path)
        except sqlite3.OperationalError as exc:
            self._storage_error(exc)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, 500)

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            if not (parsed.path.startswith("/api/") or parsed.path.startswith("/admin/api/")):
                return self.send_json({"error": "not found"}, 404)
            payload = self._read_body()
            if payload is None:
                return self.send_json({"error": "invalid JSON body"}, 400)
            if parsed.path.startswith("/admin/api/"):
                self._admin_api("POST", parsed.path, parse_qs(parsed.query), payload)
            else:
                self._api("POST", parsed.path, parse_qs(parsed.query), payload)
        except sqlite3.OperationalError as exc:
            self._storage_error(exc)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, 500)

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/admin/api/"):
                return self._admin_api("DELETE", parsed.path, parse_qs(parsed.query), None)
            if not parsed.path.startswith("/api/"):
                return self.send_json({"error": "not found"}, 404)
            self._api("DELETE", parsed.path, parse_qs(parsed.query), None)
        except sqlite3.OperationalError as exc:
            self._storage_error(exc)
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, 500)

    # -- static ---------------------------------------------------------------
    def _static(self, path):
        if path == "/":
            path = "/index.html"
        elif path.endswith("/"):
            path += "index.html"
        fp = (PUBLIC_DIR / path.lstrip("/")).resolve()
        if not str(fp).startswith(str(PUBLIC_DIR.resolve())) or not fp.is_file():
            return self.send_json({"error": "not found"}, 404)
        ctype = MIME.get(fp.suffix.lower(), "application/octet-stream")
        self._send(fp.read_bytes(), 200, ctype)


def init_db():
    fresh = not DB_PATH.exists()
    conn = get_db()
    conn.executescript(SCHEMA)
    if fresh and conn.execute("SELECT COUNT(*) c FROM branches").fetchone()["c"] == 0:
        if "--demo" in sys.argv or "--seed" in sys.argv:
            seed_demo(conn)
        else:
            # clean start: one default branch, nothing else — no test data
            conn.execute("INSERT INTO branches(name) VALUES (?)", ("Main Shop",))
        conn.commit()
    # optionally pre-seed the single admin account from the environment
    env_user = os.environ.get("PWBUDGET_ADMIN_USER")
    env_pass = os.environ.get("PWBUDGET_ADMIN_PASS")
    if env_user and env_pass and not admin_exists(conn):
        create_admin_user(conn, env_user.strip()[:40], env_pass)
        audit(conn, env_user.strip()[:40], "admin.signup", "account seeded from environment", "")
    # drop expired sessions
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_utcnow().isoformat(),))
    conn.commit()
    conn.close()


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    shown = "127.0.0.1" if HOST in ("0.0.0.0", "::") else HOST
    print(f"\n  PW Budget - Stock, Distributor, Credit & Analytics")
    print(f"  http://{shown}:{PORT}")
    print(f"  Admin dashboard: http://{shown}:{PORT}/admin/")
    print(f"  Database: {DB_PATH}")
    print(f"  Press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()