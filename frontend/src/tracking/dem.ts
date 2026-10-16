/**
 * Elevation at a point from the terrain tiles the map already draws (TM05-111): the AWS
 * Terrain Tiles Terrarium DEM behind the hillshade, contours and slope shading
 * (map/layers.ts TERRAIN_TILES).
 *
 * Why the terrain model rather than the phone's own altitude: GPS height is two to three
 * times less precise than GPS position, wanders by tens of metres between fixes, and is
 * measured above the WGS84 ellipsoid (about 30 m off sea level in the Adirondacks). A
 * browser cannot read the phone's barometer. The DEM gives the same smooth ground under
 * the same position every time, so the climb so far measures the hill, not the receiver.
 * docs/tracking.md has the comparison.
 *
 * The position never leaves the browser: what is fetched is the public tile that contains
 * it, the same tile the map has usually fetched already. Tiles are kept in memory.
 */

import { TERRAIN_TILES } from "../map/layers";
import { decodeTerrarium } from "../slope/slope";
import { TILE, bilinear, tilePixel } from "./demPixels";

const tiles = new Map<string, Promise<Float32Array>>();
const MAX_TILES = 64;

async function loadTile(z: number, x: number, y: number): Promise<Float32Array> {
  const url = TERRAIN_TILES.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Terrain tile answered ${response.status}`);
  // No colour management or premultiplying: the pixels are elevations (slope.worker.ts).
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const { width, height } = bitmap; // read before close(), which zeroes them
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No 2D canvas");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
  return out;
}

/** Ground elevation in metres at a position, or null if the tile cannot be read. */
export async function elevationAt(lon: number, lat: number): Promise<number | null> {
  const { z, x, y, px, py } = tilePixel(lon, lat);
  const key = `${z}/${x}/${y}`;
  let tile = tiles.get(key);
  if (!tile) {
    if (tiles.size >= MAX_TILES) tiles.delete(tiles.keys().next().value!);
    tile = loadTile(z, x, y);
    tiles.set(key, tile);
    tile.catch(() => tiles.delete(key)); // try again on the next fix
  }
  try {
    return bilinear(await tile, px, py);
  } catch {
    return null;
  }
}
