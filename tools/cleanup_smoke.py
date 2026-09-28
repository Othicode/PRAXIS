"""Remove any smoke-test data left over from headless harness runs.
Keeps the DB clean for real use. Pure stdlib."""
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "ledger.db"
conn = sqlite3.connect(DB)
conn.execute("DELETE FROM purchases WHERE memo LIKE 'smoke-%'")
conn.execute("DELETE FROM branches WHERE name LIKE 'Smoke Branch %'")
conn.execute("DELETE FROM distributors WHERE name LIKE 'Smoke %'")
conn.execute("DELETE FROM products WHERE name LIKE 'Smoke %'")
conn.commit()
print("branches :", [r[1] for r in conn.execute("SELECT id, name FROM branches")])
print("distribs :", conn.execute("SELECT COUNT(*) FROM distributors").fetchone()[0])
print("products :", conn.execute("SELECT COUNT(*) FROM products").fetchone()[0])
print("purchases:", conn.execute("SELECT COUNT(*) FROM purchases").fetchone()[0], "| credits:",
      conn.execute("SELECT COUNT(*) FROM credit_payments").fetchone()[0])