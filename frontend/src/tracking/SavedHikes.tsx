/**
 * Profile -> Hikes (TM05-111): the user's saved hikes. Each row shows the time, distance
 * and climb; opening it draws the route and offers the GPX (with a time on every point)
 * and Delete.
 */

import { useState } from "react";
import type { Session } from "../auth";
import { deleteHike, downloadHikeGpx, getHike, type HikeDetail, type HikeSummary } from "./api";
import { clock, gainFeet, hikeMeta } from "./format";
import { routeShape } from "./routeShape";

const SHAPE_W = 280;
const SHAPE_H = 160;

export function SavedHikeRow({
  hike,
  session,
  onDeleted,
}: {
  hike: HikeSummary;
  session: Session;
  onDeleted: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<HikeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setOpen((value) => !value);
    if (!detail) {
      getHike(session, hike.id)
        .then(setDetail)
        .catch((caught: Error) => setError(caught.message));
    }
  };

  return (
    <li className="profile-row profile-hike">
      <button type="button" className="profile-open" aria-expanded={open} onClick={toggle}>
        <span className="profile-title">
          {hike.name}
          {hike.simulated && <span className="hike-simulated">Simulated</span>}
        </span>
        <span className="profile-meta">{hikeMeta(hike)}</span>
      </button>
      {open && (
        <div className="profile-hike-detail">
          <dl className="hike-stats">
            <div className="hike-stat">
              <dt>Elapsed</dt>
              <dd>{clock(hike.elapsed_s * 1000)}</dd>
            </div>
            <div className="hike-stat">
              <dt>Moving</dt>
              <dd>{clock(hike.moving_s * 1000)}</dd>
            </div>
            <div className="hike-stat">
              <dt>Gain</dt>
              <dd>{gainFeet(hike.gain_m)}</dd>
            </div>
          </dl>
          {detail ? (
            <svg
              className="profile-hike-route"
              viewBox={`0 0 ${SHAPE_W} ${SHAPE_H}`}
              role="img"
              aria-label={`Route of ${hike.name}`}
            >
              {routeShape(detail.track, SHAPE_W, SHAPE_H).map((points, index) => (
                <polyline key={index} points={points} />
              ))}
            </svg>
          ) : (
            !error && <p className="profile-empty">Loading the route…</p>
          )}
          {hike.trail_name && <p className="hike-note">On {hike.trail_name}</p>}
          <div className="hike-controls">
            <button
              type="button"
              className="trail-3d-button"
              onClick={() => downloadHikeGpx(session, hike).catch((caught: Error) => setError(caught.message))}
            >
              Download GPX
            </button>
            <button
              type="button"
              className="profile-remove"
              onClick={async () => {
                if (!window.confirm(`Delete “${hike.name}”?`)) return;
                try {
                  await deleteHike(session, hike.id);
                  onDeleted(hike.id);
                } catch (caught) {
                  setError((caught as Error).message);
                }
              }}
            >
              Delete
            </button>
          </div>
          {error && <p className="hike-warn">{error}</p>}
        </div>
      )}
    </li>
  );
}
