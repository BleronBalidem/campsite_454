# TM05-86: campsite layer response times

`time_campsite_layer.py` times `/api/campsites/` and `/api/map-data/?layers=campsites` for
two Adirondack viewports: best and median of 5 warm runs, plus the query count, through
Django's test client.

- **Data:** the dev snapshot `dev-data-2026-10-05` (`make restore`), migrated, then
  `enrich_campsites adirondacks`.
- **Machine:** local PostgreSQL 16 + PostGIS 3.4 in WSL2 Ubuntu, Windows 11 laptop.
- **Measured:** 2026-10-13.

```
DATABASE_URL=postgis://... python artifacts/tm05-86/time_campsite_layer.py "<label>"
```

## Before (main at 0545098)

| Viewport | Endpoint | Best | Median | Queries | Returned / matched | Scored |
|---|---|---|---|---|---|---|
| Adirondack Park (regions.yml) | `/api/campsites/` | 8 ms | 11 ms | 1 | 563 / 563 | 0 |
| Adirondack Park (regions.yml) | `/api/map-data/` | 8 ms | 9 ms | 1 | 563 / 563 | 0 |
| High Peaks, 33 km | `/api/campsites/` | 3 ms | 3 ms | 1 | 52 / 52 | 0 |
| High Peaks, 33 km | `/api/map-data/` | 3 ms | 4 ms | 1 | 52 / 52 | 0 |

## Rejected: scoring every site from scratch per request

| Viewport | Endpoint | Best | Median | Queries | Returned / matched | Scored |
|---|---|---|---|---|---|---|
| Adirondack Park (regions.yml) | `/api/campsites/` | 17141 ms | 18067 ms | 3943 | 563 / 563 | 563 |
| Adirondack Park (regions.yml) | `/api/map-data/` | 16273 ms | 16835 ms | 3943 | 563 / 563 | 563 |
| High Peaks, 33 km | `/api/campsites/` | 762 ms | 851 ms | 366 | 52 / 52 | 52 |
| High Peaks, 33 km | `/api/map-data/` | 759 ms | 783 ms | 366 | 52 / 52 | 52 |

Per factor, over 40 sites: water 36.0 ms and 3 queries per site; legal 2.4 ms; trail
1.8 ms; weather 1.3 ms; slope 1.3 ms; land cover 0.

## After: stored factor results (shipped)

| Viewport | Endpoint | Best | Median | Queries | Returned / matched | Scored |
|---|---|---|---|---|---|---|
| Adirondack Park (regions.yml) | `/api/campsites/` | 1256 ms | 1706 ms | 1128 | 563 / 563 | 563 |
| Adirondack Park (regions.yml) | `/api/map-data/` | 1282 ms | 1387 ms | 1128 | 563 / 563 | 563 |
| High Peaks, 33 km | `/api/campsites/` | 119 ms | 146 ms | 106 | 52 / 52 | 52 |
| High Peaks, 33 km | `/api/map-data/` | 110 ms | 118 ms | 106 | 52 / 52 | 52 |

The remaining queries are two analysis-cache lookups per site (slope and weather).
`enrich_campsites adirondacks` took 32.0 s for 563 campsites with the stored results.
