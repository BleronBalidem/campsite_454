from django.conf import settings
from django.db import models

from geodata.models import Campsite


class SavedCampsite(models.Model):
    """A user bookmarking a campsite. Foundation for trip planning later."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_campsites",
    )
    campsite = models.ForeignKey(
        Campsite,
        on_delete=models.CASCADE,
        related_name="saved_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "campsite"], name="unique_saved_campsite")
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} saved {self.campsite}"


class ScoringWeights(models.Model):
    """A user's own factor weights (TM05-46), keyed by factor as in scoring/config.yml.

    Only the weights: curves and caps stay the shipped config's, so a user can change what
    matters to them but not what a factor measures. Factors missing here use the default
    weight, which also covers a factor added after the user saved.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="scoring_weights",
    )
    weights = models.JSONField()
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"scoring weights for {self.user}"
