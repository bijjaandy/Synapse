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
