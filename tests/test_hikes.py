"""
Recorded hikes (TM05-111): saving, listing, reading back and deleting a hike, per-user
isolation, signed-out access, track validation, and the GPX file with a time on every
point (validated against the GPX 1.1 schema, as in test_gpx.py).

Discarding a hike is the browser's business (it is never sent), so the server side of
"save or discard" is that nothing exists until a POST, and a DELETE removes it.
"""

import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import xmlschema
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from planning.hikes import HikeError, clean_track, hike_gpx, iso, track_geometry
from planning.models import Hike

FIXTURES = Path(__file__).parent / "fixtures"
SCHEMA = xmlschema.XMLSchema(FIXTURES / "gpx-1.1.xsd")
NS = {"g": "http://www.topografix.com/GPX/1/1"}
T0 = 1_791_000_000_000  # 2026-10-03, in unix ms

#: Two segments: a gap (the page was hidden) between 04:02 and 04:10 UTC.
TRACK = [
    [
        [-73.96, 44.18, 640.0, T0],
        [-73.959, 44.181, 642.5, T0 + 60_000],
        [-73.958, 44.182, None, T0 + 120_000],
    ],
    [[-73.95, 44.19, 700.0, T0 + 600_000], [-73.949, 44.191, 702.0, T0 + 660_000]],
]


def body(**overrides):
    data = {
        "name": "Morning on Van Hoevenberg",
        "mode": "trail",
        "simulated": False,
        "osm_id": 1376439,
        "trail_name": "Van Hoevenberg Trail",
        "elapsed_s": 660,
        "moving_s": 540,
        "distance_m": 412.3,
        "gain_m": 18.0,
        "track": TRACK,
    }
    data.update(overrides)
    return data


def client_for(username):
    user = get_user_model().objects.create_user(username=username, password="a-strong-passw0rd!")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=user).key}")
    return client


# --- the track (pure) --------------------------------------------------------------------


def test_a_track_keeps_its_segments_and_drops_empty_ones():
    segments = clean_track([TRACK[0], [], TRACK[1]])
    assert [len(s) for s in segments] == [3, 2]
    assert segments[0][2] == [-73.958, 44.182, None, T0 + 120_000]


@pytest.mark.parametrize(
    "track, message",
    [
        (None, "list of segments"),
        ([[[-73.9, 44.1, None]]], "Every track point"),
        ([[[-200, 44.1, None, T0], [-73.9, 44.1, None, T0 + 1]]], "out of range"),
        ([[["x", 44.1, None, T0], [-73.9, 44.1, None, T0 + 1]]], "Every track point"),
        ([[[-73.9, 44.1, None, T0 + 5], [-73.9, 44.1, None, T0]]], "backwards"),
        ([[[-73.9, 44.1, None, T0]], [[-73.8, 44.1, None, T0 + 1]]], "at least two points"),
    ],
)
def test_a_bad_track_is_refused_with_a_reason(track, message):
    with pytest.raises(HikeError, match=message):
        clean_track(track)


def test_the_geometry_skips_a_one_point_segment():
    geometry = track_geometry([TRACK[0], [[-73.9, 44.2, None, T0 + 700_000]], TRACK[1]])
    assert geometry.srid == 4326
    assert len(geometry) == 2


def test_times_are_utc_with_milliseconds():
    assert iso(T0) == "2026-10-03T04:00:00.000Z"
    assert iso(T0 + 1_234) == "2026-10-03T04:00:01.234Z"


def test_the_gpx_has_a_segment_per_recording_and_a_time_on_every_point():
    document = hike_gpx("Morning", clean_track(TRACK), desc="Recorded with CampSite.")
    SCHEMA.validate(document.decode())
    root = ET.fromstring(document)
    segments = root.findall("g:trk/g:trkseg", NS)
    assert [len(s.findall("g:trkpt", NS)) for s in segments] == [3, 2]
    points = root.findall(".//g:trkpt", NS)
    assert [p.find("g:time", NS).text for p in points] == [
        "2026-10-03T04:00:00.000Z",
        "2026-10-03T04:01:00.000Z",
        "2026-10-03T04:02:00.000Z",
        "2026-10-03T04:10:00.000Z",
        "2026-10-03T04:11:00.000Z",
    ]
    # GPX puts latitude first; <ele> only where one was sampled.
    assert points[0].get("lat") == "44.180000" and points[0].get("lon") == "-73.960000"
    assert points[0].find("g:ele", NS).text == "640.0"
    assert points[2].find("g:ele", NS) is None
    assert root.find("g:metadata/g:time", NS).text == "2026-10-03T04:00:00.000Z"


# --- the API -----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestHikeApi:
    def test_nothing_is_stored_until_the_hiker_saves(self):
        alice = client_for("alice")
        assert alice.get("/api/hikes/").json() == []
        assert Hike.objects.count() == 0

    def test_save_list_read_and_delete(self):
        alice = client_for("alice")
        created = alice.post("/api/hikes/", body(), format="json")
        assert created.status_code == 201
        hike = created.json()
        assert hike["name"] == "Morning on Van Hoevenberg"
        assert hike["distance_m"] == 412.3
        assert hike["moving_s"] == 540
        # Start and end come from the track's own times.
        assert hike["started_at"].startswith("2026-10-03T04:00:00")
        assert hike["ended_at"].startswith("2026-10-03T04:11:00")

        listed = alice.get("/api/hikes/").json()
        assert [h["id"] for h in listed] == [hike["id"]]
        assert "track" not in listed[0]

        one = alice.get(f"/api/hikes/{hike['id']}/").json()
        assert one["track"] == TRACK
        assert one["trail_name"] == "Van Hoevenberg Trail"

        assert alice.delete(f"/api/hikes/{hike['id']}/").status_code == 204
        assert alice.get("/api/hikes/").json() == []

    def test_a_free_hike_keeps_no_trail(self):
        alice = client_for("alice")
        hike = alice.post(
            "/api/hikes/", body(mode="free", osm_id=5, trail_name="ignored"), format="json"
        ).json()
        assert hike["mode"] == "free"
        assert hike["osm_id"] is None and hike["trail_name"] is None

    def test_another_users_hike_is_404_everywhere(self):
        alice, bob = client_for("alice"), client_for("bob")
        hike = alice.post("/api/hikes/", body(), format="json").json()
        assert bob.get("/api/hikes/").json() == []
        assert bob.get(f"/api/hikes/{hike['id']}/").status_code == 404
        assert bob.get(f"/api/hikes/{hike['id']}/gpx/").status_code == 404
        assert bob.delete(f"/api/hikes/{hike['id']}/").status_code == 404
        assert Hike.objects.filter(pk=hike["id"]).exists()

    def test_signed_out_is_401(self):
        anonymous = APIClient()
        assert anonymous.get("/api/hikes/").status_code == 401
        assert anonymous.post("/api/hikes/", body(), format="json").status_code == 401

    @pytest.mark.parametrize(
        "overrides, message",
        [
            ({"mode": "drive"}, "mode"),
            ({"elapsed_s": -1}, "elapsed_s"),
            ({"distance_m": "far"}, "distance_m"),
            ({"moving_s": 9999}, "more than elapsed_s"),
            ({"track": []}, "at least two points"),
        ],
    )
    def test_a_bad_body_is_400_with_a_reason(self, overrides, message):
        alice = client_for("alice")
        response = alice.post("/api/hikes/", body(**overrides), format="json")
        assert response.status_code == 400
        assert message in response.json()["error"]
        assert Hike.objects.count() == 0

    def test_the_gpx_download(self):
        alice = client_for("alice")
        hike = alice.post("/api/hikes/", body(simulated=True), format="json").json()
        response = alice.get(f"/api/hikes/{hike['id']}/gpx/")
        assert response.status_code == 200
        assert response["Content-Type"] == "application/gpx+xml"
        assert 'filename="morning-on-van-hoevenberg.gpx"' in response["Content-Disposition"]
        SCHEMA.validate(response.content.decode())
        desc = ET.fromstring(response.content).find("g:metadata/g:desc", NS).text
        assert desc == "Recorded with CampSite (simulated walk) on Van Hoevenberg Trail."

    def test_deleting_the_account_deletes_its_hikes(self):
        alice = client_for("alice")
        alice.post("/api/hikes/", body(), format="json")
        assert alice.delete("/api/auth/me/").status_code == 204
        assert Hike.objects.count() == 0
