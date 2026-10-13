"""
Token authentication for public endpoints that personalise when signed in (TM05-46).

The scoring endpoints answer everyone, and score with a user's own weights when the
request carries their token. A missing, stale or malformed token there means "signed out",
not 401: a map should never stop loading because a token was revoked in another tab.
Endpoints that require an account keep DRF's TokenAuthentication, which does 401.
"""

from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed


class OptionalTokenAuthentication(TokenAuthentication):
    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except AuthenticationFailed:
            return None
