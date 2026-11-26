"""Logins, human verification, summary and the assistant. Run: pytest -q test_netrix.py"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import pytest

import app as server
import assistant
from auth import UserStore
from test_app import client, png, train_toy  # noqa: F401  (shared fixture and helpers)
from test_inspector import part


@pytest.fixture()
def netrix(client, tmp_path, monkeypatch):  # noqa: F811
    store = UserStore(tmp_path / "users.json")
    monkeypatch.setattr(server, "users", store)
    return client


def login(c, user, pw):
    r = c.post("/auth/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()


def test_logins_and_roles(netrix):
    c = netrix
    assert c.post("/auth/login", json={"username": "operator", "password": "nope"}).status_code == 401
    h, me = login(c, "operator", "operator123")
    assert me["role"] == "operator" and me["role_name"] == "Operator"
    assert c.get("/auth/me", headers=h).json()["role"] == "operator"
    assert c.get("/verify/queue", headers=h).status_code == 403          # operators don't verify
    assert c.get("/verify/queue").status_code == 401                     # not logged in
    hi, _ = login(c, "inspector", "inspector123")
    assert c.get("/verify/queue", headers=hi).status_code == 200
    c.post("/auth/logout", headers=hi)
    assert c.get("/auth/me", headers=hi).status_code == 401


def test_verification_queue_and_summary(netrix):
    c = netrix
    train_toy(c, "w", backbone="resnet18")
    rng = np.random.default_rng(5)
    bad = c.post("/objects/w/predict", files={"file": ("b.png", png(part(rng, scratch=True)[0]))}).json()
    bad2 = c.post("/objects/w/predict", files={"file": ("b2.png", png(part(rng, scratch=True)[0]))}).json()
    c.post("/objects/w/predict", files={"file": ("g.png", png(part(rng)[0]))})
    assert c.get(f"/log/{bad['inspection_id']}/photo.jpg").headers["content-type"] == "image/jpeg"

    h, _ = login(c, "inspector", "inspector123")
    q = c.get("/verify/queue", headers=h).json()
    assert [r["id"] for r in q] == [bad["inspection_id"], bad2["inspection_id"]]
    assert all(r["has_photo"] and r["has_grid"] for r in q)
    g = c.get(f"/log/{bad['inspection_id']}/grid.json").json()  # Evaluation draws the Inspect overlay from this
    assert g["n"] == bad["grid_size"] and g["grid"] == bad["grid"]
    assert c.get("/log/999999/grid.json").status_code == 404
    r = c.post(f"/verify/{bad['inspection_id']}", json={"decision": "defective", "note": "crack on rim"}, headers=h).json()
    assert r == {"id": bad["inspection_id"], "decision": "defective", "by": "inspector", "model_learned": False}
    r = c.post(f"/verify/{bad2['inspection_id']}", json={"decision": "good"}, headers=h).json()
    assert r["model_learned"] is True
    assert c.get("/verify/queue", headers=h).json() == []
    assert c.post(f"/verify/{bad['inspection_id']}", json={"decision": "maybe"}, headers=h).status_code == 400

    s = c.get("/summary").json()
    assert s["total"] == 3 and s["counts"]["defective"] == 2 and s["counts"]["good"] == 1
    assert s["verification"] == {"pending": 0, "verified": 2, "confirmed_defective": 1, "overturned_to_good": 1}
    assert s["by_object"][0]["object"] == "w" and s["by_object"][0]["total"] == 3


class FakeOllama(BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):
        self._send({"models": [{"name": assistant.MODEL}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeOllama.seen.append(body)
        self._send({"message": {"role": "assistant", "content": "There are 0 inspections logged."}})

    def _send(self, obj):
        data = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


def test_assistant_with_and_without_ollama(netrix, monkeypatch):
    c = netrix
    monkeypatch.setattr(assistant, "OLLAMA_URL", "http://127.0.0.1:9")    # nothing listens: offline fallback
    assert c.get("/assistant/status").json()["ollama"] is False
    r = c.post("/assistant", json={"message": "How many parts today?"}).json()
    assert r["source"] == "offline-fallback" and "0 inspections" in r["answer"]

    srv = HTTPServer(("127.0.0.1", 0), FakeOllama)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(assistant, "OLLAMA_URL", f"http://127.0.0.1:{srv.server_address[1]}")
    st = c.get("/assistant/status").json()
    assert st["ollama"] and st["model_installed"]
    r = c.post("/assistant", json={"message": "Why was #3 flagged?", "history": [{"role": "user", "content": "hi"}]}).json()
    assert r["source"] == "ollama" and r["answer"].startswith("There are")
    sent = FakeOllama.seen[-1]
    assert sent["model"] == assistant.MODEL and sent["stream"] is False
    system = sent["messages"][0]["content"]
    assert "Use ONLY the facts" in system and "Totals:" in system          # grounded in live data
    assert sent["messages"][-1]["content"] == "Why was #3 flagged?"
    srv.shutdown()
    assert c.post("/assistant", json={"message": "  "}).status_code == 400


def test_delete_part_and_all_time(netrix):
    c = netrix
    train_toy(c, "gone1")
    c.post("/objects/gone1/predict", files={"file": ("g.png", png(part(np.random.default_rng(3))[0]))})
    op, _ = login(c, "operator", "operator123")
    sup, _ = login(c, "supervisor", "supervisor123")
    assert c.delete("/objects/gone1").status_code == 401
    assert c.delete("/objects/gone1", headers=op).status_code == 403
    assert c.get("/log", params={"hours": 0}).json()            # hours=0 = all time
    assert c.get("/report.html", params={"hours": 0}).status_code == 200
    r = c.delete("/objects/gone1", params={"purge_log": True}, headers=sup)
    assert r.status_code == 200 and r.json()["log_rows_removed"] == 1, r.text
    assert "gone1" not in [o["name"] for o in c.get("/objects").json()]   # gone from memory too
    assert c.post("/objects/gone1/predict", files={"file": ("g.png", png(part(np.random.default_rng(3))[0]))}).status_code == 404
    assert c.delete("/objects/gone1", headers=sup).status_code == 404


def test_old_models_flagged_for_retrain(netrix, monkeypatch):
    import torch
    c = netrix
    train_toy(c, "old1")
    path = server.MODELS / "old1.pt"
    d = torch.load(path)
    d["quality"].pop("version")            # what a model saved before the blur-check fix looks like
    torch.save(d, path)
    server.models.clear(); server.jobs.clear()
    s = c.get("/objects/old1/status").json()
    assert s["needs_retrain"] is True
    m = server.get_model("old1")
    assert m.needs_retrain and not any("blurry" in r for r in m.photo_problems(np.zeros((224, 224, 3), np.float32) + 0.5, np.zeros(10)))


def test_strictness_per_part(netrix):
    c = netrix
    train_toy(c, "strict_t", backbone="resnet18")
    photo = png(part(np.random.default_rng(11))[0])
    ratio = lambda r: r["score"] / r["threshold"]
    assert c.get("/objects/strict_t/status").json()["strictness"] == 1.0
    normal = c.post("/objects/strict_t/predict?log=false", files={"file": ("p.png", photo)}).json()
    assert normal["strictness"] == 1.0

    hi, _ = login(c, "inspector", "inspector123")
    ho, _ = login(c, "operator", "operator123")
    assert c.put("/objects/strict_t/strictness", json={"factor": 1.2}, headers=ho).status_code == 403
    assert c.put("/objects/strict_t/strictness", json={"factor": 1.2}).status_code == 401
    for bad in (0.5, 1.3, 2):
        assert c.put("/objects/strict_t/strictness", json={"factor": bad}, headers=hi).status_code == 400
    r = c.put("/objects/strict_t/strictness", json={"factor": 1.2}, headers=hi)
    assert r.status_code == 200 and r.json()["strictness"] == 1.2

    strict = c.post("/objects/strict_t/predict?log=false", files={"file": ("p.png", photo)}).json()
    assert strict["strictness"] == 1.2
    assert strict["score"] == pytest.approx(normal["score"], rel=1e-3)          # same photo, same score...
    assert ratio(strict) > ratio(normal) * 1.15                                 # ...but closer to / over the line
    lo, hi_ = strict["unsure_band"]
    assert lo < strict["threshold"] < hi_                                       # band scaled with the line
    assert c.get("/objects/strict_t/status").json()["strictness"] == 1.2

    # saved in the .pt file: a fresh load keeps it, and old files without the field load as 1.0
    path = server.MODELS / "strict_t.pt"
    assert server.Inspector.load(path).strictness == 1.2
    import torch
    d = torch.load(path); d.pop("strictness"); torch.save(d, path)
    assert server.Inspector.load(path).strictness == 1.0


def test_closest_good_part(netrix):
    c = netrix
    train_toy(c, "closest_t", n=30, backbone="resnet18")
    r = c.post("/objects/closest_t/predict?log=false", files={"file": ("p.png", png(part(np.random.default_rng(12))[0]))}).json()
    assert isinstance(r["closest_good"], int) and 0 <= r["closest_good"] < 30
    img = c.get(f"/objects/closest_t/good/{r['closest_good']}.jpg")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert c.get("/objects/closest_t/good/30.jpg").status_code == 404
    assert c.get("/objects/closest_t/good/-1.jpg").status_code == 404
    assert c.get("/objects/nope_part/good/0.jpg").status_code == 404


def test_assistant_kannada(netrix, monkeypatch):
    c = netrix
    monkeypatch.setattr(assistant, "OLLAMA_URL", "http://127.0.0.1:9")    # offline: Kannada fallback sentence
    monkeypatch.setattr(assistant, "_down", ("", 0.0))
    r = c.post("/assistant", json={"message": "How many parts today?", "lang": "kn"}).json()
    assert r["source"] == "offline-fallback"
    assert r["answer"].startswith("0 ತಪಾಸಣೆಗಳು ದಾಖಲಾಗಿವೆ: 0 ಸರಿ, 0 ದೋಷಯುಕ್ತ")
    assert "Ollama" in r["answer"] and "inspections logged" not in r["answer"]
    r = c.post("/assistant", json={"message": "ಇಂದು ಎಷ್ಟು ಭಾಗಗಳು?", "lang": "kn"}).json()
    assert "ತಪಾಸಣೆಗಳು" in r["answer"]
    r = c.post("/assistant", json={"message": "How many parts today?", "lang": "xx"}).json()  # unknown -> English
    assert "inspections logged" in r["answer"]

    srv = HTTPServer(("127.0.0.1", 0), FakeOllama)                         # with a model: the Kannada rule is sent
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(assistant, "OLLAMA_URL", f"http://127.0.0.1:{srv.server_address[1]}")
    c.post("/assistant", json={"message": "How many?", "lang": "kn"})
    assert assistant.KANNADA_RULE in FakeOllama.seen[-1]["messages"][0]["content"]
    c.post("/assistant", json={"message": "How many?"})
    assert assistant.KANNADA_RULE not in FakeOllama.seen[-1]["messages"][0]["content"]
    srv.shutdown()


def test_status_numbers_and_part_stats(netrix):
    c = netrix
    train_toy(c, "stats_t", backbone="resnet18")
    s = c.get("/objects/stats_t/status").json()
    assert s["state"] == "ready" and s["threshold"] > 0 and s["rotations"] == 1 and s["strictness"] == 1.0
    lo, hi = s["unsure_band"]
    assert lo < s["threshold"] < hi
    empty = c.get("/objects/stats_t/stats").json()
    assert empty["total"] == 0 and empty["last"] is None and empty["avg_ms"] == 0.0
    rng = np.random.default_rng(21)
    for im in (part(rng)[0], part(rng, scratch=True)[0], part(rng, scratch=True)[0]):
        c.post("/objects/stats_t/predict", files={"file": ("p.png", png(im))})
    c.post("/objects/stats_t/predict?log=false", files={"file": ("p.png", png(part(rng)[0]))})  # not logged: not counted
    st = c.get("/objects/stats_t/stats").json()
    assert st["total"] == 3 and sum(st["counts"].values()) == 3 and st["counts"]["defective"] >= 1
    assert st["defect_rate"] == round(st["counts"]["defective"] / 3, 4)
    assert 0 < st["avg_ms"] <= st["max_ms"] and st["last"] is not None
    server.models.clear()                         # numbers also come straight from the saved file
    s2 = c.get("/objects/stats_t/status").json()
    assert s2["threshold"] == s["threshold"] and s2["unsure_band"] == s["unsure_band"]


def test_products_create_edit_and_list(netrix):
    c = netrix
    ho, _ = login(c, "operator", "operator123")
    hi, _ = login(c, "inspector", "inspector123")
    assert server.product_id("Bottle Cap 500ml") == "bottle_cap_500ml"
    assert server.product_id("  Bracket -- Left #7 ") == "bracket_left_7"
    assert len(server.product_id("x" * 90)) == 40
    assert c.post("/products", json={"display_name": "Cap"}).status_code == 401           # must be signed in
    r = c.post("/products", json={"display_name": "Bottle Cap 500ml", "sku": "BC-500"}, headers=ho)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["id"] == "bottle_cap_500ml" and p["display_name"] == "Bottle Cap 500ml" and p["sku"] == "BC-500"
    assert p["state"] == "new" and p["created_by"] == "operator"
    assert c.post("/products", json={"display_name": "bottle cap 500ML"}, headers=ho).status_code == 409   # same id
    assert c.post("/products", json={"display_name": "!!!"}, headers=ho).status_code == 400
    c.post("/products", json={"display_name": "Washer A"}, headers=ho)
    assert c.patch("/products/washer_a", json={"display_name": "BOTTLE CAP 500ml"}, headers=hi).status_code == 409  # name taken
    assert c.patch("/products/washer_a", json={"sku": "W-1"}, headers=ho).status_code == 403                       # operator
    r = c.patch("/products/washer_a", json={"display_name": "Washer A (steel)", "description": "M8"}, headers=hi).json()
    assert r["id"] == "washer_a" and r["display_name"] == "Washer A (steel)" and r["description"] == "M8"
    train_toy(c, "legacy_part", backbone="resnet18")                        # trained without details: title-cased name
    listed = {o["id"]: o for o in c.get("/objects").json()}
    assert listed["legacy_part"]["display_name"] == "Legacy Part" and listed["legacy_part"]["state"] == "ready"
    assert listed["legacy_part"]["n_images"] == 30 and listed["legacy_part"]["backbone"] == "resnet18"
    assert listed["legacy_part"]["trained_at"]
    assert listed["bottle_cap_500ml"]["state"] == "new" and listed["bottle_cap_500ml"]["sku"] == "BC-500"
    assert c.delete("/objects/washer_a", headers=hi).json()["deleted"] == "washer_a"           # details file goes too
    assert "washer_a" not in {o["id"] for o in c.get("/objects").json()}


def test_train_add_mode_keeps_photos(netrix):
    c = netrix
    train_toy(c, "addmode_t", n=20, backbone="resnet18")
    rng = np.random.default_rng(31)
    more = [("files", (f"m{i}.png", png(part(rng)[0]), "image/png")) for i in range(6)]
    r = c.post("/objects/addmode_t/train", files=more, data={"backbone": "resnet18", "mode": "add"})
    assert r.status_code == 202 and r.json()["n_images"] == 26 and r.json()["added"] == 6
    from test_app import wait_ready
    assert wait_ready(c, "addmode_t")["state"] == "ready"
    names = sorted(p.name for p in (server.DATA / "addmode_t" / "good").glob("*.png"))
    assert names == [f"{i:04d}.png" for i in range(26)]
    few = [("files", ("x.png", png(part(rng)[0]), "image/png"))]                # a bad replace keeps the old photos
    assert c.post("/objects/addmode_t/train", files=few, data={"mode": "replace"}).status_code == 400
    assert len(list((server.DATA / "addmode_t" / "good").glob("*.png"))) == 26
    assert c.post("/objects/addmode_t/train", files=few, data={"mode": "merge"}).status_code == 400


def test_export_delete_import_predict(netrix):
    import io as _io
    import zipfile as _zip
    c = netrix
    ho, _ = login(c, "operator", "operator123")
    hi, _ = login(c, "inspector", "inspector123")
    c.post("/products", json={"display_name": "Export Me", "sku": "EX-1"}, headers=ho)
    train_toy(c, "export_me", n=20, backbone="resnet18")
    photo = png(part(np.random.default_rng(41), scratch=True)[0])
    before = c.post("/objects/export_me/predict?log=false", files={"file": ("p.png", photo)}).json()
    assert c.get("/objects/export_me/export.zip", headers=ho).status_code == 403
    z = c.get("/objects/export_me/export.zip", headers=hi)
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
    names = _zip.ZipFile(_io.BytesIO(z.content)).namelist()
    assert "model.pt" in names and "product.json" in names and sum(n.startswith("good/") for n in names) == 20
    imp = lambda data, q="": c.post(f"/objects/import{q}", files={"file": ("p.zip", data, "application/zip")}, headers=hi)
    assert imp(z.content).status_code == 409                                     # still there
    c.delete("/objects/export_me", headers=hi)
    assert c.post("/objects/export_me/predict", files={"file": ("p.png", photo)}).status_code == 404
    r = imp(z.content)
    assert r.status_code == 201, r.text
    assert r.json()["id"] == "export_me" and r.json()["display_name"] == "Export Me" and r.json()["photos"] == 20
    after = c.post("/objects/export_me/predict?log=false", files={"file": ("p.png", photo)}).json()
    assert after["label"] == before["label"] and abs(after["score"] - before["score"]) < 1e-3
    assert imp(z.content, "?overwrite=true").status_code == 201

    def zip_with(entries):
        b = _io.BytesIO()
        with _zip.ZipFile(b, "w") as zz:
            for n, data in entries:
                zz.writestr(n, data)
        return b.getvalue()
    good = _zip.ZipFile(_io.BytesIO(z.content))
    model, details = good.read("model.pt"), good.read("product.json")
    assert imp(zip_with([("model.pt", model), ("product.json", details), ("../evil.png", b"x")])).status_code == 400
    assert imp(zip_with([("model.pt", model), ("product.json", details), ("good/../../x.png", b"x")])).status_code == 400
    assert imp(zip_with([("model.pt", b"not a model"), ("product.json", details)]), "?overwrite=true").status_code == 400
    assert imp(zip_with([("model.pt", model), ("product.json", b'{"id": "../x"}')])).status_code == 400
    assert imp(b"not a zip").status_code == 400
    assert c.post("/objects/import", files={"file": ("p.zip", z.content, "application/zip")}).status_code == 401


def test_closest_good_is_the_photo_itself(netrix):
    """Inspecting a training photo must point at that same photo (index = its position in data/<id>/good)."""
    c = netrix
    train_toy(c, "closest_self", n=24, backbone="resnet18")
    files = sorted((server.DATA / "closest_self" / "good").glob("*.png"))
    assert len(files) == 24
    for i in (0, 5, 13, 23):
        r = c.post("/objects/closest_self/predict?log=false", files={"file": ("p.png", files[i].read_bytes())}).json()
        assert r["closest_good"] == i, (i, r["closest_good"])
        img = c.get(f"/objects/closest_self/good/{i}.jpg")
        assert img.status_code == 200


def test_assistant_context_rounds_numbers():
    """The model copies numbers verbatim, so the context carries them already rounded."""
    detail = {"id": 7, "score": 2.9098703861236572, "threshold": 1.9098758220672607, "ms": 472.9224999900907,
              "defect_pct": 12.3456, "ts": 1764000000.123456}
    summary = {"total": 3, "avg_ms": 193.4567, "by_object": [{"object": "Bottle", "max_ms": 621.8}]}
    ctx = assistant.build_context(summary, [], detail)
    for raw in ("2.9098703861236572", "1.9098758220672607", "472.92", "193.4567", "12.3456"):
        assert raw not in ctx
    for shown in ('"score": 2.91', '"threshold": 1.91', '"ms": 473', '"avg_ms": 193', '"max_ms": 622', '"defect_pct": 12.3'):
        assert shown in ctx
    assert "1764000000.123456" in ctx  # timestamps are left alone
    assert "Round numbers" in assistant.RULES
