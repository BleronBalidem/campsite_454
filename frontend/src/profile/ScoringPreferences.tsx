/**
 * "Scoring preferences" on the Profile (TM05-115): one slider per factor over the user's
 * saved weights (TM05-46). The slider model, and its all-zero guard, is in weights.ts.
 */

import { useEffect, useState } from "react";
import type { Session } from "../auth";
import { FACTORS, SLIDER_MAX, sameSliders, setWeight, shares, toSliders, type Sliders } from "./weights";
import { loadWeights, resetWeights, saveWeights } from "./weightsApi";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; saved: Sliders; defaults: Sliders; custom: boolean };

export default function ScoringPreferences({ session }: { session: Session }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [sliders, setSliders] = useState<Sliders | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWeights(session)
      .then((payload) => {
        if (cancelled) return;
        const saved = toSliders(payload.weights, payload.defaults);
        setState({ status: "ready", saved, defaults: toSliders(payload.defaults), custom: payload.custom });
        setSliders(saved);
      })
      .catch((error: Error) => !cancelled && setState({ status: "error", message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [session]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="prefs" aria-labelledby="prefs-title">
      <h2 id="prefs-title">Scoring preferences</h2>
      <p className="prefs-intro">
        How much each factor counts in a campsite's score. Only the proportions matter. Scores use
        these weights the next time you open a campsite.
      </p>

      {state.status === "loading" && <p className="profile-empty">Loading…</p>}
      {state.status === "error" && <p className="profile-empty is-error">{state.message}</p>}
      {state.status === "ready" && sliders && (
        <>
          <ul className="prefs-list">
            {FACTORS.map((factor) => {
              const share = shares(sliders)[factor.key];
              return (
                <li key={factor.key} className="prefs-row">
                  <label htmlFor={`weight-${factor.key}`}>
                    <span className="prefs-label">{factor.label}</span>
                    <span className="prefs-hint">{factor.hint}</span>
                  </label>
                  <input
                    id={`weight-${factor.key}`}
                    type="range"
                    min={0}
                    max={SLIDER_MAX}
                    step={1}
                    value={sliders[factor.key]}
                    aria-valuetext={`${share}% of the score`}
                    onChange={(event) => setSliders(setWeight(sliders, factor.key, Number(event.target.value)))}
                  />
                  <span className="prefs-share">{share}%</span>
                </li>
              );
            })}
          </ul>

          <div className="prefs-actions">
            <button
              type="button"
              className="button-primary"
              disabled={busy || sameSliders(sliders, state.saved)}
              onClick={() =>
                run(async () => {
                  const payload = await saveWeights(session, sliders);
                  const saved = toSliders(payload.weights, payload.defaults);
                  setState({ ...state, saved, custom: payload.custom });
                  setSliders(saved);
                  setMessage({ text: "Saved. Campsite scores now use your weights." });
                })
              }
            >
              Save
            </button>
            <button
              type="button"
              className="profile-remove"
              disabled={busy || (!state.custom && sameSliders(sliders, state.defaults))}
              onClick={() =>
                run(async () => {
                  await resetWeights(session);
                  setState({ ...state, saved: state.defaults, custom: false });
                  setSliders(state.defaults);
                  setMessage({ text: "Back to the default weights." });
                })
              }
            >
              Reset to defaults
            </button>
            {message && (
              <span className={`prefs-message${message.error ? " is-error" : ""}`} role="status">
                {message.text}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
