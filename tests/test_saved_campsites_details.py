"""
Tests for the richer saved campsites list (TM05-87): each saved site's display name,
coordinates, score and public land unit, the same as the campsite detail panel shows, and
only ever the signed-in user's own saves.
"""

import pytest
import requests
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from test_api_campsite_score import LAT, LON, Network, campsite, surroundings

from accounts.models import SavedCampsite
from analysis.analyses import elevation, weather
from enrichment.facts import enrich
from geodata.models import PublicLand
from scoring.config import load

pytestmark = [pytest.mark.django_db, pytest.mark.integration]

URL = "/api/saved-campsites/"


@pytest.fixture(autouse=True)
def network(monkeypatch):
    stub = Network()
    monkeypatch.setattr(elevation, "post_samples", stub.post_samples)
    monkeypatch.setattr(weather, "fetch_json", stub.fetch_json)
    monkeypatch.setattr(requests.Session, "request", stub.request)
    return stub


def account(username="rania"):
    user = get_user_model().objects.create_user(username, f"{username}@example.com", "pw-x9!")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=user).key}")
    return user, client


def detail(client, source_id):
    return client.get(f"/api/campsites/{source_id}/detail/").json()


def test_an_enriched_site_lists_what_the_panel_shows(network):
    surroundings()
    PublicLand.objects.update(name="Test Wilderness Area", manager="Test Agency")
    site = campsite()
    enrich(site)
    user, client = account()
    SavedCampsite.objects.create(user=user, campsite=site)
    network.open = False

    [entry] = client.get(URL).json()
    panel = detail(client, "node/1")

    assert entry["id"] == "node/1"
    assert entry["display_name"] == panel["display_name"] == "Test Site"
    assert entry["display_name_derived"] is False
    assert entry["latitude"] == pytest.approx(LAT)
    assert entry["longitude"] == pytest.approx(LON)
    assert entry["score_status"] == "scored"
    assert isinstance(entry["score"], int)
    assert entry["score"] == panel["score"]
    assert entry["public_land"] == panel["facts"]["public_land"]
    assert entry["public_land"] == {
        "name": "Test Wilderness Area",
        "manager": "Test Agency",
        "designation": "Test Wilderness",
        "access": "open",
        "gap_status": "1",
    }
    assert network.calls == []


def test_an_unnamed_site_gets_its_derived_name_flagged(network):
    surroundings()
    site = campsite()
    site.name = ""
    site.save()
    enrich(site)
    user, client = account()
    SavedCampsite.objects.create(user=user, campsite=site)
    network.open = False

    [entry] = client.get(URL).json()

    assert entry["name"] == ""
    # Water and trail are both ~60 m away; whichever is nearer names it.
    assert entry["display_name"] in {"Campsite near Test Brook", "Campsite near Test Trail"}
    assert entry["display_name_derived"] is True
    assert entry["display_name"] == detail(client, "node/1")["display_name"]


def test_an_unenriched_site_has_its_source_name_and_no_score(network):
    site = campsite("campsite/104324")
    user, client = account()
    SavedCampsite.objects.create(user=user, campsite=site)
    network.open = False

    [entry] = client.get(URL).json()

    assert entry["display_name"] == "Test Site"
    assert entry["display_name_derived"] is False
    assert entry["score"] is None
    assert entry["score_status"] == "pending"
    assert entry["public_land"] is None
    assert network.calls == []


def test_a_site_outside_every_parcel_has_no_land_unit(network):
    site = campsite()
    enrich(site)  # nothing ingested around it: no parcel contains it
    user, client = account()
    SavedCampsite.objects.create(user=user, campsite=site)
    network.open = False

    [entry] = client.get(URL).json()

    assert entry["public_land"] is None
    assert entry["score_status"] in {"scored", "not_available"}


def test_the_score_uses_the_users_own_weights(network):
    surroundings()
    site = campsite()
    enrich(site)
    user, client = account()
    SavedCampsite.objects.create(user=user, campsite=site)
    weights = {key: 0.0 for key in load().weights} | {"trail": 1.0}
    client.put("/api/auth/me/weights/", {"weights": weights}, format="json")
    network.open = False

    [entry] = client.get(URL).json()

    assert entry["score"] == detail(client, "node/1")["score"]


def test_only_the_signed_in_users_saves_are_listed(network):
    surroundings()
    mine, theirs = campsite("node/1"), campsite("node/2")
    for site in (mine, theirs):
        enrich(site)
    rania, rania_client = account("rania")
    omar, omar_client = account("omar")
    SavedCampsite.objects.create(user=rania, campsite=mine)
    SavedCampsite.objects.create(user=omar, campsite=theirs)
    network.open = False

    assert [entry["id"] for entry in rania_client.get(URL).json()] == ["node/1"]
    assert [entry["id"] for entry in omar_client.get(URL).json()] == ["node/2"]
    assert APIClient().get(URL).status_code == 401


def test_the_earlier_fields_are_all_still_there(network):
    site = campsite()
    user, client = account()
    SavedCampsite.objects.create(user=user, campsite=site)

    [entry] = client.get(URL).json()

    assert set(entry) == {
        "id",
        "name",
        "site_type",
        "reservable",
        "capacity",
        "latitude",
        "longitude",
        "saved_at",
        "display_name",
        "display_name_derived",
        "score",
        "score_status",
        "public_land",
    }
