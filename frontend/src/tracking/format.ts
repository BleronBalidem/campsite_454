/**
 * How the tracking display writes its numbers (TM05-111). Miles and feet, as the trail
 * panel does (trails/format.ts). Pure, so node --test checks it.
 */

import { duration } from "../trails/format.ts";

const M_PER_MI = 1609.344;
const FT_PER_M = 3.28084;

/** 0:04:05, 1:23:45: a running clock. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function miles2(metres: number): string {
  return `${(metres / M_PER_MI).toFixed(2)} mi`;
}

/** 24:10 /mi; a dash until there is a pace. */
export function pace(minutesPerMile: number | null): string {
  if (minutesPerMile === null || !Number.isFinite(minutesPerMile) || minutesPerMile > 999) return "–";
  const seconds = Math.round(minutesPerMile * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /mi`;
}

export function feetOrDash(metres: number | null): string {
  return metres === null ? "–" : `${Math.round(metres * FT_PER_M).toLocaleString("en-US")} ft`;
}

export function gainFeet(metres: number): string {
  return `+${Math.round(metres * FT_PER_M).toLocaleString("en-US")} ft`;
}

/** "Hike on Van Hoevenberg Trail" or "Walk, Oct 16". */
export function defaultHikeName(trailName: string | null, startedAt: number): string {
  if (trailName) return `Hike on ${trailName}`;
  const day = new Date(startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Walk, ${day}`;
}

/** "Oct 16, 2026 · 7.41 mi · 3 h 50 min · +2,850 ft", for the Profile list. */
export function hikeMeta(hike: { started_at: string; distance_m: number; elapsed_s: number; gain_m: number }): string {
  const day = new Date(hike.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = hike.elapsed_s < 3600 ? `${Math.max(1, Math.round(hike.elapsed_s / 60))} min` : duration(hike.elapsed_s / 60);
  return `${day} · ${miles2(hike.distance_m)} · ${time} · ${gainFeet(hike.gain_m)}`;
}
