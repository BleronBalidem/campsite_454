"""Time the campsite map layer against a real database (TM05-86).

    DATABASE_URL=... python artifacts/tm05-86/time_campsite_layer.py <label>

Best and median of 5 warm runs through Django's test client, for the whole park and a
High Peaks viewport, on /api/campsites/ and /api/map-data/ (campsites only).
"""

import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.db import connection, reset_queries  # noqa: E402
from django.test import Client  # noqa: E402

settings.ALLOWED_HOSTS = ["*"]
settings.DEBUG = True  # so connection.queries counts the queries per request

VIEWPORTS = {
    "Adirondack Park (regions.yml)": "-75.40,43.00,-73.30,44.90",
    "High Peaks, 33 km": "-74.10,44.05,-73.80,44.25",
}
URLS = {
    "/api/campsites/": "/api/campsites/?bbox={bbox}",
    "/api/map-data/": "/api/map-data/?bbox={bbox}&layers=campsites",
}
RUNS = 5

client = Client()
label = sys.argv[1] if len(sys.argv) > 1 else "run"
print(f"## {label}\n")
print("| Viewport | Endpoint | Best | Median | Queries | Returned / matched | Scored |")
print("|---|---|---|---|---|---|---|")
for name, bbox in VIEWPORTS.items():
    for endpoint, template in URLS.items():
        url = template.format(bbox=bbox)
        client.get(url)  # warm
        times = []
        for _ in range(RUNS):
            reset_queries()
            start = time.perf_counter()
            response = client.get(url)
            times.append((time.perf_counter() - start) * 1000)
            queries = len(connection.queries)
        body = response.json()
        layer = body["layers"]["campsites"] if "layers" in body else body
        meta = layer["metadata"]
        scored = sum(1 for f in layer["features"] if f["properties"].get("score") is not None)
        print(
            f"| {name} | `{endpoint}` | {min(times):.0f} ms | {statistics.median(times):.0f} ms"
            f" | {queries} | {meta['returned']} / {meta['matched']} | {scored} |"
        )
print()
