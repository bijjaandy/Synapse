"""API test on toy parts. Run: pytest -q test_app.py"""
import io
import time
import zipfile

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app as server
from test_inspector import part


def png(img):
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA", tmp_path / "data")
    monkeypatch.setattr(server, "MODELS", tmp_path / "models")
    server.models.clear()
    server.jobs.clear()
    return TestClient(server.app)


def wait_ready(c, name, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = c.get(f"/objects/{name}/status").json()
        if s["state"] in ("ready", "failed"):
            return s
        time.sleep(0.5)
    raise TimeoutError


def test_train_predict_feedback(client):
    rng = np.random.default_rng(0)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:  # half the images in a zip, half as plain files
        for i in range(20):
            z.writestr(f"good/{i}.png", png(part(rng)[0]))
    files = [("files", ("good.zip", buf.getvalue(), "application/zip"))]
    files += [("files", (f"{i}.png", png(part(rng)[0]), "image/png")) for i in range(20)]

    r = client.post("/objects/washer/train", files=files)
    assert r.status_code == 202 and r.json()["n_images"] == 40
    s = wait_ready(client, "washer")
    assert s["state"] == "ready" and s["backbone"] == "resnet18", s
    assert client.get("/objects").json() == [{"name": "washer", "state": "ready"}]

    bad = client.post("/objects/washer/predict", files={"file": ("b.png", png(part(rng, scratch=True)[0]))}).json()
    good = client.post("/objects/washer/predict", files={"file": ("g.png", png(part(rng)[0]))}).json()
    assert bad["label"] == "defective" and good["label"] != "defective"
    assert bad["score"] > good["score"] and bad["ms"] < 1000
    assert base64_png(bad["heatmap_png_base64"])

    server.models.clear()  # model must reload from disk
    r = client.post("/objects/washer/feedback", files={"file": ("g.png", png(part(rng)[0]))})
    assert r.json() == {"learned": True, "new_label": "good"}


def base64_png(s):
    import base64
    return base64.b64decode(s)[:8] == b"\x89PNG\r\n\x1a\n"


def test_rejects_bad_input(client):
    assert client.post("/objects/../x/train", files={"files": ("a.png", b"x")}).status_code in (400, 404)
    assert client.post("/objects/Bad Name/train", files={"files": ("a.png", b"x")}).status_code == 400
    assert client.post("/objects/ok/train", files={"files": ("a.png", b"not an image")}).status_code == 400
    two = [("files", (f"{i}.png", png(part(np.random.default_rng(i))[0]))) for i in range(2)]
    assert client.post("/objects/ok/train", files=two).status_code == 400  # too few images
    assert client.post("/objects/missing/predict", files={"file": ("a.png", b"x")}).status_code == 404


def test_serves_ui(client):
    r = client.get("/")
    assert r.status_code == 200 and "Good-Parts Inspector" in r.text
    assert client.get("/static/index.html").status_code == 200


def test_wide_resnet50_backbone(client):
    rng = np.random.default_rng(1)
    files = [("files", (f"{i}.png", png(part(rng)[0]), "image/png")) for i in range(20)]
    r = client.post("/objects/wrn/train", files=files, data={"backbone": "wide_resnet50"})
    assert r.status_code == 202 and r.json()["backbone"] == "wide_resnet50"
    s = wait_ready(client, "wrn", timeout=600)
    assert s["state"] == "ready" and s["backbone"] == "wide_resnet50", s

    server.models.clear()
    server.jobs.clear()  # status and predict must now come from the saved model file alone
    assert client.get("/objects/wrn/status").json() == {"name": "wrn", "state": "ready", "backbone": "wide_resnet50"}
    bad = client.post("/objects/wrn/predict", files={"file": ("b.png", png(part(rng, scratch=True)[0]))})
    assert bad.status_code == 200 and bad.json()["ms"] < 1000
    assert server.models["wrn"].fx is server.extractors["wide_resnet50"]  # reloaded onto the shared extractor


def test_rejects_unknown_backbone(client):
    files = [("files", (f"{i}.png", png(part(np.random.default_rng(i))[0]))) for i in range(5)]
    r = client.post("/objects/ok/train", files=files, data={"backbone": "vgg"})
    assert r.status_code == 400 and "backbone" in r.json()["detail"]
