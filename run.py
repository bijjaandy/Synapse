"""Usage
  python run.py train   --data mvtec_ad/bottle            --model bottle.pt
  python run.py eval    --data mvtec_ad/bottle            --model bottle.pt
  python run.py predict --image photo.png                  --model bottle.pt --heatmap out.png
  python run.py feedback --image false_alarm.png           --model bottle.pt
  python run.py bench   --root mvtec_ad                    (all categories -> results.csv)
Options: --backbone resnet18|wide_resnet50  --coreset 0.01  --band 0.5  --only screw,pill  --out results.csv
Data folder follows MVTec AD layout: train/good, test/<type>, ground_truth/<type>.
"""
import argparse
import csv
import time
from pathlib import Path

import numpy as np
from PIL import Image
from sklearn.metrics import roc_auc_score

from inspector import SIZE, FeatureExtractor, Inspector, list_images, overlay


def evaluate(model, data):
    test = Path(data) / "test"
    rows = []
    for d in sorted(p for p in test.iterdir() if p.is_dir()):
        for img in list_images(d):
            rows.append((img, d.name != "good", d.name))
    paths = [r[0] for r in rows]
    y = np.array([r[1] for r in rows])

    t0 = time.perf_counter()
    scores, maps, worst_ms = [], [], 0.0
    for p in paths:
        r = model.predict(p)
        scores.append(r["score"])
        maps.append(r["map"])
        worst_ms = max(worst_ms, r["ms"])
    ms = (time.perf_counter() - t0) * 1000 / len(paths)
    scores = np.array(scores)
    labels = np.array([model.decide(s) for s in scores])

    sure = labels != "unsure"
    acc = ((labels[sure] == "defective") == y[sure]).mean() if sure.any() else float("nan")
    hard = scores >= model.thr  # plain good/defective answer at the threshold, no "unsure"
    out = {"image_auroc": roc_auc_score(y, scores),
           "accuracy": (hard == y).mean(),          # what a hidden test that needs a yes/no answer would see
           "defect_recall": hard[y].mean(),         # share of defective parts caught
           "false_alarm_rate": hard[~y].mean(),     # share of good parts wrongly rejected
           "accuracy_when_sure": acc, "unsure_rate": 1 - sure.mean(), "ms_per_image": ms, "worst_ms": worst_ms}

    gt_dir = Path(data) / "ground_truth"
    if gt_dir.exists():
        px_true, px_score = [], []
        for (p, bad, kind), amap in zip(rows, maps):
            if bad:
                m = gt_dir / kind / f"{p.stem}_mask.png"
                if not m.exists():
                    continue
                gt = np.asarray(Image.open(m).convert("L").resize((SIZE, SIZE), Image.NEAREST)) > 0
            else:
                gt = np.zeros((SIZE, SIZE), bool)
            px_true.append(gt.ravel())
            px_score.append(amap.ravel())
        if px_true:
            out["pixel_auroc"] = roc_auc_score(np.concatenate(px_true), np.concatenate(px_score))
    return out


MAX_TRAIN_S, MAX_MS = 600, 1000  # PS #12 limits: learn in <=10 min, <1 s per photo


def summarize(rows, title=""):
    """Print the bench summary and flag categories that break the PS limits. Returns the flagged names."""
    nan = float("nan")
    mean = lambda k: np.mean([r[k] for r in rows if k in r]) if any(k in r for r in rows) else nan
    print(f"\n===== SUMMARY {title}=====")
    print(f"{'category':12s} {'img_auroc':>9s} {'px_auroc':>9s} {'accuracy':>8s} {'recall':>7s} {'false_al':>8s} "
          f"{'train_s':>8s} {'ms/img':>7s} {'worst_ms':>9s}")
    flagged = []
    for r in rows:
        issues = []
        if r["train_s"] > MAX_TRAIN_S:
            issues.append(f"train {r['train_s']:.0f}s > {MAX_TRAIN_S}s")
        if r["worst_ms"] >= MAX_MS:
            issues.append(f"worst {r['worst_ms']:.0f}ms >= {MAX_MS}ms")
        if issues:
            flagged.append(r["category"])
        print(f"{r['category']:12s} {r['image_auroc']:9.4f} {r.get('pixel_auroc', nan):9.4f} "
              f"{r.get('accuracy', nan):8.3f} {r.get('defect_recall', nan):7.3f} {r.get('false_alarm_rate', nan):8.3f} "
              f"{r['train_s']:8.1f} {r['ms_per_image']:7.1f} {r['worst_ms']:9.1f}  "
              + ("LIMIT BROKEN: " + ", ".join(issues) if issues else "ok"))
    print("-" * 90)
    print(f"mean image AUROC      {mean('image_auroc'):.4f}")
    print(f"mean pixel AUROC      {mean('pixel_auroc'):.4f}")
    print(f"mean accuracy         {mean('accuracy'):.4f}   (plain yes/no at the threshold)")
    print(f"mean defect recall    {mean('defect_recall'):.4f}")
    print(f"mean false alarm rate {mean('false_alarm_rate'):.4f}")
    print(f"max train seconds     {max(r['train_s'] for r in rows):.1f}  (limit {MAX_TRAIN_S})")
    print(f"max ms per image      {max(r['worst_ms'] for r in rows):.1f}  (limit {MAX_MS}; worst single image)")
    print("ALL WITHIN LIMITS" if not flagged else f"OVER LIMIT: {', '.join(flagged)}")
    return flagged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["train", "eval", "predict", "feedback", "bench"])
    ap.add_argument("--data")
    ap.add_argument("--root")
    ap.add_argument("--model")
    ap.add_argument("--image")
    ap.add_argument("--heatmap")
    ap.add_argument("--coreset", type=float, default=0.01)
    ap.add_argument("--backbone", default="resnet18", choices=["resnet18", "wide_resnet50"])
    ap.add_argument("--band", type=float, default=0.5, help="unsure band half-width in std-devs; 0 = always decide")
    ap.add_argument("--only", help="comma-separated categories for bench")
    ap.add_argument("--out", default="results.csv")
    a = ap.parse_args()

    if a.cmd == "train":
        m = Inspector(backbone=a.backbone, band=a.band).fit(
            list_images(Path(a.data) / "train" / "good"), coreset_ratio=a.coreset)
        m.save(a.model)
    elif a.cmd == "eval":
        for k, v in evaluate(Inspector.load(a.model), a.data).items():
            print(f"{k:20s} {v:.4f}")
    elif a.cmd == "predict":
        m = Inspector.load(a.model)
        r = m.predict(a.image)
        print(f"{r['label'].upper()}  score={r['score']:.3f}  ({r['ms']:.0f} ms)")
        if a.heatmap:
            overlay(a.image, r["map"], a.heatmap, vmax=m.high * 1.5)
    elif a.cmd == "feedback":
        m = Inspector.load(a.model)
        m.add_good(a.image)
        m.save(a.model)
        print("learned as good; new prediction:", m.predict(a.image)["label"])
    elif a.cmd == "bench":
        fx = FeatureExtractor(a.backbone)  # load backbone once for all 15 categories
        cats = sorted(p for p in Path(a.root).iterdir() if (p / "train" / "good").is_dir())
        if a.only:
            wanted = set(a.only.split(","))
            unknown = wanted - {c.name for c in cats}
            if unknown:
                raise SystemExit(f"--only: no such category under {a.root}: {', '.join(sorted(unknown))}")
            cats = [c for c in cats if c.name in wanted]
        if not cats:
            raise SystemExit(f"no <category>/train/good folders under {a.root}")
        rows = []
        with open(a.out, "w", newline="") as f:
            w = None
            for c in cats:
                t0 = time.perf_counter()
                m = Inspector(fx, band=a.band).fit(list_images(c / "train" / "good"), coreset_ratio=a.coreset)
                row = {"category": c.name, "train_s": time.perf_counter() - t0, **evaluate(m, c)}
                print({k: round(v, 4) if isinstance(v, float) else v for k, v in row.items()})
                if w is None:
                    w = csv.DictWriter(f, fieldnames=list(row))
                    w.writeheader()
                w.writerow(row)
                f.flush()  # keep partial results if a long run is interrupted
                rows.append(row)
        print("saved", a.out)
        summarize(rows, f"({a.backbone}, coreset {a.coreset}, band {a.band}) ")


if __name__ == "__main__":
    main()