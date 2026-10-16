/**
 * Saved hikes (TM05-111). Contract: docs/api.md, "Recorded hikes". A hike is sent once,
 * when the hiker chooses Save; nothing is sent while one is in progress.
 */

import { API_BASE_URL } from "../api";
import { authHeaders, type Session } from "../auth";
import { gpxFilename } from "../trails/gpx";

export interface HikeSummary {
  id: number;
  name: string;
  mode: "trail" | "free";
  simulated: boolean;
  osm_id: number | null;
  from_way: string | null;
  trail_name: string | null;
  started_at: string;
  ended_at: string;
  elapsed_s: number;
  moving_s: number;
  distance_m: number;
  gain_m: number;
}

export interface HikeDetail extends HikeSummary {
  track: [number, number, number | null, number][][];
}

async function request<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(session) },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? body?.detail ?? `The server answered ${response.status}.`);
  return body as T;
}

export function listHikes(session: Session) {
  return request<HikeSummary[]>(session, "/api/hikes/");
}

export function getHike(session: Session, id: number) {
  return request<HikeDetail>(session, `/api/hikes/${id}/`);
}

export function saveHike(session: Session, body: object) {
  return request<HikeDetail>(session, "/api/hikes/", { method: "POST", body: JSON.stringify(body) });
}

export function deleteHike(session: Session, id: number) {
  return request<void>(session, `/api/hikes/${id}/`, { method: "DELETE" });
}

/** The GPX needs the token header, so it is fetched and saved from a blob. */
export async function downloadHikeGpx(session: Session, hike: HikeSummary): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/hikes/${hike.id}/gpx/`, { headers: authHeaders(session) });
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = gpxFilename(hike.name);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
