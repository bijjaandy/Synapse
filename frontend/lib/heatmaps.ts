// Pictures made from the model's score grid (grid_size x grid_size, 1.0 = the decision line).
// Everything is drawn here in the browser so the 2D view, the layer map and the 3D view use the same colours.

export const HEAT_FLOOR = 0.6;   // below this a cell looks like the good parts: fully transparent
export const HEAT_CEIL = 3.0;    // at or above this: the hottest colour

// warm scale on the template palette: mist-teal -> amber -> --defect -> deep red
const STOPS: [number, [number, number, number]][] = [
  [0.0, [107, 142, 123]], [0.25, [183, 201, 177]], [0.45, [224, 179, 65]], [0.7, [194, 87, 26]], [1.0, [122, 22, 12]],
];

export function heatColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], f = (x - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * f)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Score (threshold units) to 0..1 on the colour scale. The line (1.0) lands on amber. */
export const heatT = (v: number) => Math.min(1, Math.max(0, (v - HEAT_FLOOR) / (HEAT_CEIL - HEAT_FLOOR)));

/** Smooth (bilinear) score at u,v in 0..1, row 0 at the top. */
export function sampleGrid(grid: number[], n: number, u: number, v: number) {
  const x = Math.min(n - 1, Math.max(0, u * n - 0.5)), y = Math.min(n - 1, Math.max(0, v * n - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, g = (r: number, c: number) => grid[r * n + c];
  return (g(y0, x0) * (1 - fx) + g(y0, x1) * fx) * (1 - fy) + (g(y1, x0) * (1 - fx) + g(y1, x1) * fx) * fy;
}

/** Upsampled score field, size x size. */
export function field(grid: number[], n: number, size: number) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = sampleGrid(grid, n, (x + 0.5) / size, (y + 0.5) / size);
  return out;
}

const isEdge = (f: Float32Array, size: number, x: number, y: number) => {
  if (f[y * size + x] < 1) return false;
  return (x > 0 && f[y * size + x - 1] < 1) || (x < size - 1 && f[y * size + x + 1] < 1)
      || (y > 0 && f[(y - 1) * size + x] < 1) || (y < size - 1 && f[(y + 1) * size + x] < 1);
};

function canvasOf(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

export type HeatOptions = { contour?: boolean; alpha?: boolean; size?: number };

/** Transparent overlay: colour where the part differs, the line drawn as a thin cream contour. */
export function heatCanvas(grid: number[], n: number, { contour = true, alpha = true, size = 256 }: HeatOptions = {}) {
  const f = field(grid, n, size), c = canvasOf(size), ctx = c.getContext("2d")!, img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const t = heatT(f[i]), [r, g, b] = heatColor(t);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = alpha ? Math.round(255 * 0.95 * Math.min(1, Math.max(0, (t - 0.08) / 0.3))) : 255;   // clear below ~0.8x the line
  }
  if (contour) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (isEdge(f, size, x, y)) {
      const i = (y * size + x) * 4;
      img.data[i] = 241; img.data[i + 1] = 233; img.data[i + 2] = 210; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export const heatOverlayUrl = (grid: number[], n: number, opts?: HeatOptions) => heatCanvas(grid, n, opts).toDataURL("image/png");

/** Raw patch-distance map, opaque, the full colour scale (what the model "measures" per cell). */
export const distanceMapUrl = (grid: number[], n: number) => heatOverlayUrl(grid, n, { alpha: false, contour: false });

export function loadImg(src: string) {
  return new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
}

/** Photo with the overlay blended in. */
export function blendUrl(photo: HTMLImageElement, grid: number[], n: number, size = 512) {
  const c = canvasOf(size), ctx = c.getContext("2d")!;
  ctx.drawImage(photo, 0, 0, size, size);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(heatCanvas(grid, n, { size }), 0, 0);
  return c.toDataURL("image/png");
}

/** Photo dimmed, with only the cells above the line kept bright and outlined. */
export function aboveLineUrl(photo: HTMLImageElement, grid: number[], n: number, size = 512) {
  const f = field(grid, n, size), c = canvasOf(size), ctx = c.getContext("2d")!;
  ctx.drawImage(photo, 0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const p = i * 4;
    if (f[i] >= 1) { // tint the flagged area toward --defect
      img.data[p] = Math.round(img.data[p] * 0.45 + 194 * 0.55); img.data[p + 1] = Math.round(img.data[p + 1] * 0.45 + 87 * 0.55); img.data[p + 2] = Math.round(img.data[p + 2] * 0.45 + 26 * 0.55);
    } else { // dim and desaturate the rest
      const grey = (img.data[p] + img.data[p + 1] + img.data[p + 2]) / 3 * 0.35 + 20;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = grey;
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (isEdge(f, size, x, y)) {
    const p = (y * size + x) * 4; img.data[p] = 241; img.data[p + 1] = 233; img.data[p + 2] = 210;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

/** CSS gradient of the colour scale, for legends. */
export const heatGradientCss = () =>
  `linear-gradient(90deg, ${Array.from({ length: 11 }, (_, i) => { const [r, g, b] = heatColor(i / 10); return `rgb(${r},${g},${b}) ${i * 10}%`; }).join(", ")})`;

/** Where the line (1.0) and 2x the line sit on the legend, in %. */
export const legendPos = (v: number) => heatT(v) * 100;
