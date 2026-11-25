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
