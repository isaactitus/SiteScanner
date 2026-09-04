# SiteScanner

A free, passive security health checker for small business websites. Built to explain security issues in plain English — not just dump raw scan data.

## What it checks (all read-only, non-intrusive)
- SSL/TLS certificate validity and expiry
- Missing security headers (CSP, HSTS, X-Frame-Options, etc.)
- Common exposed sensitive files (.env, .git/config, backup files)
- Email spoofing protection (SPF, DMARC records)

## What it deliberately does NOT do
- No exploitation, no brute forcing, no unauthorized access attempts
- No port scanning of arbitrary hosts
- No scanning without the user confirming ownership/permission (enforced in the UI)

This keeps the tool in the same legal/ethical category as tools like SSL Labs or Mozilla Observatory — informational, passive, consent-gated.

## Setup

```bash
npm install
export OPENROUTER_API_KEY=your_key_here   # optional, needed for the AI plain-English report
npm start
```

Visit `http://localhost:3000`.

## Deploying
Same pattern as StarredList — deploy to Vercel or Render. Note: this is an Express server (not just static), so on Vercel you'll want to use it as a Serverless Function or deploy on Render/Railway instead, which handle long-running Node servers more simply.

## Roadmap ideas
- Add WordPress/CMS version detection (safe, header/meta-based only)
- Historical scan tracking (store past scans, show trend over time)
- Email report delivery
- Batch scanning for multiple domains (agencies managing several client sites)

## Legal note
This tool is for scanning domains you own or have explicit written permission to test. Scanning third-party systems without authorization may violate computer misuse laws in your jurisdiction, regardless of intent.
