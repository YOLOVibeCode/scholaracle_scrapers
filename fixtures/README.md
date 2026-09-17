# Captured portal fixtures

Everything else in this directory is **gitignored — it contains real student data.**

Each `fixtures/<sourceId>/` is captured by an acceptance run (`npm run acceptance`)
against a live school portal:

| File | Contents |
|------|----------|
| `raw.json` | The raw `scrape()` output exactly as extracted from the portal |
| `envelope.json` | The validated `ISlcIngestEnvelopeV1` produced from that raw data |
| `meta.json` | Provider, transform context, capture time, entity counts |

The fixture-replay test suite (`src/core/fixture-replay.test.ts`) re-runs the
transformers over `raw.json` on every `npm test`, so transformer changes are held
to real portal data without touching the network. When the district changes their
markup, one live `npm run acceptance` refreshes the fixtures.

The counts-only standard each run is judged against lives in `acceptance/` —
that directory contains no student data and **is** committed.
