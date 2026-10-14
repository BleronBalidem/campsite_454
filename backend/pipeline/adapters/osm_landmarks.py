"""
OSM landmarks adapter: peaks and trailheads from OpenStreetMap via Overpass (TM05-89).

What it ingests
---------------
- **Peaks**: `natural=peak`, with the name and the `ele` tag as `elevation_m`.
- **Trailheads**: `highway=trailhead`, with the name.

Both are points a hiker navigates by, and both land in `Landmark` with a `kind`, because
the framework binds one adapter to one model and the two are the same shape.

Nodes and ways, `out center`
----------------------------
Almost every peak and trailhead is a node. A few trailheads are mapped as a way (the
outline of the parking area), so ways are asked for too and `out center` gives each one a
representative point, the same choice `osm_campsites` makes. Relations are not asked for.

Elevation is parsed carefully
-----------------------------
OSM defines `ele` as metres, written as a bare number, but it is free text and real values
include `1629 m`, `1629.3` and `5344 ft`. `parse_elevation_m` reads a number with an
optional metre or foot unit and returns null for anything else, including a value outside
the range of elevations on Earth. A peak with no usable elevation is still ingested: the
peak is real, only its height is unknown.
"""

import re
from collections.abc import Iterable, Iterator

from geodata.models import Landmark
from pipeline.adapters.base import SourceAdapter
from pipeline.adapters.osm_campsites import OsmCampsitesAdapter
from pipeline.adapters.registry import register
from pipeline.aoi import AreaOfInterest
from pipeline.overpass import OverpassClient

LANDMARK_ELEMENT_TYPES = ("node", "way")

# OSM tag to Landmark.Kind. Checked in order, first match wins. Each one is also an
# Overpass tag filter, recorded in every run's parameters.
KIND_RULES: tuple[tuple[str, str, str], ...] = (
    ("natural", "peak", Landmark.Kind.PEAK),
    ("highway", "trailhead", Landmark.Kind.TRAILHEAD),
)

METRES_PER_FOOT = 0.3048

# A number with an optional unit. A comma is not accepted: "1,629" could be a thousands
# separator or a decimal comma, and guessing would store a height nobody published.
_ELEVATION = re.compile(
    r"^(?P<value>-?\d+(?:\.\d+)?)\s*(?P<unit>m|meters?|metres?|ft|feet|')?$", re.IGNORECASE
)

# The Dead Sea shore to above Everest. Anything outside is a tagging error.
MIN_ELEVATION_M = -430.0
MAX_ELEVATION_M = 8900.0


def parse_elevation_m(value: str | None) -> float | None:
    """An OSM `ele` value in metres, or None when it is missing or cannot be read."""
    match = _ELEVATION.match((value or "").strip())
    if not match:
        return None
    elevation_m = float(match["value"])
    if (match["unit"] or "m").lower() in ("ft", "feet", "'"):
        elevation_m *= METRES_PER_FOOT
    if not MIN_ELEVATION_M <= elevation_m <= MAX_ELEVATION_M:
        return None
    return round(elevation_m, 1)


@register
class OsmLandmarksAdapter(SourceAdapter):
    """Peaks and trailheads from OpenStreetMap."""

    name = "osm-landmarks"
    source = Landmark.Source.OSM
    model = Landmark

    # Overpass returns WGS84 lat/lon directly, so the framework's reprojection is a no-op.
    source_srid = AreaOfInterest.SRID

    # Points only and sparse, like campsites, so the same tile size applies.
    max_tile_degrees = 2.0

    query_timeout_seconds = 180

    def __init__(self, client: OverpassClient | None = None):
        super().__init__()
        # Injectable so tests never touch the network, matching osm_campsites.
        self.client = client or OverpassClient(timeout_seconds=self.query_timeout_seconds)

    # --- fetch ------------------------------------------------------------------------

    def build_query(self, aoi: AreaOfInterest) -> str:
        """Overpass QL for every peak and trailhead node and way intersecting `aoi`."""
        bbox = aoi.as_overpass_bbox()
        parts = "".join(
            f'{element}["{key}"="{value}"]({bbox});'
            for key, value, _ in KIND_RULES
            for element in LANDMARK_ELEMENT_TYPES
        )
        return f"[out:json][timeout:{self.query_timeout_seconds}];({parts});out center;"

    def fetch(self, aoi: AreaOfInterest) -> Iterator[list[dict]]:
        """One Overpass call per area, yielding its elements as a single page."""
        payload = self.client.query(self.build_query(aoi))
        yield payload["elements"]

    # --- normalize --------------------------------------------------------------------

    def normalize(self, raw: Iterable[list[dict]]) -> Iterator[dict]:
        seen: set[str] = set()
        for elements in raw:
            for element in elements:
                if element.get("type") not in LANDMARK_ELEMENT_TYPES:
                    continue
                if self.map_kind(element.get("tags") or {}) is None:
                    continue
                # One row per OSM element, even if it matched both tag filters.
                source_id = self.source_id_for(element)
                if source_id in seen:
                    continue
                seen.add(source_id)
                yield self.to_record(element)

    def to_record(self, element: dict) -> dict:
        """One Overpass element to one Landmark field dict."""
        tags = element.get("tags") or {}
        kind = self.map_kind(tags)

        return {
            "source_id": self.source_id_for(element),
            "name": (tags.get("name") or "").strip()[:255],
            "geom": OsmCampsitesAdapter.point_for(element),
            "kind": kind,
            # A trailhead's `ele` is not its story; only a peak's height is kept.
            "elevation_m": parse_elevation_m(tags.get("ele"))
            if kind == Landmark.Kind.PEAK
            else None,
            "raw": {"id": element.get("id"), "type": element.get("type"), "tags": tags},
        }

    @staticmethod
    def map_kind(tags: dict) -> str | None:
        """First matching rule wins; None means the element is neither kind."""
        for key, value, kind in KIND_RULES:
            if (tags.get(key) or "").strip().lower() == value:
                return kind
        return None

    @staticmethod
    def source_id_for(element: dict) -> str:
        """`node/12345` or `way/12345`: OSM numbers each element type separately."""
        return f"{element['type']}/{element['id']}"

    def run_parameters(self, aoi: AreaOfInterest) -> dict:
        parameters = super().run_parameters(aoi)
        parameters.update(
            endpoint=self.client.endpoint,
            element_types=list(LANDMARK_ELEMENT_TYPES),
            tag_filters=[f'["{key}"="{value}"]' for key, value, _ in KIND_RULES],
        )
        return parameters
