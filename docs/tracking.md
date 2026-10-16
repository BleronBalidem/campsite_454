# Hike tracking (TM05-111)

You can record a hike on the map page, see your numbers update live, and keep the result.

There are two ways to start:

- **Trail mode.** Choose **Start hike** in a trail's panel. The display adds where you are on that trail and what is ahead.
- **Free mode.** Choose **Track** among the location buttons, bottom left. It works anywhere, with no trail needed.

While a hike is recorded:

- The blue dot shows its position and the map follows it. Dragging the map stops following, as it always does.
- The breadcrumb (the recorded track) is drawn in the dot's colour.
- On a phone the display is a bottom sheet. It replaces the trail panel's sheet for the duration, because it carries that trail's essentials. On a desktop it is a small panel, bottom left.

**Controls.** Start, Pause/Resume, and Stop. After Stop you choose **Save** or **Discard**:

- Save sends the hike to your account, and it appears under **Profile → Hikes**.
- Discard deletes it from the device.
- Signed out, Save becomes **Sign in to save**. The hike waits on the device until you do.

## What the display shows

| Number | How it is worked out |
|---|---|
| Elapsed | Wall time since Start, less any time paused. |
| Moving | Elapsed, less every stop. A stop is staying within 15 m for 1 minute or longer. |
| Distance | The recorded track, counted only in steps of 10 m or more, so GPS jitter while standing still adds nothing. A step faster than 7 m/s (25 km/h, a glitch or a ride) moves the track but adds no distance. |
| Pace | Moving time per mile. |
| Elevation | The terrain model's height at your position, smoothed (see below). |
| Gain | The climb so far, from the smoothed heights. |

**Trail mode adds:**

- **"mi X.X of Y.Y"** and the miles left. They count in the direction you are walking: a hike that starts nearer the far end walks the trail end to start.
- **ETA.** Until you have walked 400 m and 5 minutes, it uses Naismith's rule over the remaining distance and climb, the same estimate the trail panel uses for the whole trail. After that it uses your own moving pace. The display says which one it is using.
- **The next three places to camp ahead**, with their distance along the trail. These are the mapped campsites, plus any potential spots you found with "Find campsites along this trail" before starting.
- **An off-trail warning** once you are more than 75 m from the trail line.
- **A far-from-trail note.** If the first fix is more than 400 m from the trail, the display says so ("You're 2.1 mi from the trailhead. Tracking anyway.") but keeps recording.

Every threshold is in `frontend/src/tracking/config.ts`. They are chosen as follows:

- **35 m accuracy cut-off.** A fix worse than 35 m is ignored and counted ("3 imprecise fixes ignored"). Phones under tree cover typically report 5 to 20 m; 35 m and worse is usually a network or Wi-Fi position, not GPS.
- **15 m stop radius.** This is larger than typical GPS wander standing still, and small enough that walking leaves it within seconds. The corollary is that a "walk" slower than 0.25 m/s counts as stopped.
- **75 m off-trail distance.** This allows for typical GPS error plus mapped trail lines that are off by tens of metres in places, without missing a real wrong turn for long.

## Elevation: the terrain model, not the phone's altitude

The elevation is read from the same DEM the map already draws for hillshade, contours and slope: AWS Terrain Tiles, Terrarium encoding, at zoom 14 (about 7 m per pixel here). It is read bilinearly at each recorded position, in `tracking/dem.ts`. The phone's own altitude is not used, for three reasons:

- **GPS height is poor.** It is two to three times less precise than GPS position, and it wanders by tens of metres between fixes. A climb summed from it is mostly noise.
- **It uses a different reference.** GPS height is measured above the WGS84 ellipsoid, which here is about 30 m off the sea-level heights on maps and trail signs.
- **A web page cannot read the barometer**, which is what makes watch and app altitudes usable.

The terrain model gives the same ground under the same position every time.

It still needs smoothing. A position wandering a few metres across a slope reads a different height each time, and the tiles are quantised. So the heights go through the trail profile's own method (docs/elevation.md):

1. a **trailing mean over the last 100 m** of track (trailing, because a live display can only use what has been walked), then
2. a climb **counts only once it exceeds 3 m** above the last counted point.

Measured on synthetic tracks (`frontend/tests/tracking.test.ts`):

- **A steady 100 m climb over 1 km with ±2.5 m of noise.** The naive sum of rises is over 150 m. The smoothed gain is 95 ± 6 m.
- **Flat ground with ±2 m of noise.** The smoothed gain is 0.

Spot check against USGS 3DEP 1 m LiDAR at Lake Placid (-73.9799, 44.2795), 2026-10-16: the terrain tile gives 549.2 m and 3DEP gives 547.0 m.

**Privacy.** No position is sent to read the elevation. What is fetched is the public tile containing it, which is usually a tile the map has already loaded.

## Phone realities, stated in the UI

- **High-accuracy GPS.** Positions come from `navigator.geolocation.watchPosition` with high accuracy and no cached fixes.
- **Screen wake lock.** The display holds a Screen Wake Lock while recording. It is released on Pause and on Stop, and asked for again when the page comes back into view (browsers drop it when the page is hidden). Where the Wake Lock API is missing or refuses, the display says to set auto-lock to Never.
- **The locked-screen note.** While recording with GPS, the display always says: *"Keep the screen on. iPhone web apps can't track with the screen locked."* A web page gets no positions while the screen is locked or the page is in the background.
- **Gaps instead of straight lines.** When the page is hidden while recording, the track starts a new segment at the next fix. The breadcrumb, the saved route and the GPX file all show a gap rather than a straight line across it. The hidden stretch still counts towards distance (as the straight line between, the least you covered) and towards moving time, because you kept walking. A paused stretch counts towards neither.
- **Location stays on the device while recording.** Nothing is uploaded while a hike is recorded. The track goes to the server once, when you choose Save.

## Surviving a reload

The hike in progress is kept in IndexedDB (`tracking/store.ts`), written at most once a second and again when the page is hidden. On load:

- A hike that was recording with GPS carries on, with a gap for the time the page was gone.
- A paused or stopped hike comes back as it was.
- A hike started by one account is not offered to another account on the same browser. A hike started signed out is offered to whoever signs in next.

It is cleared on Save or Discard.

## Saved hikes

`POST /api/hikes/` stores:

- the track: segments of `[lon, lat, ele, time]`
- the same track as a 4326 MultiLineString, with a spatial index
- the numbers as the display showed them

The contract is in docs/api.md, "Recorded hikes".

In **Profile → Hikes**, each hike lists its date, distance, time and gain. Opening one shows elapsed and moving time, draws the route (north up, with gaps), and offers:

- **Download GPX.** GPX 1.1 with one `<trkseg>` per segment and a `<time>` on every point, validated against the schema in the tests.
- **Delete.**

## The simulated walk

The simulated walk is for testing and demos away from the trail. It is offered only:

- in a dev build (`npm run dev`, `make dev`, `make dev-phone`), or
- in any build with **`?demo=1`** in the URL. The flag is remembered for the tab, in sessionStorage.

There are two ways to start one:

- **Trail panel: Simulate walk**, with a speed of 1×, 10× or 60×. It walks the open trail from its start to its end.
- **Location buttons: Simulate.** It walks a 250 m-radius loop around the map centre at 10×, with a 90-second stop halfway round.

While it runs:

- The display says **Simulated**, and has 1× / 10× / 60× buttons to change speed live.
- Saved simulated hikes keep the label in Profile → Hikes, and say "(simulated walk)" in the GPX description.

**It uses the same code path as GPS.** The simulation is only a `PositionFeed` (`tracking/simulate.ts`), the same interface as the GPS feed (`tracking/feed.ts`). Its fixes go through the same accuracy filter, terrain elevation, `addFix` and stats, and nothing downstream knows they are not real.

The trail walk is built to exercise everything:

- **Pace.** It walks at 1.3 m/s (about 2.9 mph, 20:38 /mi).
- **Jitter.** There are up to 4 m of repeatable jitter on every fix, reported at ±6 m accuracy.
- **A stop.** It stops for 3 minutes at 35% of the trail, so moving time and stop detection show.
- **A detour.** It goes 150 m off the trail and back at 60%, so the off-trail warning shows.

At the end it stands still, and the display says it has reached the end.

**Speed.** Speed changes the simulated clock: at 60× one real second is one simulated minute, and the hike's times are simulated times. Fixes are 1 simulated second apart at 1× and 5 seconds apart at 10× and 60×, sent in a batch each real second. A fast simulation still traces the trail's bends and has fixes inside the stop and the detour.

A reload pauses a simulation. **Resume** carries it on from the last recorded position, on the same clock.

## Verification: Van Hoevenberg Trail at 60× (2026-10-16, headless Chrome, 390 × 844, mobile, touch)

The steps:

1. Opened Van Hoevenberg Trail (relation 6619234, a 7.1 mi stitched line).
2. Ran "Find campsites along this trail", which found 8 mapped campsites and 3 potential spots.
3. Chose **Simulate walk** at 60×.

The hike sheet replaced the trail panel's sheet. The panel polled every 0.5 s:

| Real s | Elapsed | Trail | Distance | Moving | Pace | Elevation | Gain | Next places to camp |
|---|---|---|---|---|---|---|---|---|
| 10 | 0:10:00 | mi 0.5 of 7.1 | 0.48 mi | 0:10:00 | 20:44 /mi | 2,119 ft | +15 ft | Potential spot 0.3 mi; potential spot 1.2 mi; Phelps Brook Lean-to 1.3 mi |
| 30 | 0:30:00 | mi 1.5 of 7.1 | 1.45 mi | 0:30:00 | 20:39 /mi | 2,289 ft | +191 ft | Potential spot 0.3 mi; Phelps Brook Lean-to 0.4 mi; Marcy Dam #5 Lean-to 0.7 mi |
| 40 | 0:40:00 | mi 1.9 of 7.1 | 1.94 mi | 0:40:00 | 20:35 /mi | 2,326 ft | +244 ft | Marcy Dam #5 Lean-to 0.2 mi; Ed Hudowalski Lean-to 0.2 mi; potential spot 0.4 mi |
| 61 | 1:00:00 | mi 2.8 of 7.1 | 2.76 mi | 0:56:50 | 20:34 /mi | 2,529 ft | +459 ft | Campsite near Van Hoevenberg Trail 0.3 mi (two) |
| 91 | 1:30:00 | mi 4.2 of 7.1 | 4.24 mi | 1:26:50 | 20:30 /mi | 3,541 ft | +1,468 ft | none ahead |
| 121 | 2:00:00 | mi 5.5 of 7.1 | 5.69 mi | 1:56:50 | 20:32 /mi | 4,229 ft | +2,200 ft | none ahead |
| 151 | 2:31:00 | mi 7.0 of 7.1 | 7.20 mi | 2:27:50 | 20:32 /mi | 5,253 ft | +3,247 ft | none ahead |

**Events:**

- **The stop.** "Not moving" appeared at 0:52:00, mi 2.5, and "Recording" returned at 0:55:00. Moving time had dropped behind elapsed by 3:10 (the 3-minute stop).
- **The detour.** "Off trail: 130 m from Van Hoevenberg Trail." appeared at 1:32:00, mi 4.2, and cleared at 1:34:00.
- **The end.** It was reached after 154 real seconds.

**At Stop:**

- **Elapsed** 2:34:18; **moving** 2:29:05.
- **Distance** 7.26 mi. That is the 7.07 mi trail plus the 0.19 mi detour.
- **Pace** 20:31 /mi.
- **Elevation** 5,330 ft. Marcy's summit is 5,344 ft.
- **Gain** +3,318 ft. The trail profile's own gain is 3,305 ft (1,007.4 m).
- **Stops** 2: the planned stop, and standing at the end.

**Save** showed "Saved 'Hike on Van Hoevenberg Trail'". Profile → Hikes listed "Oct 16, 2026 · 7.26 mi · 2 h 35 min · +3,318 ft", labelled Simulated, with the route drawn as one segment.

**Also checked:**

- **The free-mode loop at 10×.** Switching to 60× live sped it up.
- **A reload mid-simulation.** It came back **Paused** and stayed paused. **Resume** carried on from the same place, with the loop's halfway stop detected.
- **Stop, then Discard,** cleared it.

**Screenshots** are in artifacts/tm05-111/:

- 01: the trail panel
- 02: the stop
- 03: the off-trail warning
- 04: the end
- 05: Stop
- 06: Profile → Hikes
- 07: the free-mode loop, resumed

**Limitation measured.** A reload loses up to the last second of real time, because the store is written at most once a second. At 60× that was 61 simulated seconds.

## Tests

- **`frontend/tests/tracking.test.ts`** covers:
  - distance, moving time and stop detection on synthetic fixes
  - jitter at a standstill
  - pause, and hidden-page gaps
  - glitch jumps
  - dropping inaccurate fixes
  - elevation smoothing and gain
  - the mile along the trail in both directions, the ETA basis, campsites ahead, the off-trail and far-start notes
  - the saved body
  - the store: reload, clear, and only offering a hike back to the account that started it
  - the DEM pixel arithmetic
  - the route drawing
- **`frontend/tests/simulate.test.ts`** covers:
  - the trail walk's plan (the stop, the detour, the end) and the loop
  - repeatable jitter
  - the simulated feed's mile progression at 1×, 10× and 60×, through the tracker and trail progress
  - pause and speed changes
  - a whole 60× walk raising the off-trail warning, detecting the stop and reaching the end
- **`tests/test_hikes.py`** covers:
  - save, list, read and delete
  - free hikes keeping no trail
  - per-user isolation: another user's hike is a 404 everywhere
  - signed-out access
  - track and body validation
  - the GPX, with times, validated against GPX 1.1
  - account deletion removing hikes

## Browser check (2026-10-16, headless Chrome, position mocked with `Emulation.setGeolocationOverride`)

- **Free mode at 390 × 844.**
  - Track, then walking north at 2 m/s for 40 fixes, gave: Elapsed 0:00:40, Distance 0.04 mi (80 m walked, counted in 10 m steps), Pace 14:55 /mi, Elevation 1,814 ft, Gain +10 ft.
  - A reload mid-hike brought it back recording (0:00:42), and the saved route had two segments, the reload a gap between them.
  - Stop, then Save, showed "Saved 'Walk, Oct 16'" and the hike under Profile → Hikes, with its route drawn.
- **Trail mode on Van Hoevenberg Trail at 1280 × 860.**
  - Starting from 2.4 mi away said "You're 2.4 mi from the trailhead. Tracking anyway."
  - Walking the first 60 line vertices advanced "mi 0.9 of 7.1", with 6.1 mi left and an ETA of 3 h 40 min by Naismith. The campsites ahead counted down: Phelps Brook Lean-to from 1.8 mi to 0.9 mi.
  - A 150 m step east of the line raised "Off trail: 77 m from Van Hoevenberg Trail". Stepping back cleared it.
- **Not checkable headless:** the wake lock (headless Chrome has none, and the "won't keep the screen awake" warning showed, as designed) and real GPS under trees. See the phone checklist in the run report.
