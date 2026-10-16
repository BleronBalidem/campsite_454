/**
 * Hike tracking thresholds (TM05-111), in one place so each is a decision, not a magic
 * number. docs/tracking.md says why each is what it is.
 */

export interface TrackingConfig {
  /** Fixes whose reported accuracy is worse than this are dropped, not drawn. */
  maxAccuracyM: number;
  /** A new point is kept once the hiker is this far from the last one... */
  recordStepM: number;
  /** ...or this long after it, so a stop still has points to be detected from. */
  recordEveryMs: number;
  /** Distance only grows in steps of at least this much, so GPS jitter at a standstill
   * is not counted as walking. */
  distanceStepM: number;
  /** A step faster than this (a GPS glitch, or a ride) moves the track but adds no
   * distance: no one walks or runs a trail at 25 km/h. */
  maxSpeedMps: number;
  /** Staying within this radius for stopMinMs or longer is a stop, not moving time. */
  stopRadiusM: number;
  stopMinMs: number;
  /** Trail mode: farther than this from the trail is off it, and the display warns. */
  offTrailWarnM: number;
  /** Trail mode: starting farther than this from the trail says so (but still starts). */
  farFromTrailM: number;
  /** Within this of either end of the trail, "from the trailhead" rather than "the trail". */
  trailheadM: number;
  /** ETA uses the hiker's own pace once they have walked this far and this long... */
  paceMinM: number;
  paceMinMs: number;
  /** Elevation: a trailing mean over this much track, then a climb counts only once it
   * exceeds the threshold (the trail profile's own method, docs/elevation.md). */
  elevationWindowM: number;
  elevationThresholdM: number;
}

export const TRACKING: TrackingConfig = {
  maxAccuracyM: 35,
  recordStepM: 5,
  recordEveryMs: 15_000,
  distanceStepM: 10,
  maxSpeedMps: 7,
  stopRadiusM: 15,
  stopMinMs: 60_000,
  offTrailWarnM: 75,
  farFromTrailM: 400,
  trailheadM: 100,
  paceMinM: 400,
  paceMinMs: 5 * 60_000,
  elevationWindowM: 100,
  elevationThresholdM: 3,
};
