"""
Peaks and trailheads on the layer API (TM05-89).

Both layers read one table, `Landmark`, split by `kind`, and are opt-in on
/api/map-data/ so the default first paint is unchanged.
"""

import pytest
from django.contrib.gis.geos import Point
from django.test import Client

from geodata.models import Landmark

pytestmark = [pytest.mark.django_db, pytest.mark.integration]

# The area every fixture row sits inside.
INSIDE = "-74.20,44.00,-73.80,44.30"
# A box in the Pacific, guaranteed to match nothing we create.
ELSEWHERE = "-140.00,10.00,-139.90,10.10"


@pytest.fixture
def client():
    return Client()


def make_landmark(source_id, kind, name, lon=-73.92, lat=44.11, elevation_m=None):
    return Landmark.objects.create(
        source=Landmark.Source.OSM,
        source_id=source_id,
        name=name,
        kind=kind,
        elevation_m=elevation_m,
        geom=Point(lon, lat, srid=4326),
    )


@pytest.fixture
def landmarks():
    make_landmark("node/1", Landmark.Kind.PEAK, "Mount Marcy", elevation_m=1629.0)
    make_landmark("node/2", Landmark.Kind.PEAK, "Burtons Peak", lon=-73.86, lat=44.19)
    make_landmark("node/3", Landmark.Kind.TRAILHEAD, "Adirondak Loj", lon=-73.96, lat=44.18)


def test_the_peaks_layer_returns_only_peaks_with_name_and_elevation(client, landmarks):
    document = client.get(f"/api/peaks/?bbox={INSIDE}").json()

    assert document["type"] == "FeatureCollection"
    assert document["metadata"]["layer"] == "peaks"
    by_id = {feature["id"]: feature for feature in document["features"]}
    assert set(by_id) == {"node/1", "node/2"}
    assert by_id["node/1"]["properties"] == {"name": "Mount Marcy", "elevation_m": 1629.0}
    assert by_id["node/1"]["geometry"] == {"type": "Point", "coordinates": [-73.92, 44.11]}


def test_a_peak_with_no_elevation_is_served_with_a_null(client, landmarks):
    document = client.get(f"/api/peaks/?bbox={INSIDE}").json()

    burtons = next(f for f in document["features"] if f["id"] == "node/2")
    assert burtons["properties"] == {"name": "Burtons Peak", "elevation_m": None}


def test_the_trailheads_layer_returns_only_trailheads_with_a_name(client, landmarks):
    document = client.get(f"/api/trailheads/?bbox={INSIDE}").json()

    assert document["metadata"]["layer"] == "trailheads"
    assert [feature["id"] for feature in document["features"]] == ["node/3"]
    assert document["features"][0]["properties"] == {"name": "Adirondak Loj"}


def test_landmarks_outside_the_bbox_are_not_returned(client, landmarks):
    document = client.get(f"/api/peaks/?bbox={ELSEWHERE}").json()

    assert document["features"] == []
    assert document["metadata"]["matched"] == 0


def test_the_truncation_count_is_per_kind_not_the_whole_table(client, landmarks):
    """The count behind `matched` must apply the same kind filter as the features."""
    document = client.get(f"/api/peaks/?bbox={INSIDE}&limit=1").json()

    assert document["metadata"]["truncated"] is True
    assert document["metadata"]["returned"] == 1
    assert document["metadata"]["matched"] == 2


def test_map_data_serves_peaks_and_trailheads_through_the_layers_option(client, landmarks):
    document = client.get(f"/api/map-data/?bbox={INSIDE}&layers=peaks,trailheads").json()

    assert set(document["layers"]) == {"peaks", "trailheads"}
    assert document["metadata"]["layers"] == ["peaks", "trailheads"]
    assert len(document["layers"]["peaks"]["features"]) == 2
    assert len(document["layers"]["trailheads"]["features"]) == 1


def test_map_data_leaves_them_out_unless_asked(client, landmarks):
    document = client.get(f"/api/map-data/?bbox={INSIDE}").json()

    assert "peaks" not in document["layers"]
    assert "trailheads" not in document["layers"]


def test_an_unknown_layer_names_peaks_and_trailheads_as_available(client):
    response = client.get(f"/api/map-data/?bbox={INSIDE}&layers=summits")

    assert response.status_code == 400
    assert "peaks, trailheads" in response.json()["error"]
