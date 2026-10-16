"""
Recorded hikes (TM05-111): checking a saved track, and writing it as GPX.

A track arrives as segments of [lon, lat, ele_m | null, unix_ms] points, exactly as the
browser recorded them. `clean_track` checks it and `track_geometry` turns it into the
MultiLineString kept for the map. `hike_gpx` writes the GPX 1.1 file: one <trkseg> per
segment, each point with its <time>, so a gap in the recording stays a gap in any app that
loads the file.
"""

import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from django.contrib.gis.geos import LineString, MultiLineString

from api.gpx import CREATOR, GPX_NS, SCHEMA_LOCATION, XSI_NS

#: About 11 hours at one point every second, far more than the browser keeps (it records
#: a point when the hiker has moved, not every fix).
MAX_POINTS = 40_000
MAX_SEGMENTS = 500


class HikeError(ValueError):
    """A track or body that cannot be saved; the message is shown to the user."""


def _number(value, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise HikeError("Every track point is [lon, lat, elevation or null, time in ms].")
    if not low <= value <= high:
        raise HikeError("A track point is out of range.")
    return float(value)


def clean_track(track) -> list[list[list]]:
    """The track, checked: segments of in-range points whose times never go backwards.
    Empty segments are dropped. HikeError when it cannot be a hike."""
    if not isinstance(track, list) or not all(isinstance(s, list) for s in track):
        raise HikeError("track must be a list of segments, each a list of points.")
    if len(track) > MAX_SEGMENTS:
        raise HikeError(f"A hike can have up to {MAX_SEGMENTS} segments.")
    segments, total, last_t = [], 0, None
    for segment in track:
        points = []
        for point in segment:
            if not isinstance(point, list) or len(point) != 4:
                raise HikeError("Every track point is [lon, lat, elevation or null, time in ms].")
            lon = _number(point[0], -180, 180)
            lat = _number(point[1], -90, 90)
            ele = None if point[2] is None else _number(point[2], -500, 9000)
            t = int(_number(point[3], 0, 32503680000000))  # up to the year 3000
            if last_t is not None and t < last_t:
                raise HikeError("Track times must not go backwards.")
            last_t = t
            points.append([lon, lat, ele, t])
        if points:
            segments.append(points)
            total += len(points)
    if total > MAX_POINTS:
        raise HikeError(f"A hike can have up to {MAX_POINTS:,} track points.")
    if not any(len(s) >= 2 for s in segments):
        raise HikeError("There is no track to save yet: it needs at least two points.")
    return segments


def track_geometry(segments: list[list[list]]) -> MultiLineString:
    """The segments with two or more points, as a 4326 MultiLineString."""
    lines = [LineString([(p[0], p[1]) for p in s], srid=4326) for s in segments if len(s) >= 2]
    return MultiLineString(lines, srid=4326)


def iso(ms: int) -> str:
    """Unix milliseconds as GPX's UTC time, to the second's millisecond."""
    stamp = datetime.fromtimestamp(ms / 1000, tz=UTC)
    return stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _sub(parent, name, text=None, **attrs):
    element = ET.SubElement(parent, f"{{{GPX_NS}}}{name}", attrs)
    if text is not None:
        element.text = text
    return element


def hike_gpx(name: str, segments: list[list[list]], desc: str | None = None) -> bytes:
    """GPX 1.1: metadata, then one <trk> with a <trkseg> per recorded segment. Every
    <trkpt> has its <time>, and its <ele> when one was sampled."""
    root = ET.Element(
        f"{{{GPX_NS}}}gpx",
        {"version": "1.1", "creator": CREATOR, f"{{{XSI_NS}}}schemaLocation": SCHEMA_LOCATION},
    )
    metadata = _sub(root, "metadata")
    _sub(metadata, "name", name)
    if desc:
        _sub(metadata, "desc", desc)
    first = next((s[0] for s in segments if s), None)
    if first:
        _sub(metadata, "time", iso(first[3]))
    trk = _sub(root, "trk")
    _sub(trk, "name", name)
    _sub(trk, "type", "hiking")
    for segment in segments:
        trkseg = _sub(trk, "trkseg")
        for lon, lat, ele, t in segment:
            point = _sub(trkseg, "trkpt", lat=f"{lat:.6f}", lon=f"{lon:.6f}")
            if ele is not None:
                _sub(point, "ele", f"{ele:.1f}")
            _sub(point, "time", iso(t))
    ET.indent(root, space=" ")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
