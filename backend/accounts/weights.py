"""
Per-user factor weights (TM05-46): validating them, and the scoring config a request
scores with.

Validation goes through scoring.config.parse(), the same check the shipped config.yml
passes, so a user's weights can never be something the engine would refuse. On top of it:
every key must be a known factor, every value a finite number, and at least one weight
above zero -- with all weights zero there is nothing to combine.

A signed-out request, or a user who never saved weights, scores with the shipped config
(`config_for()` returns None and the engine loads it). The weights change only the
combine: stored factor results (scoring/stored.py) are reused as they are, and the result's
`config_digest` changes, so a score made with custom weights is never mistaken for a
default one.
"""

from __future__ import annotations

import math

from scoring.config import ScoringConfig, ScoringConfigError, load, parse

from .models import ScoringWeights


class InvalidWeights(ValueError):
    """Weights a user submitted that cannot be scored with."""


def defaults() -> dict[str, float]:
    return dict(load().weights)


def _config(weights: dict) -> ScoringConfig:
    shipped = load()
    return parse(
        {"model_version": shipped.model_version, "weights": weights, "factors": shipped.factors},
        "weights",
    )


def validate(data) -> dict[str, float]:
    """The complete weights a submission describes: defaults overlaid with the submitted
    ones. Raises InvalidWeights with a reason a person can act on."""
    known = defaults()
    if not isinstance(data, dict) or not data:
        raise InvalidWeights(
            "weights must be an object of factor to number, e.g. "
            '{"water": 0.5, "slope": 0.2}. Factors: ' + ", ".join(known)
        )
    unknown = sorted(set(data) - set(known))
    if unknown:
        raise InvalidWeights(
            f"unknown factor(s): {', '.join(unknown)}. Factors: {', '.join(known)}"
        )
    for key, value in data.items():
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise InvalidWeights(f"weight for {key!r} must be a number, not {value!r}")
        if not math.isfinite(value):
            raise InvalidWeights(f"weight for {key!r} must be a finite number")
    merged = {**known, **data}
    try:
        config = _config(merged)
    except ScoringConfigError as error:
        raise InvalidWeights(str(error).removeprefix("weights: ")) from error
    if not any(weight > 0 for weight in config.weights.values()):
        raise InvalidWeights("at least one weight must be above 0")
    return config.weights


def saved(user) -> dict[str, float] | None:
    """The user's complete weights, or None when they have none (or are signed out)."""
    if not user.is_authenticated:
        return None
    row = ScoringWeights.objects.filter(user=user).first()
    if row is None:
        return None
    known = defaults()
    weights = {key: float(row.weights.get(key, default)) for key, default in known.items()}
    # Stored weights that a later config change made unusable fall back to the defaults.
    return weights if any(weight > 0 for weight in weights.values()) else None


def config_for(user) -> ScoringConfig | None:
    """The scoring config for this user's requests: None means the shipped default."""
    weights = saved(user)
    return None if weights is None else _config(weights)
