# TM05-117: real-iPhone testing notes

The app tested on a real iPhone through `make dev-phone` (docs/setup.md, "Testing on a
phone"), once in Safari and once installed as a home-screen app. Each issue found is
listed below with its fix and the re-test on the phone.

## Setup

- Device / iOS version: _to fill in_
- Served by: `make dev-phone`, `https://<LAN IP>:5173/discover`, self-signed certificate
- Branch / commit tested: _to fill in_

## Checklist

Each item is checked in Safari and as a home-screen app.

| Area | What to try | Safari | Home screen |
|---|---|---|---|
| Bottom sheets | Drag between peek, half and full; flick; drag on the handle and on the content; scroll the content at full | | |
| Elevation scrubber | Drag a finger along the profile; the map cursor and readout follow; lifting the finger ends it; the page does not scroll or zoom while scrubbing | | |
| Map controls | Zoom, compass/reset north, basemap switch, Location, Follow me: each is reachable and big enough to tap | | |
| Safe areas | Nothing under the notch / Dynamic Island or the home bar, in portrait and landscape | | |
| GPS dot and Follow me | Dot and accuracy circle appear after Allow; Follow me keeps the map on you while walking; dragging the map turns it off (outdoors if possible) | | |

## Issues found

| # | Where | Issue | Fix (commit) | Re-tested |
|---|---|---|---|---|
| | | | | |
