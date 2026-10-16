/**
 * Elevation while tracking (TM05-111): smoothing the DEM samples along the walked track,
 * and the climb so far. Pure, so node --test checks it.
 *
 * The samples come from the terrain model at each recorded position (dem.ts), not from
 * the phone's GPS altitude; docs/tracking.md says why. They still carry noise: a
 * position that wanders a few metres across a slope reads a different height each time.
 * So, as for the trail profile (docs/elevation.md):
 *
 *   1. a trailing mean over the last `windowM` of track (trailing, not centred, because
 *      the display can only use what has already been walked), then
 *   2. a climb counts only once the smoothed height has risen `thresholdM` above the
 *      last counted point; a fall of the same size resets the reference.
 */

export interface ElevationSample {
  /** Metres along the walked track. */
  alongM: number;
  elevationM: number;
}

/** Each sample replaced by the mean of the samples in the `windowM` of track before it. */
export function trailingMean(samples: readonly ElevationSample[], windowM: number): number[] {
  const out: number[] = [];
  let lo = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i].elevationM;
    while (samples[i].alongM - samples[lo].alongM > windowM) {
      sum -= samples[lo].elevationM;
      lo++;
    }
    out.push(sum / (i - lo + 1));
  }
  return out;
}

/** Total climb, counting a rise only once it exceeds `thresholdM` from the reference. */
export function thresholdGain(values: readonly number[], thresholdM: number): number {
  if (values.length === 0) return 0;
  let gain = 0;
  let reference = values[0];
  for (const value of values) {
    const change = value - reference;
    if (change >= thresholdM) {
      gain += change;
      reference = value;
    } else if (change <= -thresholdM) {
      reference = value;
    }
  }
  return gain;
}

/** The naive sum of every rise: what thresholdGain improves on. */
export function naiveGain(values: readonly number[]): number {
  let gain = 0;
  for (let i = 1; i < values.length; i++) gain += Math.max(0, values[i] - values[i - 1]);
  return gain;
}

export function elevationSoFar(
  samples: readonly ElevationSample[],
  windowM: number,
  thresholdM: number,
): { currentM: number | null; gainM: number } {
  const smoothed = trailingMean(samples, windowM);
  return {
    currentM: smoothed.length ? smoothed[smoothed.length - 1] : null,
    gainM: thresholdGain(smoothed, thresholdM),
  };
}
