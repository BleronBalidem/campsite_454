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
