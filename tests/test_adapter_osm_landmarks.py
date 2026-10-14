"""
OSM landmarks adapter tests (TM05-89).

`tests/fixtures/osm_landmarks_page.json` was recorded from a real Overpass `out center`
response over the High Peaks on 2026-10-13, trimmed to nine elements chosen to cover the
cases that differ: peaks with a whole and a decimal elevation, a peak with no name, two
peaks with no `ele` tag at all, and trailheads named and unnamed.

That slice held no messy `ele` value and no trailhead mapped as a way, so those cases are
written out below as elements in the same shape. Nothing here touches the network.
"""

import json
import pathlib
from unittest.mock import Mock

import pytest

from geodata.models import IngestRun, Landmark
from pipeline.adapters import list_adapters
from pipeline.adapters.osm_landmarks import (
    LANDMARK_ELEMENT_TYPES,
    OsmLandmarksAdapter,
    parse_elevation_m,
)
from pipeline.aoi import AreaOfInterest
from pipeline.overpass import OverpassClient

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "osm_landmarks_page.json"

# Full park: 2.1 x 1.9 degrees, so max_tile_degrees=2.0 gives a 2 x 1 grid.
ADK = AreaOfInterest(
    name="adirondacks",
    label="Adirondack Park",
    bbox=(-75.40, 43.00, -73.30, 44.90),
    states=("NY",),
)

TINY = AreaOfInterest(
    name="adk-tiny",
    label="Adirondack test slice",
    bbox=(-74.10, 44.10, -74.05, 44.15),
    states=("NY",),
)

MESSY_PEAK = {
    "type": "node",
    "id": 9101,
    "lat": 44.1127,
    "lon": -73.9237,
    "tags": {"natural": "peak", "name": "Messy Mountain", "ele": "1629 m"},
}

WAY_TRAILHEAD = {
    "type": "way",
    "id": 9102,
    "center": {"lat": 44.1830, "lon": -73.9630},
    "tags": {"highway": "trailhead", "name": "Adirondak Loj Trailhead", "ele": "664"},
}


@pytest.fixture
def elements():
    return json.loads(FIXTURE.read_text())["elements"]


def stub_client(pages):
    """An OverpassClient replacement returning a prepared payload per call."""
    client = Mock(spec=OverpassClient)
    client.endpoint = "https://stub.invalid/api/interpreter"
    client.query = Mock(side_effect=[{"elements": page} for page in pages])
    return client


def adapter_for(pages):
    return OsmLandmarksAdapter(client=stub_client(pages))


def named(elements, name):
    return next(e for e in elements if e["tags"].get("name") == name)


# --- registration and the query ---------------------------------------------------------


def test_the_adapter_is_registered_as_osm_landmarks():
    assert "osm-landmarks" in list_adapters()


def test_the_query_asks_for_peaks_and_trailheads_over_the_right_bbox():
    query = adapter_for([]).build_query(TINY)

    assert 'node["natural"="peak"]' in query
    assert 'node["highway"="trailhead"]' in query
    assert 'way["highway"="trailhead"]' in query
    # Overpass wants (min_lat, min_lon, max_lat, max_lon), not bbox order.
    assert "(44.1,-74.1,44.15,-74.05)" in query
    assert "[out:json]" in query
    assert "out center;" in query


def test_relations_are_never_requested():
    assert "relation" not in adapter_for([]).build_query(TINY)
    assert "relation" not in LANDMARK_ELEMENT_TYPES


# --- normalisation ----------------------------------------------------------------------


def test_a_peak_is_normalised_with_its_name_point_and_elevation(elements):
    marcy = named(elements, "Mount Marcy")

    record = adapter_for([]).to_record(marcy)

    assert record["source_id"] == f"node/{marcy['id']}"
    assert record["name"] == "Mount Marcy"
    assert record["kind"] == Landmark.Kind.PEAK
    assert record["elevation_m"] == 1629.0
    assert record["geom"].srid == 4326
    assert record["geom"].x == pytest.approx(marcy["lon"])
    assert record["geom"].y == pytest.approx(marcy["lat"])


def test_a_trailhead_is_normalised_with_its_name_and_no_elevation(elements):
    trailhead = named(elements, "Cherry Patch Pond Trail Parking Area")

    record = adapter_for([]).to_record(trailhead)

    assert record["kind"] == Landmark.Kind.TRAILHEAD
    assert record["name"] == "Cherry Patch Pond Trail Parking Area"
    assert record["elevation_m"] is None


def test_a_peak_with_no_elevation_is_kept_with_a_null_elevation(elements):
    """The peak is real; only its height is unknown."""
    burtons = named(elements, "Burtons Peak")
    assert "ele" not in burtons["tags"], "fixture peak must have no ele tag"

    records = list(adapter_for([]).normalize([elements]))
    record = next(r for r in records if r["name"] == "Burtons Peak")

    assert record["kind"] == Landmark.Kind.PEAK
    assert record["elevation_m"] is None


def test_an_unnamed_element_gets_an_empty_name(elements):
    unnamed = next(e for e in elements if "name" not in e["tags"])

    assert adapter_for([]).to_record(unnamed)["name"] == ""


def test_every_fixture_element_is_normalised_as_a_peak_or_a_trailhead(elements):
    records = list(adapter_for([]).normalize([elements]))

    assert len(records) == len(elements)
    assert {r["kind"] for r in records} == {Landmark.Kind.PEAK, Landmark.Kind.TRAILHEAD}


def test_a_trailhead_way_becomes_a_point_at_its_center():
    record = adapter_for([]).to_record(WAY_TRAILHEAD)

    assert record["source_id"] == "way/9102"
    assert record["geom"].x == pytest.approx(-73.9630)
    assert record["geom"].y == pytest.approx(44.1830)
    # Elevation is a peak's fact; a trailhead's ele tag is kept only in raw.
    assert record["elevation_m"] is None
    assert record["raw"]["tags"]["ele"] == "664"


def test_an_element_that_is_neither_kind_or_a_relation_is_not_normalised():
    stray = {"type": "node", "id": 1, "lat": 44.1, "lon": -74.0, "tags": {"natural": "cliff"}}
    relation = {"type": "relation", "id": 2, "tags": {"natural": "peak"}}

    assert list(adapter_for([]).normalize([[stray, relation]])) == []


def test_an_element_returned_twice_is_normalised_once():
    records = list(adapter_for([]).normalize([[MESSY_PEAK], [MESSY_PEAK]]))

    assert [r["source_id"] for r in records] == ["node/9101"]


def test_a_peak_that_is_also_a_trailhead_is_a_peak():
    tags = {"natural": "peak", "highway": "trailhead"}

    assert OsmLandmarksAdapter.map_kind(tags) == Landmark.Kind.PEAK


def test_tags_are_preserved_in_raw(elements):
    marcy = named(elements, "Mount Marcy")

    record = adapter_for([]).to_record(marcy)

    assert record["raw"] == {"id": marcy["id"], "type": "node", "tags": marcy["tags"]}


# --- elevation --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1629", 1629.0),
        ("1387.7", 1387.7),
        ("1629 m", 1629.0),
        ("1629m", 1629.0),
        (" 1629 M ", 1629.0),
        ("1629 metres", 1629.0),
        ("5344 ft", 1628.9),
        ("5344'", 1628.9),
        ("-12", -12.0),
    ],
)
def test_elevation_is_read_in_metres(value, expected):
    assert parse_elevation_m(value) == pytest.approx(expected)


@pytest.mark.parametrize(
    "value", [None, "", "high", "1,629", "1629;1630", "~1600", "1629 yards", "99999", "-5000"]
)
def test_elevation_that_cannot_be_read_stays_null(value):
    """Guessing would put a height in front of a hiker that nobody published."""
    assert parse_elevation_m(value) is None


def test_a_messy_elevation_on_a_peak_is_parsed():
    assert adapter_for([]).to_record(MESSY_PEAK)["elevation_m"] == 1629.0


# --- loading ----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
def test_rows_land_with_geometry_and_the_count_is_recorded_in_ingest_run(elements):
    run = adapter_for([elements, []]).run(ADK)

    assert Landmark.objects.count() == len(elements)
    assert run.record_count == len(elements)
    assert run.status == IngestRun.Status.SUCCESS
    assert run.region == "adirondacks"
    assert run.finished_at is not None
    for landmark in Landmark.objects.all():
        assert landmark.source == Landmark.Source.OSM
        assert landmark.geom.srid == 4326
        assert landmark.last_run_id == run.id

    marcy = Landmark.objects.get(name="Mount Marcy")
    assert (marcy.kind, marcy.elevation_m) == (Landmark.Kind.PEAK, 1629.0)
    assert Landmark.objects.get(name="Burtons Peak").elevation_m is None


@pytest.mark.django_db
@pytest.mark.integration
def test_rerunning_upserts_rather_than_duplicating(elements):
    first = adapter_for([elements, []]).run(ADK)
    after_first = Landmark.objects.count()

    second = adapter_for([elements, []]).run(ADK)

    assert Landmark.objects.count() == after_first
    assert first.id != second.id, "each run gets its own provenance row"
    assert second.record_count == first.record_count
    # Every row now points at the newer run.
    assert not Landmark.objects.filter(last_run_id=first.id).exists()


@pytest.mark.django_db
@pytest.mark.integration
def test_a_rerun_updates_a_changed_elevation_in_place(elements):
    adapter_for([[MESSY_PEAK], []]).run(ADK)
    corrected = {**MESSY_PEAK, "tags": {**MESSY_PEAK["tags"], "ele": "1630"}}

    adapter_for([[corrected], []]).run(ADK)

    assert Landmark.objects.get(source_id="node/9101").elevation_m == 1630.0
    assert Landmark.objects.count() == 1


@pytest.mark.django_db
@pytest.mark.integration
def test_run_parameters_record_what_was_asked_for(elements):
    run = adapter_for([elements, []]).run(ADK)

    assert run.parameters["element_types"] == ["node", "way"]
    assert run.parameters["tag_filters"] == ['["natural"="peak"]', '["highway"="trailhead"]']
