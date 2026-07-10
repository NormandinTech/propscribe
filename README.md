# PropScribe AI — Complete Deployment Guide

> AI-powered real estate marketing with Fair Housing compliance built in.
> Write every listing. Shield every deal.

---

## Project Structure

```
propscribe/
├── landing/
│   └── index.html          ← Launch page (deploy to GitHub Pages / Vercel)
├── app/
│   ├── index.html          ← PWA application
│   └── offline.html        ← PWA offline fallback
├── pwa/
│   ├── manifest.json       ← PWA manifest (copy to web root)
│   └── sw.js               ← Service worker (copy to web root)
├── backend/
│   ├── server.js           ← Express API (deploy to Railway)
│   ├── package.json
│   └── railway.toml
└── README.md
```

---

## Step 1 — Deploy backend to Railway

1. Create a new GitHub repo: `propscribe-api`
2. Push the `backend/` folder contents to the repo root
3. Go to railway.app → New Project → Deploy from GitHub → select repo
4. In Railway dashboard → Variables → add:
   - `ANTHROPIC_API_KEY` = your Anthropic API key
   - `ADMIN_SECRET` = a random string (for key generation endpoint)
   - `NODE_ENV` = `production`
5. Railway auto-deploys. Copy your Railway URL.
   Example: `https://propscribe-api-production.up.railway.app`

---

## Step 2 — Update API URL in app

In `app/index.html`, find:
```js
const API = 'https://propscribe-api.up.railway.app';
```
Replace with your actual Railway URL.

---

## Step 3 — Deploy frontend + landing page

### Option A: GitHub Pages (free)

1. Create a new GitHub repo: `propscribe` (public)
2. Push all files with this structure:
   ```
   /index.html        ← landing/index.html
   /app/index.html    ← app/index.html
   /app/offline.html  ← app/offline.html
   /manifest.json     ← pwa/manifest.json
   /sw.js             ← pwa/sw.js
   /icons/            ← generate icons (see below)
   ```
3. Settings → Pages → Deploy from main branch → root `/`
4. Your site: `username.github.io/propscribe`

### Option B: Vercel (recommended for custom domain)

1. Import repo to Vercel
2. No build step needed — static files
3. Add custom domain: `propscribe.ai` or similar
4. Done

---

## Step 4 — Generate PWA icons

You need icon PNGs at these sizes: 72, 96, 128, 144, 152, 192, 384, 512

Quickest approach — use RealFaviconGenerator.net:
1. Go to https://realfavicongenerator.net
2. Upload a square logo (black background, "PS" monogram in gold works great)
3. Download the package, place icons in `/icons/` folder

Or generate programmatically:
```bash
npm install -g sharp-cli
for size in 72 96 128 144 152 192 384 512; do
  sharp -i logo.png -o icons/icon-${size}x${size}.png resize $size $size
done
```

---

## Step 5 — Set up Gumroad products

### Product 1: PropScribe Starter
- Name: PropScribe AI — Starter Plan
- Price: $29/month (recurring)
- Description: 100 generations/month, full Fair Housing compliance score, all 6 content types
- Delivery: License key (manual for Phase 1, automated via webhook in Phase 2)
- Key format: `PS-STARTER-XXXXXXXX`

### Product 2: PropScribe Pro
- Name: PropScribe AI — Pro Plan
- Price: $49/month (recurring)
- Description: Unlimited generations, brand voice training, bulk mode (50 listings)
- Delivery: License key
- Key format: `PS-PRO-XXXXXXXX`

---

## Step 6 — Add license keys to backend

In `backend/server.js`, add purchased keys to the `KEY_DATABASE` map:
```js
const KEY_DATABASE = new Map([
  ['PS-DEMO-00000000', { tier: 'starter', limit: 100, org: 'Demo', active: true }],
  ['PS-STARTER-A3F7D2B9', { tier: 'starter', limit: 100, org: 'Jane Smith', active: true }],
  ['PS-PRO-X9K2M7P4',    { tier: 'pro', limit: Infinity, org: 'Bob Jones', active: true }],
]);
```
Then redeploy (Railway auto-redeploys on git push).

### Generate a key via API:
```bash
curl -X POST https://your-railway-url.com/api/admin/generate-key \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -d '{"tier": "starter", "org": "New Customer"}'
```

---

## Step 7 — Test everything

1. Visit your landing page — confirm design loads correctly
2. Navigate to `/app/` — enter demo key `PS-DEMO-00000000`
3. Fill in a property and generate — confirm both API calls complete
4. Check compliance score appears with green/amber/red ring
5. Test "Add to Home Screen" on Android Chrome
6. Go offline (airplane mode) — confirm offline banner appears
7. Come back online — confirm sync banner works

---

## Pricing tiers reference

| Tier      | Price    | Monthly limit | Key prefix    |
|-----------|----------|---------------|---------------|
| Free      | $0       | 5 gens        | (no key)      |
| Starter   | $29/mo   | 100 gens      | PS-STARTER-   |
| Pro       | $49/mo   | Unlimited     | PS-PRO-       |
| Team      | $149/mo  | Unlimited     | PS-TEAM-      |
| Brokerage | $299/mo  | Unlimited     | PS-BROK-      |

---

## API cost estimate at scale

| Volume | API calls/mo | Est. cost |
|--------|-------------|-----------|
| 50 Starter users × 60 avg gens | 6,000 pairs | ~$24 |
| 20 Pro users × 150 avg gens | 6,000 pairs | ~$24 |
| 5 Brokerage × 300 gens | 3,000 pairs | ~$12 |
| **Total at $2K MRR target** | **15,000 pairs** | **~$60/mo** |

Net margin: ~97% at target MRR

---

## Launch checklist

- [ ] Backend deployed to Railway with API key set
- [ ] Frontend deployed (GitHub Pages or Vercel)
- [ ] API URL updated in app/index.html
- [ ] PWA icons generated and placed in /icons/
- [ ] manifest.json and sw.js in web root
- [ ] Gumroad Starter product created at $29/mo
- [ ] Gumroad Pro product created at $49/mo
- [ ] Demo key PS-DEMO-00000000 tested end-to-end
- [ ] Compliance audit confirmed working (check JSON parse)
- [ ] Mobile PWA install tested on Android Chrome
- [ ] Offline mode tested
- [ ] Brokerage contact form tested (email delivery)
- [ ] Launch posts written for r/realtors + Facebook groups
- [ ] 10 direct DMs to active real estate agents
