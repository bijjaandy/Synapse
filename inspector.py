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
from scipy.ndimage import gaussian_filter
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

class Inspector:
    def __init__(self, extractor=None, backbone="resnet18", band=0.5):
        self.fx = extractor or FeatureExtractor(backbone)
        self.band = band  # unsure band half-width, in std-devs of good validation scores; 0 = always decide
        self.bank = None
        self.low = self.high = self.thr = None

    def _scores(self, imgs, batch=16):
        """Image scores and 224x224 anomaly maps."""
        scores, maps = [], []
        for i in range(0, len(imgs), batch):
            feats = self.fx(imgs[i:i + batch])
            for f in feats:
                d = torch.cdist(f, self.bank).min(1).values  # distance to nearest normal patch
                side = int(d.numel() ** 0.5)
                amap = F.interpolate(d.view(1, 1, side, side), size=(SIZE, SIZE), mode="bilinear", align_corners=False)
                amap = gaussian_filter(amap.squeeze().numpy(), sigma=4)
                scores.append(float(d.max()))
                maps.append(amap)
        return np.array(scores), maps

    def fit(self, good_paths, coreset_ratio=0.01, val_frac=0.2, fakes_per_img=3, seed=0, log=print):
        t0 = time.perf_counter()
        rng = np.random.default_rng(seed)
        paths = list(good_paths)
        if len(paths) < 5:
            raise ValueError(f"need at least 5 good images, got {len(paths)}")
        rng.shuffle(paths)
        n_val = max(2, int(len(paths) * val_frac))
        val, train = paths[:n_val], paths[n_val:]

        imgs = [load_image(p) for p in train]
        feats = torch.cat([self.fx(imgs[i:i + 16]).flatten(0, 1) for i in range(0, len(imgs), 16)])
        self.bank = greedy_coreset(feats, coreset_ratio, seed)
        log(f"memory bank: {len(self.bank)} patches from {len(train)} images ({time.perf_counter() - t0:.1f}s)")

        # honest calibration: held-out good images vs. fake defects made from them
        val_imgs = [load_image(p) for p in val]
        g, _ = self._scores(val_imgs)
        # half obvious, half subtle fakes: only-obvious fakes put the threshold too high for real defects
        fakes = [fake_defect(im, rng, subtle=bool(j % 2)) for im in val_imgs for j in range(fakes_per_img * 2)]
        s, _ = self._scores(fakes)
        self._calibrate(g, s)
        log(f"threshold {self.thr:.3f}, unsure band [{self.low:.3f}, {self.high:.3f}] "
            f"(good val median {np.median(g):.3f}, fake-defect median {np.median(s):.3f})")
        log(f"total training time {time.perf_counter() - t0:.1f}s")
        return self

    def _calibrate(self, good, fake):
        cands = np.unique(np.concatenate([good, fake]))
        bal_acc = [((good < t).mean() + (fake >= t).mean()) / 2 for t in cands]
        self.thr = float(cands[int(np.argmax(bal_acc))])
        # narrow unsure band around the threshold, sized by how much good scores vary
        half = self.band * float(np.std(good))
        self.low, self.high = self.thr - half, self.thr + half

    def decide(self, score):
        if score < self.low:
            return "good"
        if score >= self.high:
            return "defective"
        return "unsure"  # send to a human instead of guessing

    def predict(self, path):
        t0 = time.perf_counter()
        scores, maps = self._scores([load_image(path)])
        ms = (time.perf_counter() - t0) * 1000
        return {"label": self.decide(scores[0]), "score": float(scores[0]), "ms": ms, "map": maps[0]}

    def add_good(self, path):
        """Operator says 'this was actually good' -> learn it instantly, no retraining."""
        f = self.fx([load_image(path)])[0]
        self.bank = torch.cat([self.bank, greedy_coreset(f, 0.1)])

    def save(self, path):
        torch.save({"bank": self.bank, "low": self.low, "high": self.high, "thr": self.thr,
                    "backbone": self.fx.name}, path)

    @classmethod
    def load(cls, path, extractor=None):
        d = torch.load(path)
        backbone = d.get("backbone", "resnet18")  # models saved before this field were resnet18
        if extractor is None or extractor.name != backbone:
            extractor = FeatureExtractor(backbone)
        m = cls(extractor)
        m.bank, m.low, m.high, m.thr = d["bank"], d["low"], d["high"], d["thr"]
        return m


def overlay(img_path, amap, out_path, vmax=None):  # paths or file-like objects
    """Save the image with a red heatmap where the anomaly score is high."""
    img = load_image(img_path)
    a = amap / (vmax or amap.max() or 1)
    heat = np.stack([a, np.zeros_like(a), np.zeros_like(a)], -1).clip(0, 1)
    Image.fromarray(((0.6 * img + 0.4 * heat) * 255).astype(np.uint8)).save(out_path, format="PNG")