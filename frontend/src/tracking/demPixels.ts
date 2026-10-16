/**
 * The pixel arithmetic behind dem.ts (TM05-111): which Terrarium tile and pixel a position
 * falls in, and the bilinear height between pixel centres. Pure, so node --test checks it.
 */

/** Zoom 14: about 7 m per pixel at 44°N, finer than a GPS fix. The tiles go to 15. */
export const DEM_ZOOM = 14;
export const TILE = 256;

/** The tile and the pixel (fractional) a position falls in, in Web Mercator. */
export function tilePixel(lon: number, lat: number, zoom = DEM_ZOOM) {
  const scale = TILE * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  return { z: zoom, x: tx, y: ty, px: x - tx * TILE, py: y - ty * TILE };
}

/**
 * Bilinear elevation at a fractional pixel of a decoded tile (row-major metres). Pixel
 * centres are at +0.5; at the tile's edge the nearest pixels are used.
 */
export function bilinear(elevation: ArrayLike<number>, px: number, py: number, size = TILE): number {
  const fx = Math.min(Math.max(px - 0.5, 0), size - 1);
  const fy = Math.min(Math.max(py - 0.5, 0), size - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => elevation[y * size + x];
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}
