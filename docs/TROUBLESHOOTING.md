# Troubleshooting

## AI troubleshooter

```bash
npx scholaracle-scraper troubleshoot
```

Reads the latest error output and uses AI to diagnose the issue and suggest fixes. Requires an AI API key configured during `setup`.

## Common issues

### "No connector token found"

```
✗ No connector token found. Run: npx scholaracle-scraper setup
```

You haven't connected to Scholaracle yet. Run `setup` and complete the device auth flow.

### "Your connector token has expired"

```
✗ Your connector token has expired. Run: npx scholaracle-scraper setup
```

Connector tokens last one year. Run `setup` again, choose "Device auth", and approve in the browser.

### Browser fails to launch

```
Error: browserType.launch: Executable doesn't exist at ...
```

Playwright browsers aren't installed. Run:

```bash
npx playwright install chromium
```

### Login fails (timeout)

The scraper timed out waiting for login to complete. Common causes:

- **Wrong credentials** — Check the saved credentials in `~/.scholaracle-scraper/credentials.json`.
- **Two-factor auth** — Some portals require 2FA that Playwright can't handle. Check if the portal has an app-specific password option.
- **Portal changed** — The login page HTML may have changed. Run `generate` to rebuild the scraper, or edit the scraper's `authenticate()` method.
- **Network issues** — Try running with `--scheduled` disabled to see the browser (non-headless).

### Validation errors

```
Envelope invalid: 3 errors
```

The scraper produced data that doesn't match the expected schema. Common causes:

- Missing required fields (e.g., `title` on a course, `date` on attendance).
- Invalid entity type.
- Missing `courseExternalId` on assignments or grade snapshots.

Run `validate` to see detailed error messages:

```bash
npx scholaracle-scraper validate <platform>
```

### Asset download fails

```
GET https://school.edu/files/123 returned 403
```

The file URL requires authentication and the scraper's cookies weren't passed to the downloader. Make sure your scraper implements `getRequestHeaders()` to return Playwright cookies (see the Canvas scraper for reference).

To skip assets entirely:

```bash
npx scholaracle-scraper run <platform> --skip-assets
```

### "No asset manifest found"

```
✗ No asset manifest found for source: src-abc123
```

The `prune` command can't find a manifest for that source. Manifests are created on first successful run with assets enabled. Check the source ID matches what's in your scraper profile.

## Getting help

1. Check the error message — most errors include a hint about what to do.
2. Run `troubleshoot` — AI diagnosis of the latest failure.
3. Check the output directory (`./output/`) for raw scraper output.
4. Run with `--no-upload` to isolate whether the issue is scraping vs. uploading.
