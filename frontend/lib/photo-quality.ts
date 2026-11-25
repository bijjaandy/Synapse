// In-browser photo checks for the Train page, the same idea as the backend's photo_stats:
// brightness = mean grey (0-1); sharpness = variance of the Laplacian of grey / its mean, on a 224 px canvas.
export type PhotoStats = { bright: number; sharp: number; tiny: Float32Array };
export type PhotoFlag = "blurry" | "dark" | "bright" | "different";

const SIZE = 224, TINY = 16;

export async function photoStats(file: File): Promise<PhotoStats | null> {
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
    bmp.close?.();
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const g = new Float32Array(SIZE * SIZE);
    let sum = 0;
    for (let i = 0; i < g.length; i++) { g[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; sum += g[i]; }
    const mean = Math.max(sum / g.length, 1e-3);
    let s1 = 0, s2 = 0, n = 0;
    for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
      const i = y * SIZE + x;
      const lap = (4 * g[i] - g[i - 1] - g[i + 1] - g[i - SIZE] - g[i + SIZE]) / mean;  // brightness-independent
      s1 += lap; s2 += lap * lap; n++;
    }
    const tiny = new Float32Array(TINY * TINY);  // 16x16 grey thumbnail, for "looks different from the rest"
    const step = SIZE / TINY;
    for (let ty = 0; ty < TINY; ty++) for (let tx = 0; tx < TINY; tx++) {
      let t = 0;
      for (let y = 0; y < step; y++) for (let x = 0; x < step; x++) t += g[(ty * step + y) * SIZE + tx * step + x];
      tiny[ty * TINY + tx] = t / (step * step);
    }
    return { bright: sum / g.length, sharp: s2 / n - (s1 / n) ** 2, tiny };
  } catch {
    return null;  // not decodable here (the server still checks it)
  }
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Flags relative to the rest of the set (needs a few photos to compare with). */
export function flagOutliers(stats: (PhotoStats | null)[]): (PhotoFlag | null)[] {
  const ok = stats.filter((s): s is PhotoStats => !!s);
  if (ok.length < 5) return stats.map(() => null);
  const mb = median(ok.map((s) => s.bright)), ms = median(ok.map((s) => s.sharp));
  const avg = new Float32Array(ok[0].tiny.length);
  ok.forEach((s) => s.tiny.forEach((v, i) => { avg[i] += v / ok.length; }));
  const dist = (s: PhotoStats) => Math.sqrt(s.tiny.reduce((t, v, i) => t + (v - avg[i]) ** 2, 0) / avg.length);
  const md = median(ok.map(dist));
  return stats.map((s) => {
    if (!s) return null;
    if (s.bright < mb - 0.15) return "dark";
    if (s.bright > mb + 0.15) return "bright";
    if (s.sharp < 0.4 * ms) return "blurry";
    if (dist(s) > Math.max(3 * md, 0.06)) return "different";
    return null;
  });
}

export const FLAG_TEXT: Record<PhotoFlag, string> = {
  blurry: "looks blurry", dark: "too dark", bright: "too bright", different: "looks different from the rest",
};
