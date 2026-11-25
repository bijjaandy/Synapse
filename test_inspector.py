"""Self-check without MVTec: toy 'washer' parts, defects = dark scratch. Run: python test_inspector.py"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def part(rng, scratch=False):
    img = Image.new("RGB", (256, 256), (200, 200, 205))
    d = ImageDraw.Draw(img)
    cx, cy = 128 + rng.integers(-4, 5), 128 + rng.integers(-4, 5)
    d.ellipse([cx - 90, cy - 90, cx + 90, cy + 90], fill=(120, 125, 135))
    d.ellipse([cx - 35, cy - 35, cx + 35, cy + 35], fill=(200, 200, 205))
    mask = Image.new("L", (256, 256))
    if scratch:
        a = rng.uniform(0, 2 * np.pi)
        x, y = cx + 60 * np.cos(a), cy + 60 * np.sin(a)
        pts = [x - 20, y - 8, x + 20, y + 8]
        d.line(pts, fill=(30, 30, 30), width=4)
        ImageDraw.Draw(mask).line(pts, fill=255, width=4)
    arr = np.asarray(img, np.float32) + rng.normal(0, 4, (256, 256, 3))
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8)), mask


def main():
    rng = np.random.default_rng(1)
    root = Path(tempfile.mkdtemp()) / "washer"
    for sub in ["train/good", "test/good", "test/scratch", "ground_truth/scratch"]:
        (root / sub).mkdir(parents=True)
    for i in range(40):
        part(rng)[0].save(root / f"train/good/{i:03d}.png")
    for i in range(10):
        part(rng)[0].save(root / f"test/good/{i:03d}.png")
        img, m = part(rng, scratch=True)
        img.save(root / f"test/scratch/{i:03d}.png")
        m.save(root / f"ground_truth/scratch/{i:03d}_mask.png")

    model = root / "m.pt"
    run = lambda *a: subprocess.run([sys.executable, "run.py", *a], check=True, capture_output=True, text=True).stdout
    print(run("train", "--data", str(root), "--model", str(model)))
    out = run("eval", "--data", str(root), "--model", str(model))
    print(out)
    auroc = float(out.split("image_auroc")[1].split()[0])
    assert auroc > 0.9, f"image AUROC too low: {auroc}"
    print(run("predict", "--image", str(root / "test/scratch/000.png"), "--model", str(model), "--heatmap", "demo_heatmap.png"))
    print(run("feedback", "--image", str(root / "test/good/000.png"), "--model", str(model)))
    print("SELF-TEST PASSED")


if __name__ == "__main__":
    main()
