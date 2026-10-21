/**
 * The signed-in user's factor weights (TM05-46, shown by TM05-115). Contract: docs/api.md,
 * "Scoring weights".
 *
 * Saving or resetting clears the map-data cache, so the next campsite the map draws or
 * opens is scored with the new weights rather than a response cached under the old ones.
 */

import { API_BASE_URL, clearMapDataCache } from "../api";
import { authHeaders, type Session } from "../auth";
import { toRequest, type Sliders, type WeightsPayload } from "./weights";

export class WeightsError extends Error {}

const PATH = "/api/auth/me/weights/";

async function request(session: Session, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${PATH}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...authHeaders(session) },
    });
  } catch {
    throw new WeightsError(`Could not reach the API at ${API_BASE_URL}.`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new WeightsError(body?.error ?? `HTTP ${response.status}`);
  }
  return response;
}

export async function loadWeights(session: Session): Promise<WeightsPayload> {
  return (await (await request(session)).json()) as WeightsPayload;
}

export async function saveWeights(session: Session, sliders: Sliders): Promise<WeightsPayload> {
  const response = await request(session, { method: "PUT", body: JSON.stringify(toRequest(sliders)) });
  clearMapDataCache();
  return (await response.json()) as WeightsPayload;
}

/** Forget the saved weights; scores go back to the shipped defaults. */
export async function resetWeights(session: Session): Promise<void> {
  await request(session, { method: "DELETE" });
  clearMapDataCache();
}
