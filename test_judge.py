"""judge.py: folder of photos in, CSV out. Toy part in a temp folder, no server and no real models."""
import csv

import numpy as np
from PIL import Image

import judge
from inspector import Inspector
from test_inspector import part


def test_judge_cli_writes_one_row_per_image(tmp_path, capsys):
    rng = np.random.default_rng(3)
    train = tmp_path / "train"
    train.mkdir()
    for i in range(20):
        part(rng)[0].save(train / f"{i:02d}.png")
    (tmp_path / "models").mkdir()
    Inspector(backbone="resnet18").fit(sorted(train.glob("*.png"))).save(tmp_path / "models" / "judge_toy.pt")

    photos = tmp_path / "photos"
    (photos / "line2").mkdir(parents=True)          # sub-folders are included
    for i in range(3):
        part(rng)[0].save(photos / f"good_{i}.png")
        part(rng, scratch=True)[0].convert("RGB").save(photos / "line2" / f"scratch_{i}.jpg")
    dark = (np.asarray(part(rng)[0], np.float32) * 0.2).astype(np.uint8)
    Image.fromarray(dark).save(photos / "dark.png")
    (photos / "notes.txt").write_text("not an image")

    out = tmp_path / "results.csv"
    judge.main(["judge_toy", str(photos), "--out", str(out), "--models", str(tmp_path / "models")])

    with open(out, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 7                                        # every image, the .txt skipped
    assert list(rows[0]) == judge.COLUMNS
    assert all(r["label"] in judge.LABELS for r in rows)
    by_file = {r["file"]: r for r in rows}
    assert "line2/scratch_0.jpg" in by_file
    assert by_file["dark.png"]["label"] == "retake" and by_file["dark.png"]["reasons"]
    assert sum(by_file[f"line2/scratch_{i}.jpg"]["label"] in ("defective", "unsure") for i in range(3)) >= 2
    for r in rows:
        assert abs(float(r["ratio"]) - float(r["score"]) / float(r["threshold"])) < 0.002  # rounding only
        assert float(r["ms"]) > 0
    printed = capsys.readouterr().out
    assert "7 photos" in printed and "slowest" in printed and "average" in printed
