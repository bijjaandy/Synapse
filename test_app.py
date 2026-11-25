"""API test on toy parts. Run: pytest -q test_app.py"""
import io
import time
import zipfile

import numpy as np
from PIL import Image
import pytest
from fastapi.testclient import TestClient

import app as server
from inspection_log import InspectionLog
from test_inspector import part


def png(img):
    b = io.BytesIO()
    img.save(b, format="PNG")
    return b.getvalue()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA", tmp_path / "data")
    monkeypatch.setattr(server, "MODELS", tmp_path / "models")
    monkeypatch.setattr(server, "inspection_log", InspectionLog(tmp_path / "logs"))
    server.models.clear()
    server.jobs.clear()
    server.meters.clear()
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

    r = client.post("/objects/washer/train", files=files, data={"backbone": "resnet18"})
    assert r.status_code == 202 and r.json()["n_images"] == 40
    s = wait_ready(client, "washer")
    assert s["state"] == "ready" and s["backbone"] == "resnet18", s
    listed = client.get("/objects").json()  # one call with each product's details and state
    assert [(o["name"], o["id"], o["state"], o["display_name"], o["n_images"]) for o in listed] == [("washer", "washer", "ready", "Washer", 40)]

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
    st = client.get("/objects/wrn/status").json()
    assert {k: st[k] for k in ("name", "state", "backbone")} == {"name": "wrn", "state": "ready", "backbone": "wide_resnet50"}
    assert st["n_images"] == 20 and st["trained_at"] > 0
    bad = client.post("/objects/wrn/predict", files={"file": ("b.png", png(part(rng, scratch=True)[0]))})
    assert bad.status_code == 200 and bad.json()["ms"] < 1000
    assert server.models["wrn"].fx is server.extractors["wide_resnet50"]  # reloaded onto the shared extractor


def test_rejects_unknown_backbone(client):
    files = [("files", (f"{i}.png", png(part(np.random.default_rng(i))[0]))) for i in range(5)]
    r = client.post("/objects/ok/train", files=files, data={"backbone": "vgg"})
    assert r.status_code == 400 and "backbone" in r.json()["detail"]


def train_toy(client, name, n=30, **data):
    rng = np.random.default_rng(7)
    files = [("files", (f"{i}.png", png(part(rng)[0]), "image/png")) for i in range(n)]
    r = client.post(f"/objects/{name}/train", files=files, data=data)
    assert r.status_code == 202, r.text
    s = wait_ready(client, name)
    assert s["state"] == "ready", s
    return s


def test_auto_backbone_and_rotations(client):
    s = train_toy(client, "auto1", rotations=4)
    assert s["backbone"] in ("resnet18", "wide_resnet50") and s["auto_report"], s
    assert any("auto: using" in line for line in s["log"])
    r = client.post("/objects/auto1/predict", files={"file": ("g.png", png(part(np.random.default_rng(1))[0]))}).json()
    assert r["rotations"] == 4 and r["backbone"] == s["backbone"]
    bad = {"files": ("a.png", png(part(np.random.default_rng(2))[0]))}
    assert client.post("/objects/x/train", files=bad, data={"rotations": 99}).status_code == 400


def test_predict_returns_3d_data_retake_and_logs(client):
    train_toy(client, "w", backbone="resnet18")
    rng = np.random.default_rng(3)
    bad = client.post("/objects/w/predict", files={"file": ("b.png", png(part(rng, scratch=True)[0]))}).json()
    assert bad["label"] == "defective" and bad["regions"] and len(bad["grid"]) == bad["grid_size"] ** 2
    dark = Image.fromarray((np.asarray(part(rng)[0], np.float32) * 0.2).astype(np.uint8))
    r = client.post("/objects/w/predict", files={"file": ("d.png", png(dark))}).json()
    assert r["label"] == "retake" and r["reasons"]

    # the log has both, the heatmap is stored, and feedback marks the entry corrected
    rows = client.get("/log", params={"object": "w"}).json()
    assert [x["label"] for x in rows] == ["retake", "defective"]
    assert client.get(f"/log/{bad['inspection_id']}/heatmap.png").headers["content-type"] == "image/png"
    fb = client.post("/objects/w/feedback", files={"file": ("b.png", png(part(rng)[0]))},
                     data={"inspection_id": bad["inspection_id"]})
    assert fb.status_code == 200
    rep = client.get("/report", params={"object": "w"}).json()
    assert rep["total"] == 2 and rep["counts"]["defective"] == 1 and rep["retakes"] == 1
    assert rep["operator_corrections"] == 1
    csv_text = client.get("/log.csv").text
    assert csv_text.startswith("id,time,object") and csv_text.count("\n") == 3
    page = client.get("/report.html", params={"object": "w"})
    assert page.status_code == 200 and "Inspection shift report" in page.text
    assert client.get("/report", params={"hours": -1}).status_code == 400


def test_meter_session(client):
    sid = client.post("/meter").json()["session"]
    rng = np.random.default_rng(4)
    for i in range(14):
        st = client.post(f"/meter/{sid}", files={"file": (f"{i}.png", png(part(rng)[0]))}).json()
    assert st["photos"] == 14 and 0 <= st["percent"] <= 100 and len(st["novelty"]) == 13
    assert st["ready"], st  # 14 near-identical good parts: new photos stop adding anything
    assert client.post("/meter/nope", files={"file": ("a.png", png(part(rng)[0]))}).status_code == 404
    assert client.delete(f"/meter/{sid}").json() == {"ended": True}


def test_predict_without_logging(client):
    train_toy(client, "nolog", backbone="resnet18")
    img = png(part(np.random.default_rng(9))[0])
    r = client.post("/objects/nolog/predict", params={"log": "false"}, files={"file": ("a.png", img)}).json()
    assert r["inspection_id"] is None
    assert client.get("/report", params={"object": "nolog"}).json()["total"] == 0
