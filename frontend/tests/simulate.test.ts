import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineM, measure, type LngLat } from "../src/trails/geometry.ts";
import {
  DETOUR_AT,
  DETOUR_M,
  FIX_EVERY_S,
  JITTER_M,
  LOOP_RADIUS_M,
  STOP_AT,
  STOP_S,
  WALK_MPS,
  jitter,
  loopAlong,
  loopWalk,
  simulatedFeed,
  trailWalk,
  type FeedClock,
  type SimSpeed,
} from "../src/tracking/simulate.ts";
import { addFix, hikeStats, startRecording, walked, type Fix } from "../src/tracking/track.ts";
import { trailProgress, type TrailSnapshot } from "../src/tracking/progress.ts";

const LON = -73.96;
const LAT = 44.18;
const M = 1 / 111_195;
const T0 = 1_791_000_000_000;

/** A straight trail due north, `km` long, with a vertex every 100 m. */
function trail(km: number): TrailSnapshot {
  return {
    key: "relation/9",
    name: "Sim Trail",
    osmId: 9,
    fromWay: null,
    coords: Array.from({ length: km * 10 + 1 }, (_, i) => [LON, LAT + i * 100 * M] as LngLat),
    profile: null,
    stops: [
      { id: "a", label: "Lean-to A", kind: "campsite", alongM: 2000 },
      { id: "b", label: "Lean-to B", kind: "campsite", alongM: 6000 },
    ],
  };
}

/** A clock and timer the test drives: advance(ms) runs every tick that falls due. */
function fakeClock(): FeedClock & { advance(ms: number): void } {
  let now = 0;
  let ticks: { every: number; next: number; tick: () => void }[] = [];
  return {
    real: () => now,
    every(ms, tick) {
      const entry = { every: ms, next: now + ms, tick };
      ticks.push(entry);
      return () => {
        ticks = ticks.filter((t) => t !== entry);
      };
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = ticks.filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.every;
        due.tick();
      }
      now = end;
    },
  };
}

const northOf = (fix: { lat: number }) => (fix.lat - LAT) / M;

// --- the plan ------------------------------------------------------------------------------

test("the trail walk: start to end, one stop, one detour off and back", () => {
  const line = measure(trail(10).coords);
  const plan = trailWalk(line);
  const stopAlong = line.length * STOP_AT;
  const tStop = stopAlong / WALK_MPS;
  assert.equal(plan.at(0).alongM, 0);
  assert.equal(plan.at(tStop + 1).phase, "stopped");
  assert.equal(plan.at(tStop + STOP_S - 1).alongM, stopAlong);
  assert.equal(plan.at(tStop + STOP_S + 10).phase, "walking");
  const tDetour = tStop + STOP_S + (line.length * (DETOUR_AT - STOP_AT)) / WALK_MPS;
  const farthest = plan.at(tDetour + DETOUR_M / WALK_MPS);
  assert.equal(farthest.phase, "detour");
  const base: LngLat = [LON, LAT + line.length * DETOUR_AT * M];
  assert.ok(Math.abs(haversineM(base, farthest.position) - DETOUR_M) < 1);
  assert.equal(plan.at(plan.durationS + 5).phase, "done");
  assert.ok(Math.abs(plan.durationS - (line.length / WALK_MPS + STOP_S + (2 * DETOUR_M) / WALK_MPS)) < 1e-6);
  // timeAt inverts the walking stretches.
  assert.ok(Math.abs(plan.at(plan.timeAt(8000)).alongM - 8000) < 1e-6);
});

test("the loop goes round once and comes back to its start", () => {
  const center: LngLat = [LON, LAT];
  const plan = loopWalk(center);
  const start = plan.at(0).position;
  const end = plan.at(plan.durationS).position;
  assert.ok(haversineM(start, end) < 1);
  assert.ok(Math.abs(haversineM(center, plan.at(500).position) - LOOP_RADIUS_M) < 1);
  assert.equal(plan.at(plan.durationS / 2).phase, "stopped");
  const quarter = plan.at((Math.PI * LOOP_RADIUS_M) / 2 / WALK_MPS).position;
  assert.ok(Math.abs(loopAlong(center, quarter) - (Math.PI * LOOP_RADIUS_M) / 2) < 2);
});

test("jitter is a few metres and repeatable", () => {
  for (let s = 0; s < 500; s++) {
    const a = jitter(s);
    assert.ok(a.distanceM >= 0 && a.distanceM <= JITTER_M);
    assert.deepEqual(jitter(s), a);
  }
});

// --- the feed: mile progression at each speed -----------------------------------------------

for (const speed of [1, 10, 60] as SimSpeed[]) {
  test(`at ${speed}x, one real minute is ${speed} simulated minute${speed === 1 ? "" : "s"} of walking`, () => {
    const clock = fakeClock();
    const line = measure(trail(20).coords);
    const feed = simulatedFeed({ plan: trailWalk(line), speed, t0: T0, clock });
    const fixes: Fix[] = [];
    feed.start((fix) => fixes.push(fix), () => {});
    clock.advance(60_000);
    // Simulated seconds apart: 1 at 1x, FIX_EVERY_S at 10x and 60x.
    const step = Math.min(speed, FIX_EVERY_S);
    assert.equal(fixes.length, (60 * speed) / step + 1);
    assert.ok(fixes.every((fix, i) => i === 0 || fix.t - fixes[i - 1].t === step * 1000));
    const expected = 60 * speed * WALK_MPS; // before the stop at 7 km
    const last = fixes[fixes.length - 1];
    assert.ok(Math.abs(northOf(last) - expected) <= JITTER_M + 1, `north ${northOf(last)} vs ${expected}`);
    assert.equal(feed.now(), T0 + 60_000 * speed);
    // Through the tracker, as real GPS goes: the mile along the trail follows.
    let recording = startRecording({ id: "s", owner: null, mode: "trail", simulated: true, trail: trail(20), now: T0 });
    for (const fix of fixes) recording = addFix(recording, fix, null);
    const progress = trailProgress(trail(20), [recording.last!.lon, recording.last!.lat], 1, {
      distanceM: walked(recording).distanceM,
      movingMs: 0,
    });
    assert.ok(Math.abs(progress.doneM - expected) <= JITTER_M + 1, `done ${progress.doneM}`);
    // Jitter on close fixes adds a little, as it does on a phone: within 3%.
    assert.ok(Math.abs(walked(recording).distanceM - expected) <= 0.03 * expected + 10, `walked ${walked(recording).distanceM}`);
  });
}

test("pausing the feed freezes its clock; a speed change carries on from where it is", () => {
  const clock = fakeClock();
  const feed = simulatedFeed({ plan: trailWalk(measure(trail(20).coords)), speed: 10, t0: T0, clock });
  feed.start(() => {}, () => {});
  clock.advance(10_000);
  feed.stop();
  clock.advance(50_000);
  assert.equal(feed.elapsedS(), 100);
  feed.start(() => {}, () => {});
  feed.setSpeed(60);
  clock.advance(10_000);
  assert.equal(feed.elapsedS(), 700);
  assert.equal(feed.speed(), 60);
});

test("a whole 60x walk shows the stop, the detour and the end", () => {
  const clock = fakeClock();
  const snapshot = trail(10);
  const line = measure(snapshot.coords);
  const plan = trailWalk(line);
  const feed = simulatedFeed({ plan, speed: 60, t0: T0, clock });
  let recording = startRecording({ id: "w", owner: null, mode: "trail", simulated: true, trail: snapshot, now: T0 });
  let offTrailSeen = false;
  const aheadSeen = new Set<string>();
  const notes: string[] = [];
  let lastDone = -1;
  let monotonic = true;
  feed.start(
    (fix) => {
      recording = addFix(recording, fix, 500);
      const motion = { distanceM: walked(recording).distanceM, movingMs: 0 };
      const progress = trailProgress(snapshot, [fix.lon, fix.lat], 1, motion);
      if (progress.offTrail) offTrailSeen = true;
      else if (progress.doneM + 10 < lastDone) monotonic = false;
      if (!progress.offTrail) lastDone = Math.max(lastDone, progress.doneM);
      for (const entry of progress.ahead) aheadSeen.add(entry.stop.id);
    },
    (message) => notes.push(message),
  );
  clock.advance(Math.ceil(plan.durationS / 60) * 1000 + 3000);
  const stats = hikeStats(recording, feed.now());
  assert.ok(offTrailSeen, "the detour raised the off-trail warning");
  assert.ok(monotonic, "the mile only goes forward");
  assert.ok(lastDone > 9_950, `reached the end: ${lastDone}`);
  assert.ok(stats.stops >= 1, "the stop was detected");
  assert.ok(stats.movingMs < stats.elapsedMs - 120_000, "moving time leaves the stop out");
  assert.deepEqual([...aheadSeen].sort(), ["a", "b"]);
  assert.deepEqual(notes, ["The simulated walk has reached the end. Stop to finish."]);
  // Fixes 6.5 m apart trace the line: distance within jitter of the walk.
  assert.ok(Math.abs(stats.distanceM - (10_000 + 2 * DETOUR_M)) < 150, `distance ${stats.distanceM}`);
});
