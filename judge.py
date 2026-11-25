"""Judge test mode: run a trained part on a folder of unlabelled photos and write one CSV row per photo.

    python judge.py <part> <folder> [--out results.csv] [--models models]

Runs the model on this laptop (no server needed), reads every image in the folder and its sub-folders,
and writes: file, label, score, threshold, ratio, ms, where, reasons. Prints the counts and the speed at the end.
Uses the part's saved strictness, like the dashboard.
"""
import argparse
import csv
import sys
import time
from pathlib import Path

from inspector import IMG_EXT, Inspector

COLUMNS = ["file", "label", "score", "threshold", "ratio", "ms", "where", "reasons"]
LABELS = ("good", "defective", "unsure", "retake")


def where_words(x, y):
    """Position words for a defect spot (x/y 0-1 from top-left), the same words the dashboard shows."""
    return f"{'top' if y < 0.34 else 'bottom' if y > 0.66 else 'middle'} {'left' if x < 0.34 else 'right' if x > 0.66 else 'centre'}"


def find_images(folder):
    return sorted(p for p in Path(folder).rglob("*") if p.is_file() and p.suffix.lower() in IMG_EXT)


def judge(model, folder, out):
    """Score every image under `folder` with `model`, write the CSV to `out`. Returns the rows."""
    folder = Path(folder)
    images = find_images(folder)
    if not images:
        raise SystemExit(f"no images ({', '.join(sorted(IMG_EXT))}) under {folder}")
    rows = []
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for i, path in enumerate(images, 1):
            t0 = time.perf_counter()
            r = model.predict(path)
            ms = (time.perf_counter() - t0) * 1000  # whole photo: load + score, what a judge would time
            row = {"file": path.relative_to(folder).as_posix(), "label": r["label"], "score": round(r["score"], 4),
                   "threshold": round(model.thr, 4), "ratio": round(r["score"] / model.thr, 3), "ms": round(ms, 1),
                   "where": "; ".join(where_words(g["x"], g["y"]) for g in r["regions"]),
                   "reasons": "; ".join(r["reasons"])}
            w.writerow(row)
            rows.append(row)
            print(f"\r{i}/{len(images)} {row['file'][:50]:50s} {row['label']:9s}", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description="Judge test mode: folder of photos in, CSV out.")
    ap.add_argument("part", help="trained part name, e.g. bottle (uses models/<part>.pt)")
    ap.add_argument("folder", help="folder of photos; sub-folders are included")
    ap.add_argument("--out", default="results.csv")
    ap.add_argument("--models", default=str(Path(__file__).resolve().parent / "models"), help="folder with <part>.pt")
    a = ap.parse_args(argv)
    path = Path(a.models) / f"{a.part}.pt"
    if not path.exists():
        raise SystemExit(f"no trained model for '{a.part}' ({path}); train it first")
    model = Inspector.load(path)
    t0 = time.perf_counter()
    rows = judge(model, a.folder, a.out)
    total_s = time.perf_counter() - t0
    ms = [r["ms"] for r in rows]
    counts = {k: sum(r["label"] == k for r in rows) for k in LABELS}
    print(f"{len(rows)} photos -> {a.out}")
    print("  " + "  ".join(f"{k} {v}" for k, v in counts.items()))
    print(f"  average {sum(ms) / len(ms):.0f} ms, slowest {max(ms):.0f} ms "
          f"({rows[ms.index(max(ms))]['file']}), total {total_s:.1f} s")
    return rows


if __name__ == "__main__":
    main()
