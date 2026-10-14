# Data status

What data the team snapshot holds, region by region, and how the derived facts were
measured. Update it whenever a region is ingested or enriched, or a new snapshot is
published. Setup and restore instructions are in `docs/setup.md`.

## White Mountains enrichment (TM05-90)

`python manage.py enrich_campsites white-mountains-nh`

**Status: not run yet.** Runtime and per-fact coverage are recorded here once it has run.

| Measure | Value |
|---|---|
| Date run | not run yet |
| Campsites | not run yet |
| Runtime | not run yet |
| Public land unit | not run yet |
| Named water | not run yet |
| Named trail | not run yet |
| Elevation + slope | not run yet |
| Any OSM tag | not run yet |
| Shelter kind | not run yet |
| Display name | not run yet |

### Failures

None recorded: the run has not happened yet.

## Snapshot

The current snapshot is
[dev-data-2026-10-05](https://github.com/dtstaple/campsite_454/releases/tag/dev-data-2026-10-05).
It predates the White Mountains enrichment. A refreshed snapshot is published under
TM05-90 once the enrichment run has completed.
