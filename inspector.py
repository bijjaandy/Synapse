"""Good-parts-only visual inspector (SYNAPSE 2.0, PS #12).

PatchCore-style: pretrained ResNet-18 patch features -> coreset memory bank.
Threshold is set with synthetic defects only, so no real defect image is ever used.
"""
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, label as label_regions, laplace, rotate as rotate_map, zoom
from torchvision.models import resnet18, wide_resnet50_2

SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
IMG_EXT = {".png", ".jpg", ".jpeg", ".bmp"}


def list_images(folder):
    return sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in IMG_EXT)


def load_image(path):
    """RGB float32 array in [0,1], SIZE x SIZE. Accepts a path or a file-like object."""
    img = Image.open(path).convert("RGB").resize((SIZE, SIZE), Image.BILINEAR)
    return np.asarray(img, dtype=np.float32) / 255.0


WEIGHTS_DIR = Path(__file__).parent / "weights"
BACKBONES = {"resnet18": resnet18, "wide_resnet50": wide_resnet50_2}  # wide_resnet50 = standard PatchCore, ~4x slower
WEIGHTS = WEIGHTS_DIR / "resnet18.pth"  # default, kept for older scripts


class FeatureExtractor:
    def __init__(self, backbone="resnet18"):
        if backbone not in BACKBONES:
            raise ValueError(f"backbone must be one of {list(BACKBONES)}")
        self.name = backbone
        # PS rule: no internet at runtime, so weights come from a local file (fetch once with download_weights.py)
        wpath = WEIGHTS_DIR / f"{backbone}.pth"
        if not wpath.exists():
            raise FileNotFoundError(f"{wpath} missing; run `python download_weights.py {backbone}` once while online")
        net = BACKBONES[backbone]()
        net.load_state_dict(torch.load(wpath, map_location="cpu"))
        net.eval()
        self.stem = torch.nn.Sequential(net.conv1, net.bn1, net.relu, net.maxpool, net.layer1)
        self.layer2, self.layer3 = net.layer2, net.layer3

    @torch.inference_mode()
    def __call__(self, imgs):
        """imgs: list of HxWx3 [0,1] arrays -> (N, 28*28, C) patch features."""
        x = torch.from_numpy((np.stack(imgs) - MEAN) / STD).permute(0, 3, 1, 2).float()
        f2 = self.layer2(self.stem(x))
        f3 = self.layer3(f2)
        # local 3x3 aggregation gives each patch some neighbourhood context
        f2 = F.avg_pool2d(f2, 3, 1, 1)
        f3 = F.interpolate(F.avg_pool2d(f3, 3, 1, 1), size=f2.shape[-2:], mode="bilinear", align_corners=False)
        feats = torch.cat([f2, f3], 1)  # (N, C, 28, 28)
        return feats.flatten(2).transpose(1, 2).contiguous()


def greedy_coreset(feats, ratio, seed=0):
    """Pick a small subset that still covers the feature space (k-center greedy)."""
    n = len(feats)
    k = max(1, int(n * ratio))
    if k >= n:
        return feats
    g = torch.Generator().manual_seed(seed)
    # shortcut: greedy runs on a random pool of <=40k patches to fit the 10-min CPU budget; raise max_pool if time allows
    max_pool = 40_000
    if n > max_pool:
        feats = feats[torch.randperm(n, generator=g)[:max_pool]]
        n = max_pool
    proj = feats @ torch.randn(feats.shape[1], 64, generator=g)  # random projection keeps this fast on CPU
    idx = [int(torch.randint(n, (1,), generator=g))]
    dist = ((proj - proj[idx[0]]) ** 2).sum(1)
    for _ in range(k - 1):
        i = int(dist.argmax())
        idx.append(i)
        dist = torch.minimum(dist, ((proj - proj[i]) ** 2).sum(1))
    return feats[idx]


# ---------- synthetic defects (good images only) ----------

def _rand_box(rng, lo=0.05, hi=0.2):
    w, h = (rng.uniform(lo, hi, 2) * SIZE).astype(int).clip(4)
    x, y = rng.integers(0, SIZE - w), rng.integers(0, SIZE - h)
    return x, y, w, h


def fake_defect(img, rng, subtle=False):
    """Return a copy of img with one artificial defect (cut-paste, scratch or blob).
    subtle=True makes small, partly transparent defects, closer to real ones."""
    out = img.copy()
    lo, hi = (0.02, 0.08) if subtle else (0.05, 0.2)
    kind = rng.integers(3)
    if kind == 0:  # cut-paste: move a patch of the part to another place, slightly recoloured
        x, y, w, h = _rand_box(rng, lo, hi)
        patch = img[y:y + h, x:x + w] * rng.uniform(0.85, 1.15, 3) if subtle else img[y:y + h, x:x + w] * rng.uniform(0.7, 1.3, 3)
        x2, y2 = rng.integers(0, SIZE - w), rng.integers(0, SIZE - h)
        out[y2:y2 + h, x2:x2 + w] = patch.clip(0, 1)
    else:
        mask = Image.new("L", (SIZE, SIZE))
        draw = ImageDraw.Draw(mask)
        if kind == 1:  # scratch
            p = rng.integers(0, SIZE, 4)
            draw.line(list(map(int, p)), fill=255, width=int(rng.integers(1, 3) if subtle else rng.integers(2, 6)))
        else:  # blob / stain
            x, y, w, h = _rand_box(rng, lo / 2, hi / 2) if subtle else _rand_box(rng, 0.04, 0.12)
            draw.ellipse([x, y, x + w, y + h], fill=255)
        m = (np.asarray(mask) > 0)[..., None]
        alpha = rng.uniform(0.3, 0.7) if subtle else 1.0
        colour = rng.uniform(0, 1, 3).astype(np.float32)
        out = np.where(m, (alpha * colour + (1 - alpha) * out).astype(np.float32), out)
    return out


# ---------- model ----------

def photo_stats(img):
    """Brightness (mean grey, 0-1) and sharpness (variance of the Laplacian) of an HxWx3 [0,1] image.
    Sharpness is measured on grey / its mean so a darker photo doesn't look blurrier."""
    grey = img.mean(-1)
    bright = float(grey.mean())
    return bright, float(laplace(grey / max(bright, 1e-3)).var())


def rotated_copies(img, n):
    """n evenly spaced rotations of img; corners are filled with the border colour so they don't look like defects."""
    if n <= 1:
        return [img], [0.0]
    angles = [360.0 * k / n for k in range(n)]
    fill = tuple(int(c * 255) for c in np.concatenate([img[0], img[-1], img[:, 0], img[:, -1]]).mean(0))
    u8 = Image.fromarray((img * 255).astype(np.uint8))
    return [np.asarray(u8.rotate(a, resample=Image.BILINEAR, fillcolor=fill), np.float32) / 255 for a in angles], angles


def defect_regions(amap, level, max_regions=5):
    """Connected areas of amap >= level: where the area peaks (0-1, x right / y down; the pin goes here, on the
    worst spot rather than the area's centre), its share of the image, and the peak score."""
    lab, n = label_regions(amap >= level)
    regions = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        k = int(np.argmax(amap[ys, xs]))
        regions.append({"x": round(float(xs[k]) / amap.shape[1], 4), "y": round(float(ys[k]) / amap.shape[0], 4),
                        "area": round(len(xs) / amap.size, 4), "peak": round(float(amap[ys[k], xs[k]]), 4)})
    return sorted(regions, key=lambda r: -r["peak"])[:max_regions]


class Inspector:
    RETAKE_FRAC = 0.5  # if over half the photo looks unusual it's not a local defect: wrong object, angle or lighting
    SMALL_SET = 40     # below this many good photos, use 4-fold scoring instead of a 20% hold-out
    MIN_BANK = 2000    # small sets keep at least this many memory patches (1% of 12 photos would be ~94)

    def __init__(self, extractor=None, backbone="resnet18", band=0.5, q=0.95, rotations=1):
        self.fx = extractor or FeatureExtractor(backbone)
        self.band = band  # unsure band half-width, in std-devs of good validation scores; 0 = always decide
        self.q = q        # threshold = this quantile of held-out good scores (0.95 won on MVTec: acc 0.70 -> 0.81)
        self.rotations = max(1, int(rotations))  # >1: also try rotated copies, keep the best match (parts that turn, e.g. screws)
        self.bank = None
        self.low = self.high = self.thr = None
        self.quality = None  # brightness / sharpness range of the training photos, for the "retake photo" check

    def _scores(self, imgs, batch=16, keep_patches=False):
        """Image scores and 224x224 anomaly maps (and 28x28 patch distances if keep_patches).
        With rotations > 1 each image is scored at several angles and the best-matching angle wins."""
        variants, owner, angles = [], [], []
        for k, img in enumerate(imgs):
            vs, ans = rotated_copies(img, self.rotations)
            variants += vs
            angles += ans
            owner += [k] * len(vs)
        best = {}
        for i in range(0, len(variants), batch):
            feats = self.fx(variants[i:i + batch])
            for j, f in enumerate(feats):
                d = torch.cdist(f, self.bank).min(1).values  # distance to nearest normal patch
                v = i + j
                if owner[v] not in best or float(d.max()) < best[owner[v]][0]:
                    best[owner[v]] = (float(d.max()), d, angles[v])
        scores, maps, patches = [], [], []
        for k in range(len(imgs)):
            score, d, angle = best[k]
            side = int(d.numel() ** 0.5)
            amap = F.interpolate(d.view(1, 1, side, side), size=(SIZE, SIZE), mode="bilinear", align_corners=False)
            amap = gaussian_filter(amap.squeeze().numpy(), sigma=4)
            if angle:  # turn the map back so it lines up with the original photo
                amap = rotate_map(amap, -angle, reshape=False, order=1, mode="nearest")
            scores.append(score)
            maps.append(amap)
            patches.append(d.view(side, side).numpy())
        return (np.array(scores), maps, patches) if keep_patches else (np.array(scores), maps)

    def fit(self, good_paths, coreset_ratio=0.01, val_frac=0.2, fakes_per_img=0, seed=0, log=print):
        """fakes_per_img > 0 adds an optional self-check (share of fake defects caught); costs training time."""
        t0 = time.perf_counter()
        rng = np.random.default_rng(seed)
        paths = list(good_paths)
        if len(paths) < 5:
            raise ValueError(f"need at least 5 good images, got {len(paths)}")
        rng.shuffle(paths)
        n_val = max(2, int(len(paths) * val_frac))
        val, train = paths[:n_val], paths[n_val:]

        if len(paths) < self.SMALL_SET:
            # few photos (e.g. a webcam session): holding out 20% would leave ~2 scores for the threshold.
            # Instead score every photo with a memory built WITHOUT it (4 folds), then keep all photos.
            imgs = [load_image(p) for p in paths]
            self._set_quality(imgs)
            feats = [f for i in range(0, len(imgs), 16) for f in self.fx(imgs[i:i + 16])]
            ratio = max(coreset_ratio, min(1.0, self.MIN_BANK / (len(feats) * feats[0].shape[0])))
            g = []
            for fold in np.array_split(np.arange(len(imgs)), 4):
                rest = torch.cat([feats[i] for i in range(len(imgs)) if i not in set(fold)])
                self.bank = greedy_coreset(rest, ratio, seed)
                g += list(self._scores([imgs[i] for i in fold])[0])
            g = np.array(g)
            self.bank = greedy_coreset(torch.cat(feats), ratio, seed)
            val_imgs = imgs
            log(f"memory bank: {len(self.bank)} patches from all {len(imgs)} images "
                f"(small set: 4-fold scoring) ({time.perf_counter() - t0:.1f}s)")
        else:
            imgs = [load_image(p) for p in train]
            self._set_quality(imgs)
            feats = torch.cat([self.fx(imgs[i:i + 16]).flatten(0, 1) for i in range(0, len(imgs), 16)])
            self.bank = greedy_coreset(feats, coreset_ratio, seed)
            log(f"memory bank: {len(self.bank)} patches from {len(train)} images ({time.perf_counter() - t0:.1f}s)")
            # honest calibration: threshold from held-out GOOD images only, no defect image is ever used
            val_imgs = [load_image(p) for p in val]
            g, _ = self._scores(val_imgs)
        self._calibrate(g)
        log(f"threshold {self.thr:.3f} (q{self.q * 100:.0f} of {len(g)} good scores), "
            f"unsure band [{self.low:.3f}, {self.high:.3f}]")
        if fakes_per_img:
            fakes = [fake_defect(im, rng, subtle=bool(j % 2)) for im in val_imgs for j in range(fakes_per_img * 2)]
            s, _ = self._scores(fakes)
            log(f"self-check: {(s >= self.thr).mean():.0%} of {len(s)} fake defects flagged")
        log(f"total training time {time.perf_counter() - t0:.1f}s")
        return self

    def _set_quality(self, imgs):
        stats = np.array([photo_stats(im) for im in imgs])
        self.quality = {"bright": [float(stats[:, 0].min()), float(stats[:, 0].max())], "sharp_min": float(stats[:, 1].min())}

    def _calibrate(self, good):
        self.thr = float(np.quantile(good, self.q))
        # narrow unsure band around the threshold, sized by how much good scores vary
        half = self.band * float(np.std(good))
        self.low, self.high = self.thr - half, self.thr + half

    def decide(self, score):
        if score < self.low:
            return "good"
        if score >= self.high:
            return "defective"
        return "unsure"  # send to a human instead of guessing

    def photo_problems(self, img, patches):
        """Reasons this photo can't be judged fairly ('retake'), or [] if it's fine."""
        reasons = []
        if self.quality:
            bright, sharp = photo_stats(img)
            lo, hi = self.quality["bright"]
            if bright < lo - 0.15:
                reasons.append("too dark compared with the training photos")
            elif bright > hi + 0.15:
                reasons.append("too bright compared with the training photos")
            if sharp < 0.4 * self.quality["sharp_min"]:
                reasons.append("blurry or out of focus")
        if (patches >= self.thr).mean() > self.RETAKE_FRAC:
            reasons.append("most of the photo looks different: wrong object, angle, background or lighting?")
        return reasons

    def predict(self, path, grid=64):
        """label is good / defective / unsure, or 'retake' when the photo itself is the problem.
        Also returns defect regions and a small score grid (1.0 = threshold) for the 3D view."""
        t0 = time.perf_counter()
        img = load_image(path)
        scores, maps, patches = self._scores([img], keep_patches=True)
        ms = (time.perf_counter() - t0) * 1000
        score, amap = float(scores[0]), maps[0]
        label = self.decide(score)
        reasons = self.photo_problems(img, patches[0])
        if reasons:
            label = "retake"
        regions = []
        if label in ("defective", "unsure"):  # smoothing lowers peaks, so cap the level to always mark the worst area
            regions = defect_regions(amap, min(self.thr, 0.75 * float(amap.max())))
        small = zoom(amap, grid / SIZE, order=1) / self.thr
        return {"label": label, "score": score, "ms": ms, "map": amap, "reasons": reasons, "regions": regions,
                "grid": np.round(small, 3).ravel().tolist(), "grid_size": grid}

    def add_good(self, path):
        """Operator says 'this was actually good' -> learn it instantly, no retraining."""
        f = self.fx([load_image(path)])[0]
        self.bank = torch.cat([self.bank, greedy_coreset(f, 0.1)])

    def save(self, path):
        torch.save({"bank": self.bank, "low": self.low, "high": self.high, "thr": self.thr,
                    "backbone": self.fx.name, "rotations": self.rotations, "quality": self.quality}, path)

    @classmethod
    def load(cls, path, extractor=None):
        d = torch.load(path)
        backbone = d.get("backbone", "resnet18")  # models saved before this field were resnet18
        if extractor is None or extractor.name != backbone:
            extractor = FeatureExtractor(backbone)
        m = cls(extractor, rotations=d.get("rotations", 1))
        m.bank, m.low, m.high, m.thr = d["bank"], d["low"], d["high"], d["thr"]
        m.quality = d.get("quality")  # older models have no photo-quality stats; that check is then skipped
        return m


def choose_backbone(n_images, rotations=1, coreset_ratio=0.01, train_budget=600, ms_budget=1000, safety=0.5,
                    get_fx=FeatureExtractor, log=print):
    """Time each backbone on THIS computer and pick the most accurate one whose estimated training time and
    per-photo time stay under `safety` x the PS limits (10 min, 1 s). Returns (name, report)."""
    report = []
    for name in ["wide_resnet50", "resnet18"]:  # most accurate first
        if not (WEIGHTS_DIR / f"{name}.pth").exists():
            continue
        fx = get_fx(name)
        dummy = [np.random.default_rng(0).random((SIZE, SIZE, 3), dtype=np.float32) for _ in range(8)]
        fx(dummy[:1])  # warm-up
        t = time.perf_counter(); f = fx(dummy); per_img = (time.perf_counter() - t) / 8
        t = time.perf_counter(); fx(dummy[:1]); single = time.perf_counter() - t
        n_train = int(n_images * 0.8)
        k = max(1, int(n_train * f.shape[1] * coreset_ratio))
        bank = torch.randn(k, f.shape[2])
        t = time.perf_counter(); torch.cdist(f[0], bank).min(1); search = time.perf_counter() - t
        pool = torch.randn(min(n_train * f.shape[1], 40_000), f.shape[2])
        t = time.perf_counter(); greedy_coreset(pool, 50 / len(pool)); coreset = (time.perf_counter() - t) / 50 * k
        est_train = per_img * (n_train + (n_images - n_train) * rotations) + coreset + 0.01 * n_images
        est_ms = ((single + search) * rotations + 0.015) * 1000
        ok = est_train <= safety * train_budget and est_ms <= safety * ms_budget
        report.append({"backbone": name, "est_train_s": round(est_train, 1), "est_ms": round(est_ms), "fits": ok})
        log(f"{name}: estimated training {est_train:.0f}s, {est_ms:.0f} ms/photo -> {'fits' if ok else 'too slow'}")
        if ok:
            return name, report
    return "resnet18", report  # nothing fits with margin: fall back to the fastest


def overlay(img_path, amap, out_path, vmax=None):  # paths or file-like objects
    """Save the image with a red heatmap where the anomaly score is high."""
    img = load_image(img_path)
    a = amap / (vmax or amap.max() or 1)
    heat = np.stack([a, np.zeros_like(a), np.zeros_like(a)], -1).clip(0, 1)
    Image.fromarray(((0.6 * img + 0.4 * heat) * 255).astype(np.uint8)).save(out_path, format="PNG")


class SampleMeter:
    """'Do I have enough good photos yet?' while capturing. Each new photo is scored against the earlier ones
    (novelty = how unlike anything seen so far). When novelty stops changing, new photos teach the model
    nothing new. A heuristic guide for the operator, not a guarantee."""
    MIN_PHOTOS = 12

    def __init__(self, extractor):
        self.fx = extractor
        self.bank = None
        self.novelty = []
        self.used = time.time()
        self._rng = torch.Generator().manual_seed(0)

    def add(self, path):
        f = self.fx([load_image(path)])[0]
        if self.bank is not None:
            self.novelty.append(float(torch.cdist(f, self.bank).min(1).values.max()))
        keep = f[torch.randperm(len(f), generator=self._rng)[: len(f) // 4]]  # a quarter of the patches keeps it fast
        self.bank = keep if self.bank is None else torch.cat([self.bank, keep])
        self.used = time.time()
        return self.status()

    def status(self):
        photos, nov = len(self.novelty) + 1 if self.bank is not None else 0, self.novelty
        count = min(1.0, photos / self.MIN_PHOTOS)
        if len(nov) >= 6:
            prev, last = float(np.mean(nov[-6:-3])), float(np.mean(nov[-3:]))
            stability = float(np.clip(1 - abs(prev - last) / max(prev, 1e-6) / 0.3, 0, 1))
        else:
            stability = 0.5 * count
        percent = round(100 * min(count, stability))
        ready = photos >= self.MIN_PHOTOS and stability >= 0.75
        if photos < 5:
            hint = f"Capture at least {5 - photos} more to be able to train."
        elif ready:
            hint = "Enough samples: new photos no longer teach it anything new."
        elif photos < self.MIN_PHOTOS:
            hint = f"Good start. Aim for {self.MIN_PHOTOS}+ photos with small changes in position."
        else:
            hint = "Still learning: recent photos show new variety. Keep capturing."
        return {"photos": photos, "percent": percent, "ready": ready, "hint": hint,
                "novelty": [round(x, 3) for x in nov[-30:]]}
