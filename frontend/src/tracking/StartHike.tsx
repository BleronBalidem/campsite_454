/**
 * Starting a hike (TM05-111): "Start hike" in the trail panel (trail mode), and "Track" on
 * the map (free mode, anywhere, no trail).
 */

interface StartProps {
  /** A hike is already being recorded: there is one at a time. */
  busy: boolean;
  onStart: () => void;
}

export function StartHike({ busy, onStart }: StartProps) {
  return (
    <div className="hike-start">
      <button type="button" className="button-primary" disabled={busy} onClick={onStart}>
        Start hike
      </button>
      <span className="trail-3d-hint">
        {busy ? "A hike is already being recorded." : "Records your walk along this trail, on this device."}
      </span>
    </div>
  );
}

export function TrackButton({ busy, onStart }: StartProps) {
  if (busy) return null;
  return (
    <button type="button" className="live-button" title="Record a walk anywhere, no trail needed" onClick={onStart}>
      <span aria-hidden="true">●</span>
      <span className="live-label">Track</span>
    </button>
  );
}
