# What Gets Synced and the Dry Run

## How we figure out what should get synced and what shouldn't

Sync is **scoped by run** and **upsert-by-key**; nothing is full-replaced.

1. **One run = one user + one source.**  
   The scraper uses a connector token (bound to a parent account) and a single `sourceId` (e.g. one Canvas or one Skyward connection). Only that user's data for that source is involved.

2. **Only the ops in the envelope are applied.**  
   Each op has a composite key (provider, adapterId, externalId, studentExternalId, institutionExternalId, etc.). The API upserts or deletes only documents matching those keys. So:
   - **Gets updated:** Every entity (assignment, course, gradeSnapshot, etc.) that appears in the envelope for this run.
   - **Does not get updated:** Other users' data; other sources' data (e.g. Skyward when you run Canvas); entities whose keys are not in this envelope.

3. **After the envelope is applied, alerts are derived.**  
   When the run is completed, the server regenerates alerts (missing assignment, deadline, etc.) for that user from the current `slc_assignments` (and terms). So one run updates both the raw SLC data and the derived alerts for that user.

So "what should get synced" for a given run is exactly **the set of ops in the envelope** that run produces. There is no separate "full refresh" of the whole account; each run is additive/upsert for the keys it sends.

## Dry run: "this will potentially be updated"

We run a **dry run** (no upload) to see what would be synced without writing to the API:

- **`validate [platform]`** — Runs the scraper and validates the envelope; does not upload.
- **`run [platform] --no-upload`** — Same: scrape + validate, no upload.

In both cases the scraper runs, builds the envelope, and the CLI validates it and prints:

- Whether validation passed and total op count.
- **Per-entity counts** (e.g. assignment: 50, course: 5, gradeSnapshot: 2).

That output is exactly what would be synced if you ran the same command without `--no-upload` (or with `validate` replaced by `run` with upload). So the dry run is how we say "this will potentially be updated": the envelope contents (and the printed counts) are the potential update set.

Optional next step: run with upload so that the API applies those ops and then derives alerts.
