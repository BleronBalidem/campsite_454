/**
 * A saved hike's route as SVG polylines (TM05-111), for the Profile list: the track drawn
 * to fit a box, north up, with its true shape (longitude scaled by the cosine of the
 * latitude). One polyline per segment, so gaps stay gaps. Pure, so node --test checks it.
 */

export function routeShape(
  track: readonly (readonly (readonly [number, number, ...unknown[]])[])[],
  width: number,
  height: number,
  padding = 4,
): string[] {
  const points = track.flat();
  if (points.length < 2) return [];
  const lat0 = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p[0] * kx);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const scale = Math.min((width - 2 * padding) / (spanX || 1e-9), (height - 2 * padding) / (spanY || 1e-9));
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return track
    .filter((segment) => segment.length >= 2)
    .map((segment) =>
      segment
        .map((p) => {
          const x = offsetX + (p[0] * kx - minX) * scale;
          const y = height - (offsetY + (p[1] - minY) * scale);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" "),
    );
}
