# Troubleshoot a Scholaracle Scraper

## Instructions for AI

I have a Scholaracle scraper that isn't working correctly. Please help me diagnose and fix it.

## The Problem

- **Scraper platform:** [e.g., Canvas, Aeries, Skyward, custom]
- **What's happening:** [e.g., "authentication fails", "no data scraped", "data is incomplete", "upload fails"]
- **Error message:** [paste the full error message or stack trace]
- **When it broke:** [e.g., "was working until yesterday", "never worked", "fails intermittently"]

## My Scraper Code

[Paste the relevant scraper file here, or describe what it does]

## Error Log

[Paste the error log from ~/.scholaracle-scraper/logs/ or terminal output]

## What To Check

Common issues and their fixes:

1. **TimeoutError on selector** — The page structure changed. Inspect the live page and update selectors.
2. **Authentication fails** — Check for CAPTCHA, 2FA, changed login flow, or expired session.
3. **Empty data** — The scraper might be navigating to the wrong page or using wrong selectors.
4. **Shadow DOM** — Use `page.locator('host-element').locator('input')` to pierce shadow roots.
5. **Popup windows** — Skyward uses popups. Listen for `context.on('page')` events.
6. **Rate limiting** — Add `page.waitForTimeout(1000)` between requests.
7. **Upload fails (400)** — The envelope format is wrong. Check required fields for each entity type.
8. **Upload fails (401)** — Connector token expired. Run `npx scholaracle-scraper setup`.

## Expected Output

Please provide:
1. **Root cause** — What's actually wrong
2. **Fix** — The specific code change needed
3. **Prevention** — How to make the scraper more resilient to this issue
