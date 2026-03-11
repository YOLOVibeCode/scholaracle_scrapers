# Getting Started

## Prerequisites

- **Node.js 18+** (check with `node --version`)
- A **Scholaracle account** at [scholarmancy.com](https://scholarmancy.com)
- At least one **student** added to your account

## Step 1: Install

```bash
npm install -g scholaracle-scraper
```

Or use `npx` to run without installing:

```bash
npx scholaracle-scraper --help
```

## Step 2: Connect to Scholaracle

```bash
npx scholaracle-scraper setup
```

You'll be prompted for:

1. **API URL** — Press Enter to accept the default (`https://api.scholarmancy.com`).
2. **Authentication** — Choose **"Device auth flow"**:
   - The CLI generates an activation code and opens your browser.
   - Log in to Scholaracle if needed.
   - The code is pre-filled; click **"Approve device"**.
   - The CLI receives a connector token and saves it locally.
3. **AI provider** (optional) — If you want to use `generate` or `troubleshoot`, provide an OpenAI or Anthropic API key.

Your config is saved to `~/.scholaracle-scraper/config.json`. The connector token is valid for one year. Run `setup` again when it expires.

## Step 3: Run a scraper

**Interactive mode** — the CLI asks which student and platform to scrape:

```bash
npx scholaracle-scraper run
```

**Direct mode** — specify the platform:

```bash
npx scholaracle-scraper run canvas
```

On first run for a student+platform, you'll be asked for school portal credentials (URL, username, password). Choose "Save credentials for future runs" so you don't have to enter them again.

The scraper will:
1. Launch a headless browser
2. Log in to the school portal
3. Extract grades, assignments, attendance, etc.
4. Download any file assets (PDFs, documents)
5. Validate the data
6. Upload to Scholaracle

## Step 4: Schedule automatic runs (optional)

```bash
npx scholaracle-scraper schedule
```

This sets up a cron job to run your scrapers automatically (e.g., daily at 6 AM).

## Validate without uploading

To test a scraper without sending data to Scholaracle:

```bash
npx scholaracle-scraper validate canvas
# or
npx scholaracle-scraper run --no-upload
```

## Troubleshoot errors

If a scraper fails, use the AI troubleshooter:

```bash
npx scholaracle-scraper troubleshoot
```

It reads the latest error output and suggests fixes.

## Where things are stored

| Location | What |
|----------|------|
| `~/.scholaracle-scraper/config.json` | API URL, connector token, student list, scraper profiles |
| `~/.scholaracle-scraper/credentials.json` | Saved school portal credentials (never uploaded) |
| `~/.scholaracle-scraper/manifests/` | Asset manifests (tracks downloaded files) |
| `./output/` | Scraper output files (for debugging) |

## Next steps

- [Custom Scraper Guide](CUSTOM_SCRAPER.md) — Create a scraper for a portal we don't support yet
- [Asset Management](ASSETS.md) — How file downloads and uploads work
- [Envelope Format](ENVELOPE_FORMAT.md) — The data format scrapers produce
