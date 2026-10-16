"""
Recorded hikes (TM05-111). Contract: docs/api.md, "Recorded hikes".

    GET    /api/hikes/             the user's hikes, newest first, without their tracks
    POST   /api/hikes/             save a finished hike
    GET    /api/hikes/<id>/        one hike, with its track
    DELETE /api/hikes/<id>/        delete it
    GET    /api/hikes/<id>/gpx/    the hike as GPX, with a time on every point

Token-authenticated; every query starts from request.user, as for waypoints and plans.
The browser sends a hike once, when the hiker chooses Save: there is no endpoint that
takes a position while a hike is in progress.
"""

from datetime import UTC, datetime

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.routes import gpx_response

from .hikes import HikeError, clean_track, hike_gpx, track_geometry
from .models import Hike

MAX_HIKES_PER_USER = 500
NAME_MAX = Hike._meta.get_field("name").max_length
#: Upper bounds that no walk reaches: a week, and 1,000 km.
MAX_SECONDS = 7 * 24 * 3600
MAX_METRES = 1_000_000


def _summary(hike: Hike) -> dict:
    return {
        "id": hike.id,
        "name": hike.name,
        "mode": hike.mode,
        "simulated": hike.simulated,
        "osm_id": hike.osm_id,
        "from_way": hike.from_way or None,
        "trail_name": hike.trail_name or None,
        "started_at": hike.started_at,
        "ended_at": hike.ended_at,
        "elapsed_s": round(hike.elapsed_s),
        "moving_s": round(hike.moving_s),
        "distance_m": round(hike.distance_m, 1),
        "gain_m": round(hike.gain_m, 1),
        "created_at": hike.created_at,
    }


def _measure(data, field: str, high: float) -> float:
    value = data.get(field)
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= high:
        raise HikeError(f"{field} must be a number from 0 to {high:,}.")
    return float(value)


def _hike_from(request) -> Hike:
    data = request.data
    if not isinstance(data, dict):
        raise HikeError("Send the hike as a JSON object.")
    track = clean_track(data.get("track"))
    mode = data.get("mode")
    if mode not in Hike.Mode.values:
        raise HikeError("mode must be 'trail' or 'free'.")
    name = str(data.get("name") or "").strip()[:NAME_MAX] or "Hike"
    osm_id = data.get("osm_id")
    if osm_id is not None and (isinstance(osm_id, bool) or not isinstance(osm_id, int)):
        raise HikeError("osm_id must be a number.")
    elapsed = _measure(data, "elapsed_s", MAX_SECONDS)
    moving = _measure(data, "moving_s", MAX_SECONDS)
    if moving > elapsed + 1:
        raise HikeError("moving_s cannot be more than elapsed_s.")
    return Hike(
        user=request.user,
        name=name,
        mode=mode,
        simulated=bool(data.get("simulated", False)),
        osm_id=osm_id if mode == Hike.Mode.TRAIL else None,
        from_way=str(data.get("from_way") or "")[:64] if mode == Hike.Mode.TRAIL else "",
        trail_name=str(data.get("trail_name") or "")[:255] if mode == Hike.Mode.TRAIL else "",
        # The recording's own first and last times, not whatever the body claims.
        started_at=datetime.fromtimestamp(track[0][0][3] / 1000, tz=UTC),
        ended_at=datetime.fromtimestamp(track[-1][-1][3] / 1000, tz=UTC),
        elapsed_s=elapsed,
        moving_s=moving,
        distance_m=_measure(data, "distance_m", MAX_METRES),
        gain_m=_measure(data, "gain_m", MAX_METRES),
        track=track,
        geom=track_geometry(track),
    )


@api_view(["GET", "POST"])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def hikes_view(request):
    mine = Hike.objects.filter(user=request.user).defer("track", "geom")
    if request.method == "GET":
        return Response([_summary(hike) for hike in mine])

    if mine.count() >= MAX_HIKES_PER_USER:
        return Response(
            {"error": f"You can keep up to {MAX_HIKES_PER_USER} hikes. Delete one first."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        hike = _hike_from(request)
    except HikeError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)
    hike.save()
    return Response({**_summary(hike), "track": hike.track}, status=status.HTTP_201_CREATED)


@api_view(["GET", "DELETE"])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def hike_view(request, pk: int):
    hike = get_object_or_404(Hike, pk=pk, user=request.user)
    if request.method == "DELETE":
        hike.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response({**_summary(hike), "track": hike.track})


@api_view(["GET"])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def hike_gpx_view(request, pk: int):
    hike = get_object_or_404(Hike, pk=pk, user=request.user)
    desc = f"Recorded with CampSite{' (simulated walk)' if hike.simulated else ''}"
    if hike.trail_name:
        desc += f" on {hike.trail_name}"
    return gpx_response(hike.name, hike_gpx(hike.name, hike.track, desc=desc + "."))
