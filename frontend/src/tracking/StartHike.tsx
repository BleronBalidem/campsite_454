/**
 * Starting a hike (TM05-111): "Start hike" in the trail panel (trail mode), and "Track" on
 * the map (free mode, anywhere, no trail). In a dev build or with ?demo=1 (demo.ts), each
 * also offers the simulated walk.
 */

import { useState } from "react";
import { SPEEDS, type SimSpeed } from "./simulate";

interface StartProps {
  /** A hike is already being recorded: there is one at a time. */
  busy: boolean;
  onStart: () => void;
  /** Offered only when simulation is allowed. */
  onSimulate?: (speed: SimSpeed) => void;
}

export function StartHike({ busy, onStart, onSimulate }: StartProps) {
  const [speed, setSpeed] = useState<SimSpeed>(60);
  return (
    <div className="hike-start">
      <button type="button" className="button-primary" disabled={busy} onClick={onStart}>
        Start hike
      </button>
      {onSimulate && (
        <span className="hike-simulate">
          <button type="button" className="trail-3d-button" disabled={busy} onClick={() => onSimulate(speed)}>
            Simulate walk
          </button>
          <select
            aria-label="Simulation speed"
            value={speed}
            disabled={busy}
            onChange={(event) => setSpeed(Number(event.target.value) as SimSpeed)}
          >
            {SPEEDS.map((option) => (
              <option key={option} value={option}>
                {option}×
              </option>
            ))}
          </select>
        </span>
      )}
      <span className="trail-3d-hint">
        {busy ? "A hike is already being recorded." : "Records your walk along this trail, on this device."}
      </span>
    </div>
  );
}

export function TrackButton({ busy, onStart, onSimulate }: StartProps) {
  if (busy) return null;
  return (
    <>
      <button type="button" className="live-button" title="Record a walk anywhere, no trail needed" onClick={onStart}>
        <span aria-hidden="true">●</span>
        <span className="live-label">Track</span>
      </button>
      {onSimulate && (
        <button
          type="button"
          className="live-button"
          title="Simulate a short loop around the map centre, at 10×"
          onClick={() => onSimulate(10)}
        >
          <span className="live-label">Simulate</span>
        </button>
      )}
    </>
  );
}
