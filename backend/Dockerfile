# CampSite backend image (TM05-113). Build from the repo root:
#   docker build -f backend/Dockerfile -t campsite-backend .
# GDAL/GEOS come from the distribution's packages, the same recipe as CI
# (.github/workflows/ci.yml). Debian bookworm's GDAL 3.6 is in the range Django 5.1 probes
# for by name, so GDAL_LIBRARY_PATH and GEOS_LIBRARY_PATH stay unset.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      binutils libproj-dev gdal-bin libgdal-dev libgeos-dev \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

WORKDIR /app
COPY backend/ /app/

RUN useradd --create-home --uid 1000 app && chown -R app /app
USER app

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
