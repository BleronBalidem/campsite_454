/**
 * The Profile view (TM05-100): everything a signed-in user has kept, in four tabs.
 * Replaces the floating Saved panel that sat over the map.
 *
 *   Saved campsites   names from the campsite detail endpoint (derived names included);
 *                     the list endpoint is left as it is (TM05-87)
 *   Saved trails      saved from the trail panel's "Save trail"
 *   Waypoints         TM05-80
 *   Overnight plans   TM05-81
 *   Hikes             TM05-111: recorded hikes, with their route and GPX
 *
 * Above the tabs, "Scoring preferences" (TM05-115) sets the user's factor weights.
 *
 * Clicking an item goes to the map with an open request (profile/openRequest.ts): the map
 * flies there and opens the item's panel, whatever layers are on.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { fetchCampsiteDetail } from "../campsite/api";
import { listPlans, type PlanSummary } from "../plans/api";
import { listSavedTrails, unsaveTrail, type SavedTrail } from "../plans/savedTrails";
import { nights } from "../plans/draft";
import {
  OPEN_STATE_KEY,
  campsiteRequest,
  planRequest,
  trailRequest,
  waypointRequest,
  type OpenRequest,
} from "../profile/openRequest";
import { loadSaved, unsave, type SavedCampsite } from "../saved";
import { useSession } from "../session";
import { miles } from "../trails/format";
import { listWaypoints, type Waypoint } from "../waypoints/api";
import { kindStyle } from "../waypoints/kinds";
import { listHikes, type HikeSummary } from "../tracking/api";
import { SavedHikeRow } from "../tracking/SavedHikes";
import ScoringPreferences from "../profile/ScoringPreferences";
import { showPreferences } from "../profile/weights";
import "../profile/profile.css";
import "../tracking/tracking.css";

const TABS = [
  { id: "campsites", label: "Saved campsites" },
  { id: "trails", label: "Saved trails" },
  { id: "waypoints", label: "Waypoints" },
  { id: "plans", label: "Overnight plans" },
  { id: "hikes", label: "Hikes" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type Loaded<T> = { status: "loading" } | { status: "ready"; items: T[] } | { status: "error"; message: string };

function useList<T>(load: (() => Promise<T[]>) | null): [Loaded<T>, (items: T[]) => void] {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    load()
      .then((items) => !cancelled && setState({ status: "ready", items }))
      .catch((error: Error) => !cancelled && setState({ status: "error", message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [load]);
  return [state, (items) => setState({ status: "ready", items })];
}

export default function Profile() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("campsites");

  const [loaders] = useState(() =>
    session
      ? {
          campsites: () => loadSaved(session),
          trails: () => listSavedTrails(session),
          waypoints: () => listWaypoints(session),
          plans: () => listPlans(session),
          hikes: () => listHikes(session),
        }
      : null,
  );
  const [campsites, setCampsites] = useList<SavedCampsite>(loaders?.campsites ?? null);
  const [trails, setTrails] = useList<SavedTrail>(loaders?.trails ?? null);
  const [waypoints] = useList<Waypoint>(loaders?.waypoints ?? null);
  const [plans] = useList<PlanSummary>(loaders?.plans ?? null);
  const [hikes, setHikes] = useList<HikeSummary>(loaders?.hikes ?? null);
  const names = useDisplayNames(campsites.status === "ready" ? campsites.items : []);

  if (!session) return <Navigate to="/login" replace />;

  const open = (request: OpenRequest | null) => {
    if (request) navigate("/discover", { state: { [OPEN_STATE_KEY]: request } });
  };
  const counts: Record<TabId, number | null> = {
    campsites: campsites.status === "ready" ? campsites.items.length : null,
    trails: trails.status === "ready" ? trails.items.length : null,
    waypoints: waypoints.status === "ready" ? waypoints.items.length : null,
    plans: plans.status === "ready" ? plans.items.length : null,
    hikes: hikes.status === "ready" ? hikes.items.length : null,
  };

  return (
    <main className="profile">
      <header className="profile-head">
        <h1>{session.username}</h1>
        <p>Your saved places and plans. Choose one to open it on the map.</p>
      </header>

      {showPreferences(session) && <ScoringPreferences session={session} />}

      <div className="profile-tabs" role="tablist" aria-label="Your saved things">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`panel-${entry.id}`}
            className={`profile-tab${tab === entry.id ? " is-active" : ""}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {counts[entry.id] !== null && <span className="profile-count">{counts[entry.id]}</span>}
          </button>
        ))}
      </div>

      <section
        className="profile-panel"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "campsites" && (
          <ItemList
            state={campsites}
            empty={
              <>
                No saved campsites yet. On the <Link to="/discover">map</Link>, open a campsite and
                choose <b>Save</b>.
              </>
            }
            render={(campsite) => (
              <Row
                key={campsite.id}
                title={names[campsite.id] ?? campsite.name}
                meta={campsite.id.startsWith("campsite/") ? "Recreation.gov" : "OpenStreetMap"}
                onOpen={() => open(campsiteRequest({ ...campsite, name: names[campsite.id] ?? campsite.name }))}
                onRemove={async () => {
                  if (campsites.status !== "ready") return;
                  setCampsites(await unsave(campsite.id, session, campsites.items));
                }}
                removeLabel="Unsave"
              />
            )}
          />
        )}
        {tab === "trails" && (
          <ItemList
            state={trails}
            empty={
              <>
                No saved trails yet. Open a trail on the <Link to="/discover">map</Link> and choose{" "}
                <b>Save trail</b>.
              </>
            }
            render={(trail) => (
              <Row
                key={trail.id}
                title={trail.name}
                meta={trail.length_m ? miles(trail.length_m) : undefined}
                onOpen={() => open(trailRequest(trail))}
                onRemove={async () => {
                  await unsaveTrail(session, trail.id);
                  if (trails.status === "ready") setTrails(trails.items.filter((t) => t.id !== trail.id));
                }}
                removeLabel="Unsave"
              />
            )}
          />
        )}
        {tab === "waypoints" && (
          <ItemList
            state={waypoints}
            empty={
              <>
                No waypoints yet. On the <Link to="/discover">map</Link>, use <b>+ Add</b> under My
                waypoints to mark water, camps and bail-outs.
              </>
            }
            render={(waypoint) => (
              <Row
                key={waypoint.id}
                title={waypoint.name}
                meta={waypoint.kind_label}
                swatch={`var(${kindStyle(waypoint.kind).token})`}
                note={waypoint.note || undefined}
                onOpen={() => open(waypointRequest(waypoint))}
              />
            )}
          />
        )}
        {tab === "plans" && (
          <ItemList
            state={plans}
            empty={
              <>
                No overnight plans yet. Open a trail, choose <b>Find campsites along this trail</b>, and
                add nights with <b>+ Night</b>.
              </>
            }
            render={(plan) => (
              <Row
                key={plan.id}
                title={plan.name}
                meta={`${plan.trail_name} · ${nights(plan.nights ?? 0)}`}
                onOpen={() => open(planRequest(plan))}
              />
            )}
          />
        )}
        {tab === "hikes" && (
          <ItemList
            state={hikes}
            empty={
              <>
                No hikes yet. Choose <b>Start hike</b> in a trail's panel, or <b>Track</b> on the{" "}
                <Link to="/discover">map</Link>, then <b>Stop</b> and <b>Save</b>.
              </>
            }
            render={(hike) => (
              <SavedHikeRow
                key={hike.id}
                hike={hike}
                session={session}
                onDeleted={(id) => hikes.status === "ready" && setHikes(hikes.items.filter((h) => h.id !== id))}
              />
            )}
          />
        )}
      </section>
    </main>
  );
}

/** Saved campsites' names as the detail panel shows them, derived names included. */
function useDisplayNames(saved: SavedCampsite[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const ids = saved.map((campsite) => campsite.id).join("|");
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    for (const id of ids.split("|")) {
      fetchCampsiteDetail(id, controller.signal)
        .then((detail) => {
          if (detail.display_name) setNames((current) => ({ ...current, [id]: detail.display_name! }));
        })
        .catch(() => undefined); // keep the saved name
    }
    return () => controller.abort();
  }, [ids]);
  return names;
}

function ItemList<T>({
  state,
  empty,
  render,
}: {
  state: Loaded<T>;
  empty: ReactNode;
  render: (item: T) => ReactNode;
}) {
  if (state.status === "loading") return <p className="profile-empty">Loading…</p>;
  if (state.status === "error") return <p className="profile-empty is-error">{state.message}</p>;
  if (state.items.length === 0) return <p className="profile-empty">{empty}</p>;
  return <ul className="profile-list">{state.items.map(render)}</ul>;
}

function Row({
  title,
  meta,
  note,
  swatch,
  onOpen,
  onRemove,
  removeLabel,
}: {
  title: string;
  meta?: string;
  note?: string;
  swatch?: string;
  onOpen: () => void;
  onRemove?: () => Promise<void>;
  removeLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="profile-row">
      <button type="button" className="profile-open" onClick={onOpen} title="Open on the map">
        {swatch && <span className="profile-swatch" style={{ background: swatch }} aria-hidden="true" />}
        <span className="profile-title">{title}</span>
        {meta && <span className="profile-meta">{meta}</span>}
        {note && <span className="profile-note">{note}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          className="profile-remove"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRemove();
            } finally {
              setBusy(false);
            }
          }}
        >
          {removeLabel}
        </button>
      )}
    </li>
  );
}
