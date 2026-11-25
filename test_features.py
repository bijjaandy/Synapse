"""Checks for rotation, the retake check, defect regions and auto model selection. Run: pytest -q test_features.py"""
import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter

from inspector import FeatureExtractor, Inspector, choose_backbone, load_image
from test_inspector import part


def key_part(rng, angle=0.0, scratch=False):
    """An asymmetric part (a key-like bar with a notch), so rotation actually changes how it looks."""
    img = Image.new("RGB", (256, 256), (205, 205, 210))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 108, 216, 148], fill=(110, 115, 130))
    d.ellipse([20, 98, 80, 158], fill=(110, 115, 130))
    d.rectangle([170, 148, 190, 168], fill=(110, 115, 130))  # notch on one side only
    if scratch:
        d.line([110, 115, 150, 140], fill=(20, 20, 20), width=4)
    img = img.rotate(angle, resample=Image.BILINEAR, fillcolor=(205, 205, 210))
    arr = np.asarray(img, np.float32) + rng.normal(0, 3, (256, 256, 3))
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8))


@pytest.fixture(scope="module")
def fx():
    return FeatureExtractor("resnet18")


def save_all(tmp_path, imgs, prefix):
    paths = []
    for i, im in enumerate(imgs):
        p = tmp_path / f"{prefix}{i:03d}.png"
        im.save(p)
        paths.append(p)
    return paths


def test_rotation_turns_false_alarm_into_good(tmp_path, fx):
    rng = np.random.default_rng(0)
    train = save_all(tmp_path, [key_part(rng, rng.uniform(-3, 3)) for _ in range(30)], "t")
    turned_good = save_all(tmp_path, [key_part(rng, 90)], "g")[0]
    turned_bad = save_all(tmp_path, [key_part(rng, 90, scratch=True)], "b")[0]

    plain = Inspector(fx).fit(train, log=lambda *_: None)
    rot = Inspector(fx, rotations=4).fit(train, log=lambda *_: None)
    assert plain.predict(turned_good)["label"] != "good"          # without rotation a turned part looks wrong
    assert rot.predict(turned_good)["label"] == "good"            # with rotation it's recognised
    assert rot.predict(turned_bad)["label"] in ("defective", "unsure")  # and a real defect is still caught


def test_retake_for_bad_photos_but_not_for_defects(tmp_path, fx):
    rng = np.random.default_rng(1)
    train = save_all(tmp_path, [part(rng)[0] for _ in range(30)], "t")
    m = Inspector(fx).fit(train, log=lambda *_: None)

    good = part(rng)[0]
    dark = Image.fromarray((np.asarray(good, np.float32) * 0.25).astype(np.uint8))
    blurry = good.filter(ImageFilter.GaussianBlur(6))
    wrong = key_part(rng)
    scratched = part(rng, scratch=True)[0]
    p = dict(zip(["good", "dark", "blurry", "wrong", "scratched"],
                 save_all(tmp_path, [good, dark, blurry, wrong, scratched], "x")))

    assert m.predict(p["good"])["label"] in ("good", "unsure")     # q95 threshold: ~1 in 20 good parts sits near the line
    r = m.predict(p["dark"]); assert r["label"] == "retake" and any("dark" in x for x in r["reasons"])
    r = m.predict(p["blurry"]); assert r["label"] == "retake" and any("blurry" in x for x in r["reasons"])
    assert m.predict(p["wrong"])["label"] == "retake"
    assert m.predict(p["scratched"])["label"] == "defective"      # a local defect must NOT be sent to retake


def test_regions_point_at_the_defect(tmp_path, fx):
    rng = np.random.default_rng(2)
    train = save_all(tmp_path, [part(rng)[0] for _ in range(30)], "t")
    m = Inspector(fx).fit(train, log=lambda *_: None)
    img, mask = part(rng, scratch=True)
    path = save_all(tmp_path, [img], "s")[0]
    r = m.predict(path)
    assert r["regions"], "a defective photo must have at least one region"
    ys, xs = np.nonzero(np.asarray(mask.resize((224, 224))) > 0)
    top = r["regions"][0]
    assert abs(top["x"] - xs.mean() / 224) < 0.12 and abs(top["y"] - ys.mean() / 224) < 0.12
    assert len(r["grid"]) == r["grid_size"] ** 2 and max(r["grid"]) > 1.0   # grid is in threshold units
    assert m.predict(save_all(tmp_path, [part(rng)[0]], "g")[0])["regions"] == []


def test_choose_backbone_reports_and_respects_budget(fx):
    cache = {"resnet18": fx}
    get = lambda n: cache.setdefault(n, FeatureExtractor(n))
    name, report = choose_backbone(200, get_fx=get, log=lambda *_: None)
    assert name in ("resnet18", "wide_resnet50") and report
    assert all({"backbone", "est_train_s", "est_ms", "fits"} <= set(r) for r in report)
    name, report = choose_backbone(200, train_budget=0.001, ms_budget=0.001, get_fx=get, log=lambda *_: None)
    assert name == "resnet18" and not any(r["fits"] for r in report)  # nothing fits -> fastest


def test_old_model_files_still_load(tmp_path, fx):
    import torch
    rng = np.random.default_rng(3)
    m = Inspector(fx).fit(save_all(tmp_path, [part(rng)[0] for _ in range(10)], "t"), log=lambda *_: None)
    old = {"bank": m.bank, "low": m.low, "high": m.high, "thr": m.thr}  # format before this change
    torch.save(old, tmp_path / "old.pt")
    loaded = Inspector.load(tmp_path / "old.pt", fx)
    assert loaded.rotations == 1 and loaded.quality is None
    assert loaded.predict(save_all(tmp_path, [part(rng)[0]], "g")[0])["label"] in ("good", "unsure")


def test_feedback_clears_the_flag(tmp_path, fx):
    rng = np.random.default_rng(4)
    m = Inspector(fx).fit(save_all(tmp_path, [part(rng)[0] for _ in range(30)], "t"), log=lambda *_: None)
    flagged = save_all(tmp_path, [part(rng, scratch=True)[0]], "s")[0]
    assert m.predict(flagged)["label"] == "defective"
    m.add_good(flagged)                                   # operator: "this was actually good"
    assert m.predict(flagged)["label"] == "good"          # one click is enough for the same photo
