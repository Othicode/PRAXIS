# Host PRAXIS as Android-installable flagship

`/` is the PRAXIS company site (flagship). `/pw-budget/` is the PW Budget
download page. `/app/` is the installable PWA.
Android installs directly from Chrome — no APK download needed.
Play Store listing is optional via a TWA wrapper.

## 1. Host (HTTPS required for install)

Any static host works for the PWA shell. If you need the Python API
(`ledger.db` server mode), host `server.py` on a VPS instead.

Option A — static only (offline PWA, recommended for flagship):
1. Upload `public/` contents to Cloudflare Pages / Netlify / Vercel.
   - Publish dir: `public`
   - `public/index.html` → `https://yourdomain.com/` (PRAXIS site)
   - `public/pw-budget/` → `https://yourdomain.com/pw-budget/` (PW Budget page)
   - `public/app/` → `https://yourdomain.com/app/`
2. Custom domain + enforce HTTPS.
3. Test: open `https://yourdomain.com/app/` in Chrome Android →
   menu ⋮ → `Install app`.

Option B — full server (`server.py` + `ledger.db`):
1. VPS with Python 3, open port 8000, reverse-proxy via Caddy/Nginx with TLS.
2. `python server.py 8000` behind `https://app.yourdomain.com/`.
3. Same install flow — service worker only works on HTTPS (or localhost).

## 2. Verify installability (Chrome)

- `GET /app/manifest.webmanifest` → `application/manifest+json`
- `GET /app/sw.js`, `/app/icons/icon-192.png`, `/app/icons/icon-512.png`,
  `/app/icons/icon-maskable-512.png` → 200
- Manifest: `name`, `short_name`, `start_url`, `scope`, `display: standalone`,
  `192` + `512` icons, `theme_color` — all present in `public/app/manifest.webmanifest`.
- In-app: `⤓ Install app` button appears via `beforeinstallprompt`
  (`public/app/app.js: initInstall`). `appinstalled` hides it.
- DevTools → Application → Manifest → `Installability: No errors`.

Local check:
```
python tools/check_static.py   # point BASE at your live domain for final check
```

## 3. Optional: Play Store (TWA, no code rewrite)

1. Go to PWABuilder.com → enter `https://yourdomain.com/app/` → `Package for Store`.
2. Download the Android App Bundle (`.aab`), create a Play Developer account,
   upload the `.aab` as a new app.
3. Play gives you: `package_name` + SHA-256 signing fingerprint.
4. Edit `public/.well-known/assetlinks.json`, replace the two `REPLACE_*`
   placeholders, redeploy. Required path:
   `https://yourdomain.com/.well-known/assetlinks.json`
5. Verify: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://yourdomain.com&relation=delegate_permission/common.handle_all_urls`

## 4. Share as flagship

Share only the root: `https://yourdomain.com/`
Never share `/app/` directly — the PRAXIS site links to the PW Budget page
(`/pw-budget/`), which handles iPhone vs Android install instructions,
SEO (`og:*`, JSON-LD), and the open-app CTA.

After each frontend ship: bump `CACHE` in `public/app/sw.js` so installed
devices pick up the update.
