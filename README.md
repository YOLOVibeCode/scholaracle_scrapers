# Scholaracle Scraper Library

A downloadable CLI you run on your machine to scrape school portals (Canvas, Skyward, Aeries, or custom) and sync normalized academic data to your Scholaracle account.

## Install

```bash
npm install -g scholaracle-scraper
# or run without installing
npx scholaracle-scraper --help
```

Requires **Node.js 18+**. Playwright browsers are installed automatically on first run.

## Quick start

```bash
# 1. Connect to your Scholaracle account (one-time)
npx scholaracle-scraper setup
# Your browser opens — log in and click "Approve device".
# A connector token is saved locally; you won't be asked again until it expires.

# 2. Run a scraper
npx scholaracle-scraper run canvas

# 3. Schedule automatic runs (optional)
npx scholaracle-scraper schedule
```

## Commands

| Command | Description |
|---------|-------------|
| `setup` | Connect to your Scholaracle account (device auth or paste token) |
| `run [platform]` | Scrape, validate, and upload. Interactive if no platform given |
| `validate [platform]` | Scrape and validate only (no upload) |
| `generate` | Create a custom scraper for a new portal (wizard + AI) |
| `schedule` | Set up cron-based automatic runs |
| `troubleshoot` | AI-powered error diagnosis for failing scrapers |
| `prune <sourceId>` | Remove local asset manifest entries (optionally by term) |

### `run` options

```
--no-upload         Scrape and validate only, do not upload
--skip-assets       Keep original portal URLs (don't download/upload assets)
--max-downloads <n> Max concurrent asset downloads (default: 5)
--scheduled         Non-interactive mode (for cron/scheduled runs)
--silent            Suppress terminal output, log to file only
```

### `prune` options

```
--term <termId>     Remove only entries for this academic term
```

## Included scrapers

| Platform | Entities scraped |
|----------|-----------------|
| **Canvas LMS** | Courses, assignments, grades, files, modules, announcements |
| **Aeries SIS** | Student info, courses, assignments, grades, attendance |
| **Skyward** | Gradebook, missing assignments, attendance, schedule |

## How it works

```
setup ──► run ──► scrape ──► transform ──► validate ──► upload
                    │           │             │            │
              Playwright    ISlcDeltaOp[]   Envelope    Ingest API
              (browser)     (normalized)    (validated)
                    │
                assets ──► download from school ──► upload to server ──► rewrite URLs in ops
```

1. **Setup** — Authenticate with Scholaracle via device auth. Token stored in `~/.scholaracle-scraper/config.json`.
2. **Scrape** — Playwright opens the school portal, logs in, and extracts raw data.
3. **Transform** — Raw data is mapped to `ISlcDeltaOp[]` (upsert/delete operations per entity).
4. **Assets** — Files (PDFs, images) are downloaded from the school, uploaded to the Scholaracle asset store, and URLs in the envelope are rewritten to server URLs.
5. **Validate** — The envelope is checked against the schema before upload.
6. **Upload** — The validated envelope is sent to the Scholaracle Ingest API.

School portal credentials are stored locally and never sent to Scholaracle. Only normalized academic data and downloaded assets are uploaded.

## Asset management

When a scraper finds files (course materials, assignment attachments, messages with attachments), the asset pipeline:

1. **Discovers** asset URLs from the transformed ops.
2. **Downloads** files from the school portal (concurrent, with retries and size limits).
3. **Skips unchanged** files using ETag/Last-Modified from a local manifest.
4. **Uploads** new/changed files to the Scholaracle asset store (S3-backed).
5. **Rewrites** `record.url` fields in the ops from the original school URL to the server asset URL.
6. **Prunes** stale entries no longer referenced by current ops.

The local manifest is stored at `~/.scholaracle-scraper/manifests/<sourceId>.json`.

Use `--skip-assets` to disable asset processing and keep original portal URLs.

See [docs/ASSETS.md](docs/ASSETS.md) for details.

## Creating a custom scraper

```bash
npx scholaracle-scraper generate
```

The wizard walks you through: selecting students, entering the portal URL and credentials, then uses AI to generate a Playwright scraper and transformer for your portal.

See [docs/CUSTOM_SCRAPER.md](docs/CUSTOM_SCRAPER.md) for the full guide.

## Project structure

```
scholaracle_scrapers/
├── bin/
│   └── cli.ts                  # CLI entry point (Commander)
├── src/
│   ├── ai/                     # AI client for scraper generation/troubleshooting
│   │   ├── client.ts
│   │   └── prompts.ts
│   ├── cli/                    # CLI commands
│   │   ├── setup.ts            # Connect to Scholaracle (device auth)
│   │   ├── run.ts              # Run scraper + validate + upload
│   │   ├── validate.ts         # Run + validate only (no upload)
│   │   ├── generate.ts         # AI scraper generation wizard
│   │   ├── schedule.ts         # Cron scheduling
│   │   ├── prune.ts            # Local manifest pruning
│   │   └── troubleshoot.ts     # AI error diagnosis
│   ├── core/                   # Framework
│   │   ├── types.ts            # All entity types + envelope schema
│   │   ├── base-scraper.ts     # Abstract base class for all scrapers
│   │   ├── validator.ts        # Envelope + op validation
│   │   ├── uploader.ts         # Scholaracle Ingest API client
│   │   ├── config.ts           # Local config manager (~/.scholaracle-scraper/)
│   │   ├── api-client.ts       # API client helpers
│   │   ├── asset-manager.ts    # Asset pipeline orchestrator
│   │   ├── asset-downloader.ts # Concurrent file downloader with caching
│   │   ├── asset-uploader.ts   # Multipart upload to asset store
│   │   └── asset-manifest.ts   # Per-source JSON manifest
│   └── scrapers/               # Platform implementations
│       ├── _template/          # Template for new scrapers
│       ├── canvas/             # Canvas LMS
│       ├── aeries/             # Aeries SIS
│       └── skyward/            # Skyward
├── prompts/                    # AI prompt templates
├── docs/                       # Documentation
└── output/                     # Scraper output directory
```

Each scraper follows the **three-file pattern**:

```
src/scrapers/<platform>/
├── metadata.json               # Identity + capabilities
├── <platform>-scraper.ts       # Playwright automation (extends BaseScraper)
└── <platform>-transformer.ts   # Raw data → ISlcDeltaOp[] (pure function)
```

## Entity types

| Entity | Required fields | Description |
|--------|----------------|-------------|
| `assignment` | title | Homework, quiz, test |
| `course` | title | Class/section |
| `gradeSnapshot` | courseExternalId, asOfDate | Current grade per course |
| `attendanceEvent` | date, status | Presence/absence record |
| `teacher` | name | Instructor |
| `courseMaterial` | title, courseExternalId, type | Files, links, syllabi |
| `message` | subject, body, senderName, sentAt | Announcements, messages |
| `studentProfile` | name | Student identity |
| `institution` | name | School/district |
| `academicTerm` | title, startDate, endDate | Semester/quarter/grading period |
| `eventSeries` | title | Recurring calendar events |
| `eventOverride` | seriesExternalId | Single-instance modifications |

## Configuration

All config is stored in `~/.scholaracle-scraper/`:

| File | Contents |
|------|----------|
| `config.json` | API URL, connector token, AI provider, student list, scraper profiles |
| `credentials.json` | Saved school portal credentials (local only, never uploaded) |
| `manifests/<sourceId>.json` | Asset manifests (one per data source) |

## Development

```bash
git clone <repo>
cd scholaracle_scrapers
npm install

npm test              # Run all tests
npm run test:coverage # Tests with coverage report
npm run type-check    # TypeScript strict mode check
npm run build         # Compile to dist/
npm run dev           # Run CLI in dev mode (ts-node)
```

## Documentation

- [Getting Started](docs/GETTING_STARTED.md) — First-time setup walkthrough
- [Custom Scraper Guide](docs/CUSTOM_SCRAPER.md) — Creating scrapers for new portals
- [Asset Management](docs/ASSETS.md) — How file downloads, uploads, and pruning work
- [Envelope Format](docs/ENVELOPE_FORMAT.md) — The `ISlcIngestEnvelopeV1` schema
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Common issues and the AI troubleshooter

## License

MIT
