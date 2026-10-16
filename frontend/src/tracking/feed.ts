/**
 * Where positions come from while a hike is recorded (TM05-111). The tracker takes a feed
 * and never asks which kind it is: real GPS here, the simulated walk in simulate.ts. Both
 * deliver Fix objects to the same handler, which is what makes the simulation a test of
 * the real code path rather than of a copy of it.
 *
 * A feed also owns the clock the hike is timed by: the wall clock for GPS, the simulated
 * clock (running 1x, 10x or 60x) for a simulation.
 */

import type { Fix } from "./track";

export interface PositionFeed {
  readonly simulated: boolean;
  /** The feed's own time, unix ms. */
  now(): number;
  start(onFix: (fix: Fix) => void, onError: (message: string, fatal: boolean) => void): void;
  stop(): void;
}

/** navigator.geolocation.watchPosition with high accuracy, no cached fixes. */
export function gpsFeed(): PositionFeed {
  let watch: number | null = null;
  return {
    simulated: false,
    now: () => Date.now(),
    start(onFix, onError) {
      if (watch !== null) return;
      if (!("geolocation" in navigator)) {
        onError("Location isn't available here (it needs HTTPS).", true);
        return;
      }
      watch = navigator.geolocation.watchPosition(
        ({ coords, timestamp }) =>
          onFix({ lon: coords.longitude, lat: coords.latitude, accuracyM: coords.accuracy, t: timestamp || Date.now() }),
        (error) =>
          error.code === 1
            ? onError("Location is blocked for this site. Allow it in the browser's settings.", true)
            : onError("Waiting for a GPS fix…", false),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    },
    stop() {
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      watch = null;
    },
  };
}
