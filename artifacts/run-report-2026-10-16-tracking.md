# Run report: TM05-111, real-time hike tracking with a simulated walk (2026-10-16)

- **Story:** TM05-111 (Davis Stapleton, 8 pts, Sprint 6). It was already In Progress at the start, and it stays In Progress, as asked.
- **Jira:** no worklogs were created. One comment was added after each merge.

## PRs

| PR | What | CI | Merged |
|---|---|---|---|
| [#90](https://github.com/dtstaple/campsite_454/pull/90) | Part 1, tracking: the `Hike` model and API, the tracking core, the live display, the breadcrumb, wake lock, Save or Discard, Profile → Hikes, docs | green (quality, frontend) | yes, `--merge` |
| [#91](https://github.com/dtstaple/campsite_454/pull/91) | Part 2, the simulated walk: the feed, the trail and loop plans, 1×/10×/60×, the "Simulated" label, the 60× verification and screenshots | green | yes, `--merge` |
| this report | `artifacts/run-report-2026-10-16-tracking.md` | | |

- Each branch was cut from an up-to-date `main` after the previous PR had merged. No branch was stacked on another, and nothing was force-pushed.
- Every commit starts with `TM05-111 ` and is authored as davis1244.
- The CLAUDE.md gate (ruff check, ruff format, pytest, frontend lint, build and tests) passed before every commit.

## Acceptance Criteria (customfield_10044)

| AC | Status | Where |
|---|---|---|
| Trail mode (from a trail panel) and free mode (anywhere), with Start, Pause/Resume and Stop | **Met** | **Start hike** in the trail panel; **Track** with the location buttons. `tracking/StartHike.tsx`, `useHike.ts` |
| A live display of elapsed time, moving time, distance, elevation and gain so far, and pace. In trail mode also miles done, miles left, ETA, and the next campsites ahead | **Met** | `tracking/HikePanel.tsx`, `track.ts`, `progress.ts`. Measured in the table below |
| An off-trail warning, and the breadcrumb track drawn on the map | **Met** | The warning past 75 m: "Off trail: 130 m from Van Hoevenberg Trail." The breadcrumb is one line per segment, so gaps stay gaps |
| On Stop, the hike can be saved to the Profile or discarded; saved hikes export as GPX with timestamps | **Met** | `POST /api/hikes/`; the **Profile → Hikes** tab. The GPX has a `<time>` on every point and is schema-validated in `tests/test_hikes.py` |
| Keeps the screen awake while tracking, and states clearly that iPhone web apps can't track with the screen locked | **Met in code; needs a phone to confirm** | `useWakeLock.ts` holds the Screen Wake Lock while running and releases it on Pause or Stop. The note shows whenever a hike is running, and a warning shows if the lock is unavailable. Headless Chrome has no wake lock, so only the warning path could be seen. See the phone checklist |
| A simulated walk replays a trail at 1x, 10x or 60x through the same code path, labelled "Simulated" | **Met** | `simulate.ts` is a `PositionFeed`, like `feed.ts` (GPS). Its fixes go through the same filter, elevation, `addFix` and stats |
| Tests cover distance and moving time, inaccurate-fix filtering, elevation smoothing, and the simulated progression | **Met** | `frontend/tests/tracking.test.ts` (26), `frontend/tests/simulate.test.ts` (8), `tests/test_hikes.py` (22) |

**Brief items beyond the AC:**

- **Configurable distances.** The distances (far from the trail, off trail) and the accuracy threshold are in `tracking/config.ts`.
- **"You're 2.1 mi from the trailhead".** The note shows and tracking still starts. Measured: "You're 2.4 mi from the trailhead. Tracking anyway."
- **ETA.** It uses the hiker's pace, falling back to Naismith.
- **Campsites ahead.** These are the mapped sites plus any potential spots already found.
- **Follow mode.** The dot is followed while tracking.
- **Surviving a reload.** The active hike is kept in IndexedDB until it is saved or discarded.
- **GPS settings.** `watchPosition` with high accuracy, dropping fixes worse than ±35 m (they are counted and shown).
- **Hidden page.** It is a gap in the track, not a straight line across it.
- **Uploads.** Nothing is uploaded until Save.
- **Simulation.** Jitter, one stop, an off-trail detour, a free-mode loop, and gating to dev builds plus `?demo=1`.
- **Per-user isolation.** Another user's hike is a 404 everywhere (tests).

## Measurements

### Van Hoevenberg Trail, simulated at 60× (headless Chrome, 390 × 844, mobile, touch)

Before starting I ran "Find campsites along this trail", which found 8 mapped campsites and 3 potential spots. On Simulate, the hike sheet replaced the trail panel's sheet (the trail panel was `display: none`).

| Real s | Elapsed | Trail | Distance | Moving | Pace | Elevation | Gain | Ahead (first) |
|---|---|---|---|---|---|---|---|---|
| 10 | 0:10:00 | mi 0.5 of 7.1 | 0.48 mi | 0:10:00 | 20:44 /mi | 2,119 ft | +15 ft | Potential spot 0.3 mi |
| 30 | 0:30:00 | mi 1.5 of 7.1 | 1.45 mi | 0:30:00 | 20:39 /mi | 2,289 ft | +191 ft | Potential spot 0.3 mi; Phelps Brook Lean-to 0.4 mi |
| 40 | 0:40:00 | mi 1.9 of 7.1 | 1.94 mi | 0:40:00 | 20:35 /mi | 2,326 ft | +244 ft | Marcy Dam #5 Lean-to 0.2 mi |
| 61 | 1:00:00 | mi 2.8 of 7.1 | 2.76 mi | 0:56:50 | 20:34 /mi | 2,529 ft | +459 ft | Campsite near Van Hoevenberg Trail 0.3 mi |
| 91 | 1:30:00 | mi 4.2 of 7.1 | 4.24 mi | 1:26:50 | 20:30 /mi | 3,541 ft | +1,468 ft | none ahead |
| 121 | 2:00:00 | mi 5.5 of 7.1 | 5.69 mi | 1:56:50 | 20:32 /mi | 4,229 ft | +2,200 ft | none ahead |
| 151 | 2:31:00 | mi 7.0 of 7.1 | 7.20 mi | 2:27:50 | 20:32 /mi | 5,253 ft | +3,247 ft | none ahead |

**Stop detection.** "Not moving" showed at 0:52:00 (mi 2.5), and "Recording" returned at 0:55:00. Moving time ended 3:10 behind elapsed.

**Off-trail warning.** "Off trail: 130 m from Van Hoevenberg Trail." appeared at 1:32:00 (mi 4.2) and cleared at 1:34:00.

**End.** It was reached after 154 real seconds. The numbers at Stop:

| Number | Value | Reference |
|---|---|---|
| Elapsed | 2:34:18 | |
| Moving | 2:29:05 | |
| Distance | 7.26 mi | 7.07 mi of trail plus the 0.19 mi detour |
| Pace | 20:31 /mi | the walker's set pace is 20:38 |
| Elevation | 5,330 ft | Marcy is 5,344 ft |
| Gain | +3,318 ft | the trail profile says 3,305 ft (1,007.4 m) |
| Stops | 2 | the planned stop, and standing at the end |

**Stop, then Save.** The banner read "Saved 'Hike on Van Hoevenberg Trail'". Profile → Hikes listed "Oct 16, 2026 · 7.26 mi · 2 h 35 min · +3,318 ft", labelled Simulated, with the route drawn as one segment.

Screenshots are in `artifacts/tm05-111/`, 01 to 07.

### Other checks

- **Free mode with mocked GPS (390 × 844).**
  - 40 fixes at 2 m/s gave Elapsed 0:00:40, 0.04 mi, Pace 14:55 /mi, Elevation 1,814 ft, Gain +10 ft.
  - A reload mid-hike came back recording, and the saved route had 2 segments, the reload a gap between them.
  - Stop, then Save, showed the hike under Profile → Hikes.
- **Trail mode with mocked GPS (1280 × 860).**
  - Starting 2.4 mi away showed the trailhead note.
  - Walking the line advanced the mile and counted the campsites ahead down (Phelps Brook from 1.8 mi to 0.9 mi).
  - A 150 m step off the trail raised "Off trail: 77 m". Stepping back cleared it.
- **Simulation extras.**
  - The free-mode loop at 10× switched to 60× live.
  - A reload mid-simulation came back **Paused** and stayed paused. **Resume** carried on from the same place.
  - Stop, then Discard, cleared it.
- **The DEM sampler against USGS 3DEP 1 m.** At Lake Placid (-73.9799, 44.2795) it read 549.2 m; 3DEP reads 547.0 m.

## Judgment calls

1. **`make doctor` failed at the start, on unapplied migrations.** They were not mine: TM05-46 `accounts.0002`, TM05-90 `enrichment.0003` and TM05-89 `geodata.0008`, which had just arrived on main. Doctor's own FIX is `manage.py migrate`. I applied them to my local database only and re-ran doctor, which passed, rather than stopping. Nothing in `backend/accounts/` was edited.
2. **Elevation comes from the Terrarium DEM in the browser** (the tiles behind hillshade, contours and slope), not from 3DEP on the server. Sampling 3DEP per position would mean sending the position to our server continuously, which the brief rules out. Only the public tile containing the position is fetched. Smoothing follows the trail profile's method: a trailing 100 m mean and a 3 m threshold. The reasons are in `docs/tracking.md`.
3. **Thresholds.** The values in `config.ts`, chosen from first principles and documented:

   | Setting | Value |
   |---|---|
   | Accuracy cut-off | 35 m |
   | Stop | within 15 m for 60 s |
   | Off trail | past 75 m |
   | Far from the trail at start | past 400 m |
   | Points kept | every 5 m, or every 15 s |
   | Distance counted | in steps of 10 m or more |
   | Pace used for the ETA | after 400 m and 5 minutes |

4. **Glitch jumps.** A step faster than 7 m/s adds no distance. A jump from 2.4 mi away to the trailhead had counted as walked in the first check.
5. **Direction.** Trail-mode direction is set from the first fix: the nearer end is the start. A hike starting nearer the far end counts miles from that end.
6. **ETA once pace is known** is moving pace times the remaining distance. Remaining climb is not added, because the pace already includes the hiker's climbing so far.
7. **Hidden-page gaps** add the straight-line distance across the gap (the least the hiker covered) and count as moving. A paused stretch counts as neither.
8. **The server stores the numbers the display showed** rather than recomputing them, so the saved hike says what the hiker saw. The server does validate the track (ranges, times never going backwards, two or more points, size limits) and derives `started_at`/`ended_at` from it.
9. **Tracking works signed out.** Save then reads "Sign in to save", and the hike waits in IndexedDB. A stored hike is offered back only to the account that started it, or to anyone if it was started signed out.
10. **One sheet at a time on a phone.** While a hike is on, the hike sheet replaces the trail panel's sheet (the hike sheet carries the trail's essentials). It opens at **half**, so the controls and the screen-lock note are visible, and the glance row stays visible at peek.
11. **Simulated fixes** are spaced 5 simulated seconds apart at 10× and 60× (12 per real second at 60×), not one per real second. At one fix per simulated minute, the first 60× run measured 6.91 mi instead of 7.26 mi, because fixes 78 m apart cut the trail's corners. It also had only about 4 fixes in the detour.
12. **A simulation does not keep running across a reload.** It comes back paused, and Resume continues it on the same clock.
13. **The screen-lock note** also shows during simulations, so a demo shows the limitation.
14. **Saving is throttled to at most once a second**, plus a save on `pagehide`. The first version debounced, which never fired while fixes kept arriving.
15. **A local demo account, `tm05111demo`**, was created in my local database for the browser checks. It is not in any dump and has no real data: three test hikes. The token file was in the scratchpad only.

## Changes to shared files (minimal, all mine to make)

- `frontend/src/location/LiveLocation.tsx` (TM05-103, mine): an optional `tracked` position and a `children` slot. Following turns on when a hike starts.
- `frontend/src/trails/TrailPanel.tsx` and `TrailInsight.tsx`: a `hike` slot under the panel header, and the snapshot builder call.
- `frontend/src/pages/Discover.tsx`: `useHike`, the memoised hike position, the Track and Simulate buttons, `HikePanel`, the "saved" banner, and the `is-hiking` class.
- `frontend/src/pages/Profile.tsx`: the **Hikes** tab.
- `frontend/src/theme.css`: new `--hike-*` tokens only.
- `docs/api.md`: a new "Recorded hikes" section.
- `backend/planning/`: the `Hike` model and migration `0005_hikes`, `hikes.py`, `hike_views.py`, and the URLs.

**Not touched:**

- `backend/accounts/`
- the mapped-campsite score colours
- TM05-113, TM05-115 and TM05-117. There were no branches or PRs for them when I checked.

## Not met, or still open

- **Real-phone behaviour is unverified:** the wake lock actually holding, iOS Safari with the screen locked or the app in the background, and GPS under tree cover. Use the checklist below.
- **A reload loses up to the last second of real time** (61 simulated seconds at 60×), because the store is written at most once a second. A real hike loses at most about one second of fixes.
- **The trail panel's length differs from the search card's.** The panel shows "mi X of 7.1" (the stitched line, 11,373 m), while the search card says 7.7 mi (the relation's total length). The difference predates this story (docs/routes.md, stitching), but a hiker comparing the two will notice.

## Phone checklist

1. **Start the phone build.**
   - On the Mac, run `make dev-phone`.
   - On the iPhone, open the printed `https://<LAN-IP>:5173` URL, accept the certificate, and sign in.
2. **Short free-mode walk.**
   1. Tap **Track** and allow location.
   2. Check that:
      - the dot appears and **Follow me** turns on
      - the sheet shows Recording and the numbers climb as you walk
      - the "Keep the screen on…" note is there
   3. Leave the phone untouched past its auto-lock time. The screen should stay on, which shows the wake lock works. If the "won't keep the screen awake" warning shows instead, note the iOS version.
   4. Lock the phone for about 30 s, then unlock it. The track should show a **gap**, with no straight line across it.
   5. **Pause**, walk a few steps, then **Resume**. The paused steps should not count.
   6. **Stop**, then **Save**.
   7. Check **Profile → Hikes**: the date, distance, time, gain, and the route with its gap.
   8. Tap **Download GPX** and open the file. Every point should have a time.
3. **Simulated Van Hoevenberg hike at 10×.**
   1. Open Van Hoevenberg Trail and tap **Find campsites along this trail**.
   2. Choose **Simulate walk** at **10×**. The whole walk takes about 15½ minutes.
   3. Check:
      - **Simulated** in the sheet
      - mi X of 7.1 advancing
      - the campsites ahead counting down
      - **Not moving** at about 5 minutes (mi 2.5)
      - **Off trail** at about 9 minutes (mi 4.2), then clearing
   4. Tap **60×**: it should speed up at once.
   5. Reload the page: the hike comes back **Paused**. Tap **Resume**: it continues from the same mile.
   6. At the end, tap **Stop**, then **Save**, and check it in Profile → Hikes.
4. Note anything that differs, with the iOS version, on TM05-111 (or on TM05-117 if it is an iPhone layout issue).
