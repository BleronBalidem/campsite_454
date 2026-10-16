/**
 * What a trail-mode hike keeps of the trail panel's trail (TM05-111): its line, profile,
 * and the places to camp along it -- the mapped campsites, plus any potential spots the
 * hiker has already searched for. Pure, so node --test checks it.
 */

import type { LngLat } from "../trails/geometry.ts";
import type { CampsiteAlong, RouteDetail } from "../trails/api.ts";
import type { Candidate } from "../trails/candidates.ts";
import { campsiteName, isAlong } from "../trails/format.ts";
import type { TrailSnapshot } from "./progress.ts";

export function trailSnapshot(
  detail: Pick<RouteDetail, "source_id" | "name" | "osm_id" | "assembly" | "line" | "profile"> & {
    campsites: { items: CampsiteAlong[] };
  },
  candidates: readonly Candidate[] = [],
): TrailSnapshot {
  const profile =
    detail.profile.status === "ok"
      ? { distances: detail.profile.distance_m, elevations: detail.profile.elevation_m }
      : null;
  return {
    key: detail.source_id,
    name: detail.name,
    osmId: detail.osm_id,
    fromWay: detail.osm_id === null ? (detail.assembly?.from_way ?? null) : null,
    coords: detail.line.coordinates as LngLat[],
    profile,
    stops: [
      ...detail.campsites.items.filter(isAlong).map((site) => ({
        id: site.id,
        label: campsiteName(site).text,
        kind: "campsite" as const,
        alongM: site.distance_along_m,
      })),
      ...candidates.map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        kind: "candidate" as const,
        alongM: candidate.distance_along_m,
      })),
    ],
  };
}
