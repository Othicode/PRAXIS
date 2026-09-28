"""Verify the new PWA/downlaod structure is served correctly (local check)."""
import sys
import urllib.request

# Windows consoles default to cp1252 and crash on UTF-8 content (→, ⬆ …)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = "http://127.0.0.1:8123"


def probe(path):
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read()
            ct = r.headers.get("Content-Type", "?")
            first = body[:80].decode("utf-8", "replace").replace("\n", " ")
            print(f"{path:34} -> {r.status}  {ct:38}  {len(body):>6}B  {first[:60]}")
    except urllib.error.HTTPError as e:
        print(f"{path:34} -> {e.code}  {e.headers.get('Content-Type','?')}")


for p in [
    "/",
    "/theme.css",
    "/logo.svg",
    "/favicon.svg",
    "/favicon.ico",
    "/pw-budget/",
    "/pw-budget/index.html",
    "/app/",
    "/app/index.html",
    "/app/app.js",
    "/app/db.js",
    "/app/styles.css",
    "/app/manifest.webmanifest",
    "/app/sw.js",
    "/app/icons/icon-192.png",
    "/app/icons/icon-512.png",
    "/app/icons/icon-maskable-512.png",
    "/app/icons/apple-touch-icon.png",
    "/api/meta",
]:
    probe(p)