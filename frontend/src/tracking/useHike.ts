/**
 * The hike in progress (TM05-111): one recording, the feed it is reading, and the
 * controls. The map page owns it, so the trail panel can start a hike and the tracking
 * display, the map's dot and the breadcrumb all read the same one.
 *
 * Every fix, real or simulated, takes the same path: feed -> terrain elevation at that
 * position (dem.ts) -> addFix (track.ts). The recording is written to IndexedDB as it
 * changes (store.ts), and on load an unfinished hike is picked up again: a running GPS
 * hike carries on, with a gap for the time the page was gone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../auth";
import { elevationAt } from "./dem";
import { gpsFeed, type PositionFeed } from "./feed";
import { directionFrom, trailLine, type TrailSnapshot } from "./progress";
import { ActiveHikeStore, browserKeyValue } from "./store";
import { saveHike, type HikeDetail } from "./api";
import {
  addFix,
  markGap,
  pause as pauseRecording,
  resume as resumeRecording,
  saveBody,
  setDirection,
  startRecording,
  stop as stopRecording,
  hikeStats,
  type Fix,
  type Recording,
} from "./track";

const PERSIST_MS = 1000;
const TICK_MS = 1000;

/** Makes the feed for a hike: GPS, or (simulate.ts) a simulated walk. */
export type FeedFactory = (recording: Recording) => PositionFeed;

export interface StartOptions {
  mode: "trail" | "free";
  trail?: TrailSnapshot | null;
  /** Omitted for real GPS. */
  feed?: FeedFactory;
}

export interface Hike {
  recording: Recording | null;
  /** The clock the hike is timed by: the feed's, or the end time once stopped. */
  now: number;
  problem: string | null;
  /** The hike just saved, for a "saved" note; cleared by dismissSaved or the next start. */
  saved: HikeDetail | null;
  dismissSaved(): void;
  start(options: StartOptions): void;
  pause(): void;
  resume(feed?: FeedFactory): void;
  stop(): void;
  save(name: string): Promise<HikeDetail>;
  discard(): Promise<void>;
}

export function useHike(session: Session | null): Hike {
  const store = useMemo(() => new ActiveHikeStore(browserKeyValue()), []);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<HikeDetail | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const feed = useRef<PositionFeed | null>(null);
  // Fixes are handled one at a time, in order, each after its elevation is known.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const onFix = useCallback((fix: Fix) => {
    queue.current = queue.current.then(async () => {
      const ele = await elevationAt(fix.lon, fix.lat).catch(() => null);
      setRecording((current) => {
        if (!current) return current;
        let next = addFix(current, fix, ele);
        if (next.trail && next.direction === null && next.last) {
          next = setDirection(next, directionFrom(trailLine(next.trail), [next.last.lon, next.last.lat]));
        }
        return next;
      });
      setProblem(null);
    });
  }, []);

  const onError = useCallback((message: string, fatal: boolean) => {
    setProblem(message);
    if (fatal) {
      feed.current?.stop();
      setRecording((current) => (current ? pauseRecording(current, feed.current?.now() ?? Date.now()) : current));
    }
  }, []);

  const begin = useCallback(
    (source: PositionFeed) => {
      feed.current?.stop();
      feed.current = source;
      source.start(onFix, onError);
    },
    [onFix, onError],
  );

  // --- pick up an unfinished hike ------------------------------------------------------------
  const username = session?.username ?? null;
  const latest = useRef<Recording | null>(null);
  useEffect(() => {
    let cancelled = false;
    void store.load(username).then((stored) => {
      // Signing in mid-hike keeps the hike in hand rather than reloading it.
      if (cancelled || !stored || latest.current) return;
      let next = stored;
      if (stored.status === "running" && stored.simulated) {
        // A simulation's walker does not survive a reload; it waits to be resumed.
        next = pauseRecording(stored, stored.last?.t ?? stored.runningSince ?? stored.startedAt);
      } else if (stored.status === "running") {
        next = markGap(stored);
        begin(gpsFeed());
      }
      latest.current = next;
      setRecording(next);
    });
    return () => {
      cancelled = true;
    };
  }, [store, username, begin]);

  // --- persistence and the clock --------------------------------------------------------------
  // Throttled, not debounced: fixes arrive every second, and a debounce would never fire.
  const pending = useRef<number | undefined>(undefined);
  useEffect(() => {
    latest.current = recording;
    if (!recording || pending.current !== undefined) return;
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      if (latest.current) void store.save(latest.current);
    }, PERSIST_MS);
  }, [store, recording]);
  useEffect(() => {
    const flush = () => {
      if (latest.current) void store.save(latest.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.clearTimeout(pending.current);
      pending.current = undefined;
    };
  }, [store]);

  const running = recording?.status === "running";
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(feed.current?.now() ?? Date.now());
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  // A hidden page is a gap in the track: GPS stops arriving, and the line should not
  // join across it.
  useEffect(() => {
    if (!running) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setRecording((current) => (current ? markGap(current) : current));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [running]);

  useEffect(() => () => feed.current?.stop(), []);

  // --- controls ----------------------------------------------------------------------------
  const clock = () => feed.current?.now() ?? Date.now();

  const start = useCallback(
    ({ mode, trail = null, feed: makeFeed }: StartOptions) => {
      setProblem(null);
      setSaved(null);
      const draft = startRecording({
        id: crypto.randomUUID(),
        owner: username,
        mode,
        simulated: Boolean(makeFeed),
        trail,
        now: Date.now(),
      });
      const source = makeFeed ? makeFeed(draft) : gpsFeed();
      const recording = { ...draft, startedAt: source.now(), runningSince: source.now() };
      setRecording(recording);
      setNow(source.now());
      void store.save(recording);
      begin(source);
    },
    [username, store, begin],
  );

  const pause = useCallback(() => {
    const at = clock();
    feed.current?.stop();
    setRecording((current) => (current ? pauseRecording(current, at) : current));
    setNow(at);
  }, []);

  const resume = useCallback(
    (makeFeed?: FeedFactory) => {
      if (!recording || recording.status !== "paused") return;
      setProblem(null);
      // A feed that survived the pause carries on; after a reload there is none, so a new
      // one is made (GPS, or the simulation picking up where it was).
      const source = feed.current ?? (makeFeed ?? (() => gpsFeed()))(recording);
      setRecording(resumeRecording(recording, source.now()));
      begin(source);
    },
    [recording, begin],
  );

  const stop = useCallback(() => {
    const at = clock();
    feed.current?.stop();
    setRecording((current) => (current ? stopRecording(current, at) : current));
    setNow(at);
  }, []);

  const save = useCallback(
    async (name: string) => {
      if (!recording || !session) throw new Error("Sign in to save hikes.");
      const end = recording.endedAt ?? clock();
      const detail = await saveHike(session, saveBody(recording, hikeStats(recording, end), name));
      await store.clear();
      feed.current = null;
      setRecording(null);
      setSaved(detail);
      return detail;
    },
    [recording, session, store],
  );

  const discard = useCallback(async () => {
    feed.current?.stop();
    feed.current = null;
    await store.clear();
    setRecording(null);
    setProblem(null);
  }, [store]);

  const shownNow = recording?.status === "stopped" ? (recording.endedAt ?? now) : now;
  const dismissSaved = useCallback(() => setSaved(null), []);
  return { recording, now: shownNow, problem, saved, dismissSaved, start, pause, resume, stop, save, discard };
}
