/**
 * A hike being recorded (TM05-111): the state, how each fix changes it, and the numbers
 * the display shows. Pure -- plain data in, plain data out, no clock and no browser -- so
 * node --test drives it with synthetic fixes, the recording can sit in IndexedDB as it is,
 * and real GPS and the simulated walk go through exactly this code.
 *
 *   elapsed    wall time since Start, less paused time
 *   moving     elapsed less every stop: staying within stopRadiusM for stopMinMs or more
 *   distance   the walked track, grown only in steps of distanceStepM so GPS jitter at a
 *              standstill does not count as walking, and never by a jump faster than
 *              maxSpeedMps (a glitch, or a lift in a car)
 *   pace       moving time per mile
 *   elevation  the terrain model's height at each point, smoothed (elevation.ts)
 *
 * The track is kept in segments. Pausing, and the page being hidden while running (a phone
 * screen turned off), each start a new one, so the map and the GPX file show a gap rather
 * than a straight line across time nobody recorded. A hidden stretch still counts towards
 * distance and moving time -- the hiker kept walking -- but a paused one does not.
 */

import { haversineM } from "../trails/geometry.ts";
import { TRACKING, type TrackingConfig } from "./config.ts";
import { elevationSoFar, type ElevationSample } from "./elevation.ts";
import type { TrailSnapshot } from "./progress.ts";

/** A position from the feed: real GPS or the simulated walk. `t` is unix ms. */
export interface Fix {
  lon: number;
  lat: number;
  accuracyM: number;
  t: number;
}

export interface TrackPoint {
  lon: number;
  lat: number;
  /** Metres, from the terrain model; null where it could not be sampled. */
  ele: number | null;
  t: number;
}

/** What began a segment: Start, Resume after a pause, or a gap while running. */
export type SegmentKind = "start" | "resume" | "gap";

export interface Segment {
  kind: SegmentKind;
  points: TrackPoint[];
}

export type HikeMode = "trail" | "free";

/** A simulated walk's settings (simulate.ts), kept so a reload can carry it on. */
export interface SimulationSettings {
  kind: "trail" | "loop";
  speed: number;
  /** The loop's centre, for a free-mode simulation. */
  center: [number, number] | null;
}
export type HikeStatus = "running" | "paused" | "stopped";

export interface Recording {
  id: string;
  /** Who started it (the signed-in username), or null when signed out. */
  owner: string | null;
  mode: HikeMode;
  simulated: boolean;
  simulation: SimulationSettings | null;
  /** Trail mode: the trail as it was when the hike started, so a reload needs no fetch. */
  trail: TrailSnapshot | null;
  /** Trail mode: 1 when walking the trail start to end, -1 end to start; null until the
   * first fix decides it. */
  direction: 1 | -1 | null;
  status: HikeStatus;
  startedAt: number;
  /** Running time in closed intervals; the open one runs from runningSince. */
  activeMs: number;
  runningSince: number | null;
  endedAt: number | null;
  segments: Segment[];
  /** Set when the next kept fix should open a new segment. */
  pendingSegment: SegmentKind | null;
  /** The latest accepted fix, kept or not: where the dot is. */
  last: TrackPoint | null;
  lastAccuracyM: number | null;
  /** Fixes ignored for poor accuracy. */
  dropped: number;
}

export function startRecording(options: {
  id: string;
  owner: string | null;
  mode: HikeMode;
  simulated: boolean;
  simulation?: SimulationSettings | null;
  trail: TrailSnapshot | null;
  now: number;
}): Recording {
  return {
    ...options,
    simulation: options.simulation ?? null,
    trail: options.mode === "trail" ? options.trail : null,
    direction: null,
    status: "running",
    startedAt: options.now,
    activeMs: 0,
    runningSince: options.now,
    endedAt: null,
    segments: [],
    pendingSegment: "start",
    last: null,
    lastAccuracyM: null,
    dropped: 0,
  };
}

/** A fix from the feed. Ignored unless running; dropped if its accuracy is too poor. */
export function addFix(
  recording: Recording,
  fix: Fix,
  ele: number | null,
  config: TrackingConfig = TRACKING,
): Recording {
  if (recording.status !== "running") return recording;
  if (!(fix.accuracyM <= config.maxAccuracyM)) {
    return { ...recording, dropped: recording.dropped + 1 };
  }
  const point: TrackPoint = { lon: fix.lon, lat: fix.lat, ele, t: fix.t };
  const next = { ...recording, last: point, lastAccuracyM: fix.accuracyM };
  if (recording.pendingSegment) {
    return {
      ...next,
      pendingSegment: null,
      segments: [...recording.segments, { kind: recording.pendingSegment, points: [point] }],
    };
  }
  const segment = recording.segments[recording.segments.length - 1];
  const previous = segment.points[segment.points.length - 1];
  if (fix.t < previous.t) return recording; // out of order: keep the track's times rising
  const keep =
    haversineM([previous.lon, previous.lat], [point.lon, point.lat]) >= config.recordStepM ||
    point.t - previous.t >= config.recordEveryMs;
  if (!keep) return next;
  const segments = recording.segments.slice(0, -1);
  segments.push({ ...segment, points: [...segment.points, point] });
  return { ...next, segments };
}

/** The page was hidden (or reloaded) while running: the next fix starts a gap segment. */
export function markGap(recording: Recording): Recording {
  if (recording.status !== "running" || recording.pendingSegment) return recording;
  return { ...recording, pendingSegment: "gap" };
}

export function pause(recording: Recording, now: number): Recording {
  if (recording.status !== "running") return recording;
  return {
    ...keepLast(recording),
    status: "paused",
    activeMs: recording.activeMs + Math.max(0, now - (recording.runningSince ?? now)),
    runningSince: null,
    pendingSegment: "resume",
  };
}

export function resume(recording: Recording, now: number): Recording {
  if (recording.status !== "paused") return recording;
  return { ...recording, status: "running", runningSince: now };
}

export function stop(recording: Recording, now: number): Recording {
  if (recording.status === "stopped") return recording;
  const closed = recording.status === "running" ? pause(recording, now) : recording;
  return { ...closed, status: "stopped", endedAt: now, pendingSegment: null };
}

/** The latest fix added to the track if it was not kept, so it ends where the hiker is. */
function keepLast(recording: Recording): Recording {
  const { last, segments } = recording;
  const segment = segments[segments.length - 1];
  if (!last || !segment || recording.pendingSegment) return recording;
  const tail = segment.points[segment.points.length - 1];
  if (tail.t >= last.t) return recording;
  return { ...recording, segments: [...segments.slice(0, -1), { ...segment, points: [...segment.points, last] }] };
}

export function setDirection(recording: Recording, direction: 1 | -1): Recording {
  return recording.direction === null ? { ...recording, direction } : recording;
}

// --- the numbers ----------------------------------------------------------------------

export function elapsedMs(recording: Recording, now: number): number {
  const open = recording.runningSince !== null ? Math.max(0, now - recording.runningSince) : 0;
  return recording.activeMs + open;
}

function metres(a: TrackPoint, b: TrackPoint): number {
  return haversineM([a.lon, a.lat], [b.lon, b.lat]);
}

/** Walked distance, and the elevation samples placed along it. */
export function walked(
  recording: Recording,
  config: TrackingConfig = TRACKING,
): { distanceM: number; samples: ElevationSample[] } {
  let distanceM = 0;
  let anchor: TrackPoint | null = null;
  const samples: ElevationSample[] = [];
  for (const segment of recording.segments) {
    for (let index = 0; index < segment.points.length; index++) {
      const point = segment.points[index];
      // After a pause the walk restarts where the hiker now is; across a hidden stretch
      // they kept walking, so the straight line between is the least they covered.
      if (index === 0 && segment.kind !== "gap") anchor = null;
      if (anchor === null) {
        anchor = point;
      } else {
        const step = metres(anchor, point);
        if (step >= config.distanceStepM) {
          const seconds = (point.t - anchor.t) / 1000;
          if (step <= config.maxSpeedMps * seconds) distanceM += step;
          anchor = point;
        }
      }
      if (point.ele !== null) samples.push({ alongM: distanceM, elevationM: point.ele });
    }
  }
  return { distanceM, samples };
}

export interface Stop {
  from: number;
  to: number;
}

/**
 * Moving time and the stops taken out of it. A stop is a stretch that stays within
 * stopRadiusM of where it began for stopMinMs or longer; time between segments counts
 * only across a hidden stretch while running, never across a pause.
 */
export function moving(
  recording: Recording,
  now: number,
  config: TrackingConfig = TRACKING,
): { movingMs: number; stops: Stop[]; stoppedNow: boolean } {
  let movingMs = 0;
  const stops: Stop[] = [];
  let anchor: TrackPoint | null = null;
  let previous: TrackPoint | null = null;

  const close = (end: number) => {
    if (!anchor) return;
    const span = end - anchor.t;
    if (span >= config.stopMinMs) stops.push({ from: anchor.t, to: end });
    else movingMs += Math.max(0, span);
  };

  for (const segment of recording.segments) {
    for (let index = 0; index < segment.points.length; index++) {
      const point = segment.points[index];
      if (index === 0 && segment.kind !== "gap") {
        if (previous) close(previous.t);
        anchor = point;
      } else if (anchor && previous && metres(anchor, point) > config.stopRadiusM) {
        close(previous.t);
        movingMs += point.t - previous.t;
        anchor = point;
      }
      previous = point;
    }
  }
  let stoppedNow = false;
  if (anchor && previous) {
    const end = recording.status === "running" ? Math.max(now, previous.t) : previous.t;
    stoppedNow = recording.status === "running" && end - anchor.t >= config.stopMinMs;
    close(end);
  }
  return { movingMs, stops, stoppedNow };
}

const M_PER_MI = 1609.344;

export interface HikeStats {
  elapsedMs: number;
  movingMs: number;
  distanceM: number;
  /** Moving minutes per mile; null until there is enough distance to say. */
  paceMinPerMi: number | null;
  elevationM: number | null;
  gainM: number;
  stops: number;
  stoppedNow: boolean;
}

export function hikeStats(recording: Recording, now: number, config: TrackingConfig = TRACKING): HikeStats {
  const elapsed = elapsedMs(recording, now);
  const { distanceM, samples } = walked(recording, config);
  const motion = moving(recording, now, config);
  const movingMs = Math.min(motion.movingMs, elapsed);
  const { currentM, gainM } = elevationSoFar(samples, config.elevationWindowM, config.elevationThresholdM);
  return {
    elapsedMs: elapsed,
    movingMs,
    distanceM,
    paceMinPerMi: distanceM >= 50 && movingMs > 0 ? movingMs / 60_000 / (distanceM / M_PER_MI) : null,
    elevationM: currentM,
    gainM,
    stops: motion.stops.length,
    stoppedNow: motion.stoppedNow,
  };
}

/** Every recorded point, for drawing: one line per segment. */
export function trackLines(recording: Recording): [number, number][][] {
  return recording.segments.map((segment) => segment.points.map((p) => [p.lon, p.lat] as [number, number]));
}

/** The body POST /api/hikes/ takes (docs/api.md, "Recorded hikes"). */
export function saveBody(recording: Recording, stats: HikeStats, name: string) {
  return {
    name,
    mode: recording.mode,
    simulated: recording.simulated,
    osm_id: recording.trail?.osmId ?? null,
    from_way: recording.trail?.fromWay ?? null,
    trail_name: recording.trail?.name ?? null,
    elapsed_s: Math.round(stats.elapsedMs / 1000),
    moving_s: Math.round(stats.movingMs / 1000),
    distance_m: Math.round(stats.distanceM * 10) / 10,
    gain_m: Math.round(stats.gainM * 10) / 10,
    track: recording.segments.map((segment) =>
      segment.points.map((p) => [
        Math.round(p.lon * 1e6) / 1e6,
        Math.round(p.lat * 1e6) / 1e6,
        p.ele === null ? null : Math.round(p.ele * 10) / 10,
        Math.round(p.t),
      ]),
    ),
  };
}
