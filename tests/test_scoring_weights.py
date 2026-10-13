"""
Tests for per-user factor weights (TM05-46): saving and reading them, validation, the
isolation between users, and the scores that use them.
"""

import pytest
import requests
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from test_api_campsite_score import LAT, LON, Network, campsite, surroundings

from accounts.models import ScoringWeights
from analysis.analyses import elevation, weather
from enrichment.facts import enrich
from scoring.config import load

pytestmark = [pytest.mark.django_db, pytest.mark.integration]

URL = "/api/auth/me/weights/"
BBOX = f"{LON - 0.05},{LAT - 0.05},{LON + 0.05},{LAT + 0.05}"


@pytest.fixture(autouse=True)
def network(monkeypatch):
    stub = Network()
    monkeypatch.setattr(elevation, "post_samples", stub.post_samples)
    monkeypatch.setattr(weather, "fetch_json", stub.fetch_json)
    monkeypatch.setattr(requests.Session, "request", stub.request)
    return stub


def signed_in(username="rania"):
    user = get_user_model().objects.create_user(username, f"{username}@example.com", "pw-x9!")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=user).key}")
    return client


def put(client, weights):
    return client.put(URL, {"weights": weights}, format="json")


def defaults():
    return dict(load().weights)


# --- saving and reading ---------------------------------------------------------------


def test_signed_out_requests_are_refused():
    client = APIClient()
    assert client.get(URL).status_code == 401
    assert put(client, {"water": 1}).status_code == 401
    assert client.delete(URL).status_code == 401


def test_a_new_user_sees_the_defaults():
    body = signed_in().get(URL).json()

    assert body == {"weights": defaults(), "defaults": defaults(), "custom": False}


def test_saved_weights_are_returned_and_kept():
    client = signed_in()
    weights = {key: 1.0 for key in defaults()}

    response = put(client, weights)

    assert response.status_code == 200
    assert response.json() == {"weights": weights, "defaults": defaults(), "custom": True}
    assert client.get(URL).json()["weights"] == weights


def test_factors_left_out_keep_the_default_weight():
    client = signed_in()

    body = put(client, {"water": 0.9, "slope": 0}).json()

    assert body["weights"] == {**defaults(), "water": 0.9, "slope": 0.0}


def test_saving_again_replaces_the_earlier_weights():
    client = signed_in()
    put(client, {"water": 0.9})

    body = put(client, {"trail": 0.7}).json()

    assert body["weights"] == {**defaults(), "trail": 0.7}
    assert ScoringWeights.objects.count() == 1


def test_delete_goes_back_to_the_defaults():
    client = signed_in()
    put(client, {"water": 0.9})

    assert client.delete(URL).status_code == 204
    assert client.get(URL).json()["custom"] is False
    assert ScoringWeights.objects.count() == 0


# --- validation -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("weights", "reason"),
    [
        ({"water": -0.1}, "must be a number >= 0"),
        ({key: 0 for key in load().weights}, "at least one weight must be above 0"),
        ({"water": "0.5"}, "must be a number"),
        ({"water": True}, "must be a number"),
        ({"water": None}, "must be a number"),
        ({"water": [1]}, "must be a number"),
        ({"views": 1}, "unknown factor(s): views"),
        ({}, "must be an object"),
        ([0.5, 0.5], "must be an object"),
        (None, "must be an object"),
        ("water=1", "must be an object"),
    ],
)
def test_invalid_weights_are_rejected_with_a_reason(weights, reason):
    client = signed_in()

    response = put(client, weights)

    assert response.status_code == 400
    assert reason in response.json()["error"]
    assert ScoringWeights.objects.count() == 0


def test_a_body_without_weights_is_rejected():
    response = signed_in().put(URL, {"water": 1}, format="json")

    assert response.status_code == 400
    assert "must be an object" in response.json()["error"]


@pytest.mark.parametrize("raw", ['{"weights": {"water": 1e999}}', '{"weights": {"water": NaN}}'])
def test_non_finite_numbers_are_rejected(raw):
    response = signed_in().generic("PUT", URL, raw, content_type="application/json")

    assert response.status_code == 400
    assert ScoringWeights.objects.count() == 0


def test_a_rejected_save_keeps_the_earlier_weights():
    client = signed_in()
    put(client, {"water": 0.9})

    put(client, {"water": -1})

    assert client.get(URL).json()["weights"]["water"] == 0.9


# --- one user cannot reach another's ---------------------------------------------------


def test_users_only_ever_see_and_change_their_own_weights():
    rania, omar = signed_in("rania"), signed_in("omar")
    put(rania, {"water": 0.9})

    assert omar.get(URL).json()["custom"] is False
    put(omar, {"water": 0.1})
    omar.delete(URL)

    assert rania.get(URL).json()["weights"]["water"] == 0.9
    owners = list(ScoringWeights.objects.values_list("user__username", flat=True))
    assert owners == ["rania"]


def test_deleting_an_account_deletes_its_weights():
    client = signed_in()
    put(client, {"water": 0.9})

    client.delete("/api/auth/me/")

    assert ScoringWeights.objects.count() == 0


# --- scores use them --------------------------------------------------------------------


@pytest.fixture
def scored(network):
    surroundings()
    enrich(campsite())
    network.open = False


def breakdown_weights(body):
    return {entry["key"]: entry["weight"] for entry in body["score_breakdown"]["factors"]}


def map_score(client):
    response = client.get(f"/api/campsites/?bbox={BBOX}")
    return response.json()["features"][0]["properties"]["score"]


def test_signed_out_scores_use_the_defaults(scored):
    body = APIClient().get("/api/campsites/node/1/detail/").json()

    assert breakdown_weights(body) == defaults()
    assert body["score_breakdown"]["config_digest"] == load().digest


def test_signed_in_scores_use_the_users_weights_on_panel_and_map(scored, network):
    client = signed_in()
    weights = {key: 0.0 for key in defaults()} | {"trail": 1.0}
    put(client, weights)

    body = client.get("/api/campsites/node/1/detail/").json()

    assert breakdown_weights(body) == weights
    assert body["score_breakdown"]["config_digest"] != load().digest
    trail = next(f for f in body["score_breakdown"]["factors"] if f["key"] == "trail")
    assert trail["effective_weight"] == 1
    assert map_score(client) == body["score"]
    map_data = client.get(f"/api/map-data/?bbox={BBOX}&layers=campsites").json()
    assert map_data["layers"]["campsites"]["features"][0]["properties"]["score"] == body["score"]
    assert network.calls == []


def test_one_users_weights_do_not_change_anyone_elses_scores(scored):
    put(signed_in("rania"), {key: 0.0 for key in defaults()} | {"trail": 1.0})

    omar = signed_in("omar")

    assert breakdown_weights(omar.get("/api/campsites/node/1/detail/").json()) == defaults()
    assert map_score(omar) == map_score(APIClient())


def test_an_invalid_token_on_a_public_endpoint_scores_with_the_defaults(scored):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Token not-a-real-token")

    response = client.get("/api/campsites/node/1/detail/")

    assert response.status_code == 200
    assert breakdown_weights(response.json()) == defaults()
    assert client.get(f"/api/campsites/?bbox={BBOX}").status_code == 200


def test_weights_for_a_factor_since_removed_are_ignored(scored):
    client = signed_in()
    put(client, {"water": 0.9})
    row = ScoringWeights.objects.get()
    row.weights = {**row.weights, "retired_factor": 5}
    row.save()

    body = client.get("/api/campsites/node/1/detail/").json()

    assert set(breakdown_weights(body)) == set(defaults())
    assert breakdown_weights(body)["water"] == 0.9
    assert client.get(URL).json()["weights"] == {**defaults(), "water": 0.9}
