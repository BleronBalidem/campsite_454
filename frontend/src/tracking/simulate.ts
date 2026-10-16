/**
 * The simulated walk (TM05-111): fake positions for testing and demos away from the trail.
 * It is only a PositionFeed (feed.ts), so its fixes go through exactly the code real GPS
 * does -- the accuracy filter, the terrain elevation, addFix, the stats -- and nothing in
 * the tracker knows it is not real.
 *
 * A trail walk goes from the trail's start to its end at WALK_MPS, with, on purpose:
 *   - a few metres of jitter on every fix, as a phone has;
 *   - one stop of STOP_S partway, so moving time and stop detection show;
 *   - a detour of DETOUR_M off the trail and back, so the off-trail warning shows.
 * At the end it stands still. A free-mode simulation walks a loop around the map centre,
 * with a shorter stop halfway round.
 *
 * Time runs at 1x, 10x or 60x: the feed's clock is simulated time. Fixes are spaced by
 * simulated time as a phone's would be -- every second at 1x, every FIX_EVERY_S at 10x and
 * 60x (sent in a batch each real second) -- so a fast simulation still traces the trail's
 * bends and still has fixes inside the stop and the detour. The plan of the walk
 * (where it is at each simulated second) is pure; so is the feed, given a clock and a
 * timer, which is how node --test checks the miles at each speed.
 */

import { bearing, haversineM, pointAt, type LngLat, type MeasuredLine } from "../trails/geometry.ts";
import type { PositionFeed } from "./feed.ts";
import type { Fix } from "./track.ts";

export const SPEEDS = [1, 10, 60] as const;
export type SimSpeed = (typeof SPEEDS)[number];

/** About 2.9 mph: a steady hiking pace on easy ground. */
export const WALK_MPS = 1.3;
export const STOP_AT = 0.35;
export const STOP_S = 180;
export const DETOUR_AT = 0.6;
export const DETOUR_M = 150;
export const JITTER_M = 4;
export const ACCURACY_M = 6;
export const LOOP_RADIUS_M = 250;
export const LOOP_STOP_S = 90;
/** The longest simulated gap between fixes: 12 a real second at 60x. */
export const FIX_EVERY_S = 5;

const EARTH_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** A point `distanceM` from `origin` on a compass `bearingDeg`. Exact enough at trail scale. */
export function offset([lon, lat]: LngLat, bearingDeg: number, distanceM: number): LngLat {
  const north = distanceM * Math.cos(bearingDeg * RAD);
  const east = distanceM * Math.sin(bearingDeg * RAD);
  return [lon + (east / (EARTH_M * Math.cos(lat * RAD))) / RAD, lat + north / EARTH_M / RAD];
}

export interface WalkPlan {
  /** Total simulated seconds to the end of the walk. */
  durationS: number;
  /** Where the walker is at simulated second `s` (clamped to the end). */
  at(s: number): { position: LngLat; alongM: number; phase: "walking" | "stopped" | "detour" | "done" };
  /** The first simulated second at which the walker has covered `alongM` of the trail. */
  timeAt(alongM: number): number;
}

/** Start to end of a trail, with the stop and the detour. */
export function trailWalk(line: MeasuredLine, speed = WALK_MPS): WalkPlan {
  const stopAlong = line.length * STOP_AT;
  const detourAlong = line.length * DETOUR_AT;
  const tStop = stopAlong / speed;
  const tStopEnd = tStop + STOP_S;
  const tDetour = tStopEnd + (detourAlong - stopAlong) / speed;
  const tOut = tDetour + DETOUR_M / speed;
  const tBack = tOut + DETOUR_M / speed;
  const durationS = tBack + (line.length - detourAlong) / speed;
  const detourBase = pointAt(line, detourAlong);
  const ahead = pointAt(line, Math.min(line.length, detourAlong + 20));
  const side = (bearing(detourBase, ahead) + 90) % 360;

  return {
    durationS,
    at(s) {
      if (s <= tStop) return { position: pointAt(line, s * speed), alongM: s * speed, phase: "walking" };
      if (s <= tStopEnd) return { position: pointAt(line, stopAlong), alongM: stopAlong, phase: "stopped" };
      if (s <= tDetour) {
        const along = stopAlong + (s - tStopEnd) * speed;
        return { position: pointAt(line, along), alongM: along, phase: "walking" };
      }
      if (s <= tBack) {
        const out = s <= tOut ? (s - tDetour) * speed : DETOUR_M - (s - tOut) * speed;
        return { position: offset(detourBase, side, out), alongM: detourAlong, phase: "detour" };
      }
      if (s < durationS) {
        const along = detourAlong + (s - tBack) * speed;
        return { position: pointAt(line, along), alongM: along, phase: "walking" };
      }
      return { position: pointAt(line, line.length), alongM: line.length, phase: "done" };
    },
    timeAt(alongM) {
      if (alongM <= stopAlong) return alongM / speed;
      if (alongM <= detourAlong) return tStopEnd + (alongM - stopAlong) / speed;
      return Math.min(durationS, tBack + (alongM - detourAlong) / speed);
    },
  };
}

/** Once round a circle about `center`, starting due south, with a stop halfway round. */
export function loopWalk(center: LngLat, radiusM = LOOP_RADIUS_M, speed = WALK_MPS): WalkPlan {
  const lap = 2 * Math.PI * radiusM;
  const half = lap / 2 / speed;
  const durationS = lap / speed + LOOP_STOP_S;
  const place = (alongM: number): LngLat => offset(center, (180 + (alongM / lap) * 360) % 360, radiusM);
  return {
    durationS,
    at(s) {
      if (s <= half) return { position: place(s * speed), alongM: s * speed, phase: "walking" };
      if (s <= half + LOOP_STOP_S) return { position: place(lap / 2), alongM: lap / 2, phase: "stopped" };
      if (s < durationS) {
        const along = (s - LOOP_STOP_S) * speed;
        return { position: place(along), alongM: along, phase: "walking" };
      }
      return { position: place(lap), alongM: lap, phase: "done" };
    },
    timeAt(alongM) {
      return alongM <= lap / 2 ? alongM / speed : Math.min(durationS, alongM / speed + LOOP_STOP_S);
    },
  };
}

/** The same jitter for the same second every time: tests and demos are repeatable. */
export function jitter(s: number, amplitudeM = JITTER_M): { bearingDeg: number; distanceM: number } {
  const a = Math.sin(s * 12.9898) * 43758.5453;
  const b = Math.sin(s * 78.233) * 12543.1234;
  return { bearingDeg: (a - Math.floor(a)) * 360, distanceM: (b - Math.floor(b)) * amplitudeM };
}

export interface SimulatedFeed extends PositionFeed {
  speed(): SimSpeed;
  setSpeed(speed: SimSpeed): void;
  /** Simulated seconds since the walk began. */
  elapsedS(): number;
}

export interface FeedClock {
  /** Real milliseconds, monotonic. */
  real(): number;
  every(ms: number, tick: () => void): () => void;
}

const browserClock: FeedClock = {
  real: () => performance.now(),
  every: (ms, tick) => {
    const timer = window.setInterval(tick, ms);
    return () => window.clearInterval(timer);
  },
};

/**
 * Fixes along `plan`, from simulated second `startS`, at `speed`. Its clock starts at `t0`
 * (unix ms) and only runs while the feed does, so a paused simulation stays where it was.
 */
export function simulatedFeed(options: {
  plan: WalkPlan;
  speed: SimSpeed;
  t0: number;
  startS?: number;
  clock?: FeedClock;
  tickMs?: number;
}): SimulatedFeed {
  const { plan, t0, clock = browserClock, tickMs = 1000 } = options;
  let speed = options.speed;
  let simS = options.startS ?? 0; // simulated seconds at `since`
  let since: number | null = null; // real ms when the current run (or speed) began
  let cancel: (() => void) | null = null;
  let finished = false;
  let sentS: number | null = null; // the simulated second of the last fix sent

  const elapsedS = () => (since === null ? simS : simS + ((clock.real() - since) / 1000) * speed);
  const fixAt = (s: number): Fix => {
    const { position } = plan.at(s);
    const wobble = jitter(Math.round(s));
    const [lon, lat] = offset(position, wobble.bearingDeg, wobble.distanceM);
    return { lon, lat, accuracyM: ACCURACY_M, t: Math.round(t0 + s * 1000) };
  };

  return {
    simulated: true,
    now: () => Math.round(t0 + elapsedS() * 1000),
    elapsedS,
    speed: () => speed,
    setSpeed(next) {
      simS = elapsedS();
      if (since !== null) since = clock.real();
      speed = next;
    },
    start(onFix, onError) {
      if (cancel) return;
      since = clock.real();
      const emit = () => {
        const s = elapsedS();
        const step = Math.min(speed, FIX_EVERY_S);
        // The fixes due since the last batch, then one at the present moment.
        if (sentS !== null) for (let at = sentS + step; at < s - 1e-6; at += step) onFix(fixAt(at));
        onFix(fixAt(s));
        sentS = s;
        if (s >= plan.durationS && !finished) {
          finished = true;
          onError("The simulated walk has reached the end. Stop to finish.", false);
        }
      };
      emit();
      cancel = clock.every(tickMs, emit);
    },
    stop() {
      simS = elapsedS();
      since = null;
      cancel?.();
      cancel = null;
    },
  };
}

/** How far round a loop a point is, in metres from its start (due south of the centre). */
export function loopAlong(center: LngLat, point: LngLat, radiusM = LOOP_RADIUS_M): number {
  const angle = (bearing(center, point) - 180 + 360) % 360;
  return haversineM(center, point) > 0 ? (angle / 360) * 2 * Math.PI * radiusM : 0;
}
