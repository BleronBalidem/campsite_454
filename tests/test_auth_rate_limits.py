"""
Tests for the rate limits on login and register (TM05-88).

The throttle's clock is replaced with one the test moves by hand, so "the window resets"
is tested without sleeping. The limits are read from settings, the same place the views
take them from.
"""

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle

pytestmark = [pytest.mark.django_db, pytest.mark.integration]

LOGIN = "/api/auth/login/"
REGISTER = "/api/auth/register/"
RATES = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


def limit(scope):
    # ScopedRateThrottle, because it can be built without a scope; parse_rate is DRF's own.
    return ScopedRateThrottle().parse_rate(RATES[scope])


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    stub = Clock()
    monkeypatch.setattr(SimpleRateThrottle, "timer", lambda self: stub.now)
    return stub


@pytest.fixture
def user():
    return get_user_model().objects.create_user("rania", "rania@example.com", "pw-x9!")


def client_at(ip="203.0.113.7"):
    return APIClient(REMOTE_ADDR=ip)


def wrong_login(client):
    return client.post(LOGIN, {"username": "rania", "password": "wrong"}, format="json")


def right_login(client):
    return client.post(LOGIN, {"username": "rania", "password": "pw-x9!"}, format="json")


def register(client, n):
    return client.post(
        REGISTER,
        {"username": f"user{n}", "email": f"user{n}@example.com", "password": "a-Strong-passw0rd!"},
        format="json",
    )


def exhaust_login(client):
    count, _ = limit("auth-login")
    for _ in range(count):
        assert wrong_login(client).status_code == 401


# --- the limits live in settings ------------------------------------------------------


def test_both_limits_are_set_in_settings():
    assert set(RATES) >= {"auth-login", "auth-register"}
    for scope in ("auth-login", "auth-register"):
        count, period = limit(scope)
        assert count > 0 and period > 0


# --- login ----------------------------------------------------------------------------


def test_login_over_the_limit_is_429_with_a_clear_message(user):
    client = client_at()
    exhaust_login(client)

    response = wrong_login(client)

    assert response.status_code == 429
    body = response.json()
    assert body["error"].startswith("Too many login attempts from this address.")
    assert "Try again in" in body["error"]
    assert 0 < body["retry_after_s"] <= limit("auth-login")[1]
    assert int(response["Retry-After"]) == body["retry_after_s"]


def test_the_right_password_is_refused_too_while_limited(user):
    client = client_at()
    exhaust_login(client)

    response = right_login(client)

    assert response.status_code == 429
    assert "token" not in response.json()


def test_login_works_again_once_the_window_has_passed(user, clock):
    client = client_at()
    exhaust_login(client)
    assert wrong_login(client).status_code == 429

    clock.advance(limit("auth-login")[1] + 1)

    assert right_login(client).status_code == 200


def test_the_limit_is_per_ip(user):
    exhaust_login(client_at("203.0.113.7"))

    assert wrong_login(client_at("203.0.113.7")).status_code == 429
    assert right_login(client_at("198.51.100.9")).status_code == 200


def test_a_forged_forwarded_for_header_does_not_reset_the_limit(user):
    client = client_at()
    exhaust_login(client)

    for n in range(3):
        forged = client.post(
            LOGIN,
            {"username": "rania", "password": "pw-x9!"},
            format="json",
            HTTP_X_FORWARDED_FOR=f"192.0.2.{n}",
        )
        assert forged.status_code == 429


# --- register -------------------------------------------------------------------------


def test_register_over_the_limit_is_429_with_a_clear_message():
    client = client_at()
    count, _ = limit("auth-register")
    for n in range(count):
        assert register(client, n).status_code == 201

    response = register(client, count)

    assert response.status_code == 429
    assert response.json()["error"].startswith("Too many accounts created from this address.")
    assert get_user_model().objects.count() == count


def test_register_works_again_once_the_window_has_passed(clock):
    client = client_at()
    count, period = limit("auth-register")
    for n in range(count):
        register(client, n)
    assert register(client, count).status_code == 429

    clock.advance(period + 1)

    assert register(client, count).status_code == 201


def test_login_and_register_are_counted_separately(user):
    client = client_at()
    exhaust_login(client)

    assert register(client, 0).status_code == 201


# --- everything else is unaffected ----------------------------------------------------


def test_normal_use_is_never_limited(user):
    client = client_at()
    assert register(client, 0).status_code == 201
    assert wrong_login(client).status_code == 401
    assert wrong_login(client).status_code == 401
    assert right_login(client).status_code == 200


def test_other_endpoints_are_not_limited_after_login_is(user):
    client = client_at()
    exhaust_login(client)
    client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=user).key}")

    for _ in range(limit("auth-login")[0] + 5):
        assert client.get("/api/auth/me/").status_code == 200
        assert client.get("/api/campsites/?bbox=-74.2,44.0,-73.9,44.2").status_code == 200
        assert client.get("/api/saved-campsites/").status_code == 200
