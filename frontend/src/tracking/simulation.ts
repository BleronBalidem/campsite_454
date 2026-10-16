/**
 * Making the simulated feed for a hike (TM05-111): a fresh walk, or -- after a reload --
 * the same walk picked up where the recording left off, on the same clock.
 */

import { locate } from "../trails/geometry";
import { trailLine } from "./progress";
import { loopAlong, loopWalk, simulatedFeed, trailWalk, type SimSpeed, type SimulatedFeed } from "./simulate";
import type { Recording } from "./track";

export function simulationFeed(recording: Recording, speed: SimSpeed): SimulatedFeed | null {
  const settings = recording.simulation;
  if (!settings) return null;
  const plan =
    settings.kind === "trail" && recording.trail
      ? trailWalk(trailLine(recording.trail))
      : settings.center
        ? loopWalk(settings.center)
        : null;
  if (!plan) return null;
  const last = recording.last;
  if (!last) return simulatedFeed({ plan, speed, t0: Date.now() });
  const along =
    settings.kind === "trail" && recording.trail
      ? locate(trailLine(recording.trail), [last.lon, last.lat])
      : loopAlong(settings.center!, [last.lon, last.lat]);
  const startS = plan.timeAt(along);
  // The simulated clock carries on from the last fix: no jump in the hike's time.
  return simulatedFeed({ plan, speed, startS, t0: last.t - startS * 1000 });
}
