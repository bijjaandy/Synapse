"""Check an MVTec AD folder before benchmarking.  Run: python check_dataset.py <mvtec_root>

Confirms the 15 categories exist with train/good, test/* and ground_truth/*, and prints image counts.
Exit code 1 if anything is missing.
"""
import sys
from pathlib import Path

from inspector import list_images

CATEGORIES = ["bottle", "cable", "capsule", "carpet", "grid", "hazelnut", "leather", "metal_nut",
              "pill", "screw", "tile", "toothbrush", "transistor", "wood", "zipper"]


def check(cat_dir):
    """Return (counts, problems) for one category folder."""
    problems = []
    train = cat_dir / "train" / "good"
    n_train = len(list_images(train)) if train.is_dir() else 0
    if n_train == 0:
        problems.append("no train/good images")

    test = cat_dir / "test"
    kinds = sorted(p for p in test.iterdir() if p.is_dir()) if test.is_dir() else []
    n_test_good = n_test_bad = n_masks = 0
    if not any(k.name == "good" for k in kinds):
        problems.append("no test/good")
    for k in kinds:
        n = len(list_images(k))
        if n == 0:
            problems.append(f"test/{k.name} is empty")
        if k.name == "good":
            n_test_good += n
            continue
        n_test_bad += n
        gt = cat_dir / "ground_truth" / k.name
        m = len(list_images(gt)) if gt.is_dir() else 0
        n_masks += m
        if m != n:
            problems.append(f"ground_truth/{k.name}: {m} masks for {n} test images")
    if n_test_bad == 0:
        problems.append("no defect test images")
    counts = (n_train, n_test_good, n_test_bad, sum(k.name != "good" for k in kinds), n_masks)
    return counts, problems


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1])
    if not root.is_dir():
        sys.exit(f"{root} is not a folder")
    print(f"{'category':12s} {'train':>6s} {'test_ok':>8s} {'test_bad':>9s} {'types':>6s} {'masks':>6s}  status")
    bad = 0
    for c in CATEGORIES:
        d = root / c
        if not d.is_dir():
            print(f"{c:12s} {'-':>6s} {'-':>8s} {'-':>9s} {'-':>6s} {'-':>6s}  MISSING folder")
            bad += 1
            continue
        counts, problems = check(d)
        print(f"{c:12s} " + " ".join(f"{v:>{w}d}" for v, w in zip(counts, (6, 8, 9, 6, 6)))
              + "  " + ("OK" if not problems else "; ".join(problems)))
        bad += bool(problems)
    print(f"\n{len(CATEGORIES) - bad}/{len(CATEGORIES)} categories OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
