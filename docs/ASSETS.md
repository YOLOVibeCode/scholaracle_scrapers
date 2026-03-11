# Asset Management

The scraper library includes a full asset pipeline for downloading files (PDFs, images, documents) from school portals and uploading them to the Scholaracle asset store.

## Overview

When a scraper produces ops that reference file URLs (e.g., a `courseMaterial` with a `url` pointing to a Canvas file), the asset pipeline:

1. **Discovers** all URLs in the ops that look like downloadable files.
2. **Checks** the local manifest to see if the file has already been downloaded and is unchanged.
3. **Downloads** new or changed files from the school portal (using Playwright cookies for auth).
4. **Uploads** files to the Scholaracle server (multipart, with content hash for dedup).
5. **Rewrites** URLs in the ops from the original school URL to the server asset URL.
6. **Prunes** manifest entries for files no longer referenced by current ops.

## How it works

### Download

- Concurrent downloads (default 5, configurable via `--max-downloads`).
- **Incremental**: Uses `HEAD` requests with `ETag` / `If-Modified-Since` to skip unchanged files.
- **SHA-256 hashing**: Every download is hashed; the hash is sent on upload for server-side dedup.
- **Size limit**: Files over 100 MB are skipped by default (configurable in `IScraperConfig.options.assetSizeLimit`).
- **Retries**: Failed downloads are retried up to 3 times with exponential backoff.
- **Auth cookies**: The downloader uses Playwright browser cookies so authenticated file URLs work.

### Upload

- Multipart POST to `POST /api/ingest/v1/assets/upload`.
- Includes metadata: `sourceId`, `provider`, `originalUrl`, `contentHash`, `entityType`, `entityExternalId`, optional `academicTermId`.
- **Dedup**: If the server already has a file with the same `sourceId` + `contentHash`, it returns the existing asset URL without re-uploading.

### Manifest

A per-source JSON manifest at `~/.scholaracle-scraper/manifests/<sourceId>.json` tracks:

- Original URL → server asset ID mapping
- Content hash, ETag, Last-Modified for change detection
- Academic term ID for term-based pruning

### URL rewriting

After upload, the pipeline rewrites `record.url` in the ops:

| Entity | Field rewritten |
|--------|----------------|
| `courseMaterial` | `record.url` |
| `assignment` | `record.attachments[].url` |
| `message` | `record.attachments[].url` |

The web app then loads assets from the server URL using the user's JWT.

## CLI options

### Skip assets

```bash
npx scholaracle-scraper run canvas --skip-assets
```

Keeps original school portal URLs in the ops. Useful for debugging or when you don't need file storage.

### Control concurrency

```bash
npx scholaracle-scraper run canvas --max-downloads 10
```

### Prune local manifest

```bash
# Remove all entries for a source
npx scholaracle-scraper prune src-abc123

# Remove entries for a specific academic term
npx scholaracle-scraper prune src-abc123 --term fall-2025
```

This only removes entries from the local manifest. Server-side pruning (soft-delete + grace period) is handled by the API's prune endpoint.

## Server-side pruning

The Scholaracle API supports server-side asset pruning via `POST /api/assets/prune`:

- **By source**: Soft-delete all assets for a disconnected source.
- **By term**: Soft-delete all assets for an ended academic term.
- **Cascade**: With `cascade: true`, resolves the term hierarchy (year → semesters → grading periods) and prunes the term and all its children.
- **Grace period**: Soft-deleted assets are permanently removed after 30 days.

Assets are also auto-pruned when their parent entity (course, assignment, message, courseMaterial) is deleted via ingest.

## Architecture

```
src/core/
├── asset-manager.ts     # Orchestrator: discover → download → upload → rewrite → prune
├── asset-downloader.ts  # Concurrent downloader with caching and retries
├── asset-uploader.ts    # Multipart upload client
└── asset-manifest.ts    # Per-source JSON manifest (local storage)
```

- `asset-manager.ts` is called by `BaseScraper.run()` when `apiBaseUrl` and `connectorToken` are set.
- `BaseScraper.getRequestHeaders()` returns Playwright cookies for authenticated downloads (Canvas implements this).
