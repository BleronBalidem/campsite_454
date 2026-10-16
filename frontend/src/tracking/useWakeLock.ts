/**
 * Keep the screen on while a hike is running (TM05-111), with the Screen Wake Lock API.
 *
 * Held only while `active` (running, not paused or stopped) and released as soon as it is
 * not. A browser drops the lock whenever the page is hidden, so it is asked for again when
 * the page comes back. Where there is no Wake Lock API, or the request is refused (low
 * battery mode, an old iOS), the status says so and the display warns.
 */

import { useEffect, useState } from "react";

export type WakeLockStatus = "off" | "held" | "unavailable" | "refused";

export function useWakeLock(active: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>("off");

  useEffect(() => {
    if (!active) return;
    const api = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> } }).wakeLock;
    if (!api) {
      queueMicrotask(() => setStatus("unavailable"));
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      api
        .request("screen")
        .then((lock) => {
          if (cancelled) {
            void lock.release();
            return;
          }
          sentinel = lock;
          setStatus("held");
        })
        .catch(() => !cancelled && setStatus("refused"));
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release();
      setStatus("off");
    };
  }, [active]);

  return active ? status : "off";
}
