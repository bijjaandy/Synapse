"""REST backend for the good-parts inspector.

Run:  uvicorn app:app --port 8000      Docs: http://localhost:8000/docs
"""
import base64
import shutil
import html
import io
import re
import secrets
import threading
import time
import zipfile
from pathlib import Path

import torch
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image

import assistant
from auth import ROLES, UserStore, bearer, require_role
from inspection_log import InspectionLog
from inspector import QUALITY_VERSION, STRICTNESS_RANGE, BACKBONES, WEIGHTS_DIR, FeatureExtractor, Inspector, SampleMeter, choose_backbone, list_images, overlay

ROOT = Path(__file__).parent
DATA, MODELS = ROOT / "data", ROOT / "models"
MAX_FILE_MB, MAX_IMAGES, MIN_IMAGES = 25, 1000, 5
NAME_RE = re.compile(r"^[a-z0-9_-]{1,40}$")
IMG_EXT = (".png", ".jpg", ".jpeg", ".bmp")
MAX_ROTATIONS, MAX_METERS, METER_TTL_S, METER_MAX_PHOTOS = 8, 8, 3600, 300

app = FastAPI(title="Good-Parts Inspector")
# shortcut: open CORS so a local frontend on any port works; restrict origins if this is ever deployed
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

extractors = {"resnet18": FeatureExtractor("resnet18")}  # one per backbone, shared by all objects; others load on first use
models: dict[str, Inspector] = {}
jobs: dict[str, dict] = {}       # per-object training status
train_lock = threading.Lock()    # one training at a time: a laptop CPU can't do two well
state_lock = threading.Lock()
fx_lock = threading.Lock()
meters: dict[str, SampleMeter] = {}  # webcam capture sessions for the "enough photos?" meter
meter_lock = threading.Lock()
inspection_log = InspectionLog(ROOT / "logs")
users = UserStore(ROOT / "users.json")


def can_verify(authorization: str | None = Header(None)):
    """Only QC inspectors and supervisors verify. Looks up `users` at call time so tests can swap the store."""
    return require_role(users, "inspector", "supervisor")(authorization)


def check_name(name):
    if not NAME_RE.fullmatch(name):
        raise HTTPException(400, "object name must be 1-40 chars of a-z, 0-9, _ or -")
    return name


def read_upload(f: UploadFile) -> bytes:
    data = f.file.read(MAX_FILE_MB * 2**20 + 1)
    if len(data) > MAX_FILE_MB * 2**20:
        raise HTTPException(413, f"{f.filename}: file larger than {MAX_FILE_MB} MB")
    return data


def decode_image(data: bytes, label: str) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        return img.convert("RGB")
    except Exception:
        raise HTTPException(400, f"{label}: not a readable image")


def images_from_uploads(files):
    """Yield decoded images from plain image uploads and/or .zip archives (read in memory, never extracted)."""
    for f in files:
        data = read_upload(f)
        if (f.filename or "").lower().endswith(".zip"):
            try:
                zf = zipfile.ZipFile(io.BytesIO(data))
            except zipfile.BadZipFile:
                raise HTTPException(400, f"{f.filename}: not a valid zip")
            for info in zf.infolist():
                if info.is_dir() or not info.filename.lower().endswith(IMG_EXT) or "__MACOSX" in info.filename:
                    continue
                if info.file_size > MAX_FILE_MB * 2**20:
                    raise HTTPException(413, f"{info.filename}: image larger than {MAX_FILE_MB} MB")
                yield decode_image(zf.read(info), info.filename)
        else:
            yield decode_image(data, f.filename or "upload")


def get_fx(backbone):
    with fx_lock:  # so two requests never load the same big backbone twice
        if backbone not in extractors:
            extractors[backbone] = FeatureExtractor(backbone)
        return extractors[backbone]


def saved_backbone(path):
    return torch.load(path).get("backbone", "resnet18")  # models saved before this field were resnet18


def saved_strictness(path):
    return float(torch.load(path).get("strictness", 1.0))


def current_strictness(name):
    """The part's strictness: from the model in memory, else its saved file, else 1.0."""
    with state_lock:
        m = models.get(name)
    if m:
        return m.strictness
    path = MODELS / f"{name}.pt"
    return saved_strictness(path) if path.exists() else 1.0


def saved_needs_retrain(path):
    q = torch.load(path).get("quality")
    return bool(q) and q.get("version") != QUALITY_VERSION


def get_model(name):
    with state_lock:
        if name in models:
            return models[name]
    path = MODELS / f"{name}.pt"
    if not path.exists():
        raise HTTPException(404, f"no trained model for '{name}'")
    m = Inspector.load(path, get_fx(saved_backbone(path)))  # pass the shared extractor so load doesn't build another
    with state_lock:
        models[name] = m
    return m


def run_training(name, folder, backbone, rotations):
    job = jobs[name]
    log = lambda msg: job["log"].append(msg)
    with train_lock:
        job["state"], job["started"] = "training", time.time()
        try:
            good = list_images(folder)
            if backbone == "auto":
                log("auto: timing each backbone on this computer...")
                backbone, report = choose_backbone(len(good), rotations, get_fx=get_fx, log=log)
                job.update(backbone=backbone, auto_report=report)
                log(f"auto: using {backbone}")
            elif backbone not in extractors:
                log(f"loading {backbone} backbone...")
            keep = current_strictness(name)  # retraining keeps the part's strictness setting
            m = Inspector(get_fx(backbone), rotations=rotations).fit(good, log=log)
            m.strictness = keep
            MODELS.mkdir(exist_ok=True)
            m.save(MODELS / f"{name}.pt")
            with state_lock:
                models[name] = m
            job.update(state="ready", train_s=round(time.time() - job["started"], 1), trained_at=time.time())
        except Exception as e:  # report to the UI instead of dying silently in the thread
            job.update(state="failed", error=str(e))


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/objects")
def list_objects():
    names = {p.stem for p in MODELS.glob("*.pt")} | set(jobs)
    return [{"name": n, "state": jobs.get(n, {}).get("state", "ready")} for n in sorted(names)]


@app.post("/objects/{name}/train", status_code=202)
def train(name: str, files: list[UploadFile] = File(...), backbone: str = Form("auto"), rotations: int = Form(1)):
    """Upload good-part photos (images and/or a .zip). Training starts in the background.
    `backbone`: auto (default: times both on this computer, picks the most accurate that fits the PS limits),
    resnet18 (fast) or wide_resnet50 (bigger, slower). `rotations`: 1 = off, e.g. 8 for parts that can turn."""
    check_name(name)
    if backbone != "auto" and backbone not in BACKBONES:
        raise HTTPException(400, f"backbone must be auto or one of {', '.join(BACKBONES)}")
    if not 1 <= rotations <= MAX_ROTATIONS:
        raise HTTPException(400, f"rotations must be between 1 and {MAX_ROTATIONS}")
    if backbone != "auto" and not (WEIGHTS_DIR / f"{backbone}.pth").exists():
        raise HTTPException(400, f"{backbone} weights missing; run `python download_weights.py {backbone}` once while online")
    if jobs.get(name, {}).get("state") in ("queued", "training"):
        raise HTTPException(409, f"'{name}' is already training")
    folder = DATA / name / "good"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.png"):
        old.unlink()  # a new upload replaces the previous training set for this object
    n = 0
    for img in images_from_uploads(files):
        if n >= MAX_IMAGES:
            raise HTTPException(413, f"more than {MAX_IMAGES} images")
        img.save(folder / f"{n:04d}.png")  # our own file names, so uploaded names never touch the disk
        n += 1
    if n < MIN_IMAGES:
        raise HTTPException(400, f"need at least {MIN_IMAGES} good images, got {n}")
    jobs[name] = {"state": "queued", "n_images": n, "backbone": backbone, "rotations": rotations, "log": []}
    threading.Thread(target=run_training, args=(name, folder, backbone, rotations), daemon=True).start()
    return {"name": name, "n_images": n, "backbone": backbone, "rotations": rotations, "state": "queued"}


def model_numbers(name):
    """Line, unsure band, rotations and strictness of a ready model: from memory, else read once from its file."""
    with state_lock:
        m = models.get(name)
    if m is not None:
        return {"threshold": round(m.thr, 4), "unsure_band": [round(m.low, 4), round(m.high, 4)],
                "rotations": m.rotations, "strictness": m.strictness}
    path = MODELS / f"{name}.pt"
    if not path.exists():
        return {}
    d = torch.load(path)
    k = float(d.get("strictness", 1.0))
    return {"threshold": round(d["thr"] / k, 4), "unsure_band": [round(d["low"] / k, 4), round(d["high"] / k, 4)],
            "rotations": d.get("rotations", 1), "strictness": k}


@app.get("/objects/{name}/status")
def status(name: str):
    check_name(name)
    if name in jobs:
        extra = model_numbers(name) if jobs[name].get("state") == "ready" else {"strictness": current_strictness(name)}
        return {"name": name, **jobs[name], **extra}
    path = MODELS / f"{name}.pt"
    if path.exists():
        with state_lock:
            m = models.get(name)
        good = DATA / name / "good"
        return {"name": name, "state": "ready", "backbone": m.fx.name if m else saved_backbone(path),
                "n_images": len(list(good.glob("*.png"))) if good.exists() else None,
                "trained_at": path.stat().st_mtime,
                "needs_retrain": m.needs_retrain if m else saved_needs_retrain(path),
                **model_numbers(name)}
    raise HTTPException(404, f"unknown object '{name}'")


@app.get("/objects/{name}/stats")
def object_stats(name: str):
    """This part's inspection log in numbers: counts, defect rate, average / slowest ms, last inspected."""
    check_name(name)
    rows = inspection_log.rows(name)
    counts = {k: sum(r["label"] == k for r in rows) for k in ("good", "defective", "unsure", "retake")}
    n = len(rows)
    return {"name": name, "total": n, "counts": counts,
            "defect_rate": round(counts["defective"] / n, 4) if n else 0.0,
            "avg_ms": round(sum(r["ms"] for r in rows) / n, 1) if n else 0.0,
            "max_ms": round(max((r["ms"] for r in rows), default=0.0), 1),
            "last": max((r["ts"] for r in rows), default=None)}


@app.get("/objects/{name}/good/{index}.jpg")
def good_photo(name: str, index: int):
    """One of the part's training photos by index (the `closest_good` from /predict). Only our own saved files."""
    check_name(name)
    files = list_images(DATA / name / "good") if (DATA / name / "good").is_dir() else []
    if not 0 <= index < len(files):
        raise HTTPException(404, "no such training photo")
    buf = io.BytesIO()
    Image.open(files[index]).convert("RGB").save(buf, "JPEG", quality=90)
    return Response(buf.getvalue(), media_type="image/jpeg")


class StrictnessBody(BaseModel):
    factor: float


@app.put("/objects/{name}/strictness")
def set_strictness(name: str, body: StrictnessBody, who: dict = Depends(can_verify)):
    """QC inspectors and supervisors: how strict this part's line is. 1.0 = as trained,
    >1 (up to 1.25) flags more (fewer missed defects), <1 (down to 0.8) flags fewer (fewer false alarms)."""
    check_name(name)
    lo, hi = STRICTNESS_RANGE
    if not lo <= body.factor <= hi:
        raise HTTPException(400, f"factor must be between {lo} and {hi}")
    if jobs.get(name, {}).get("state") in ("queued", "training"):
        raise HTTPException(409, f"'{name}' is training; wait for it to finish")
    m = get_model(name)
    with state_lock:
        m.strictness = round(float(body.factor), 3)
        m.save(MODELS / f"{name}.pt")
    return {"name": name, "strictness": m.strictness, "threshold": round(m.thr, 4), "by": who["username"]}


@app.delete("/objects/{name}")
def delete_object(name: str, purge_log: bool = False, who: dict = Depends(can_verify)):
    """Remove a part: its model, training photos and the copy in memory. QC inspectors and supervisors only.
    `purge_log=true` also deletes its inspection log rows, heatmaps and photos (otherwise history keeps them)."""
    check_name(name)
    if jobs.get(name, {}).get("state") in ("queued", "training"):
        raise HTTPException(409, f"'{name}' is training; wait for it to finish")
    path = MODELS / f"{name}.pt"
    if not path.exists() and name not in jobs and not (DATA / name).exists():
        raise HTTPException(404, f"unknown object '{name}'")
    with state_lock:
        models.pop(name, None)
        jobs.pop(name, None)
    path.unlink(missing_ok=True)
    shutil.rmtree(DATA / name, ignore_errors=True)
    removed = inspection_log.delete_object(name) if purge_log else 0
    return {"deleted": name, "log_rows_removed": removed, "by": who["username"]}


@app.post("/objects/{name}/predict")
def predict(name: str, file: UploadFile = File(...), heatmap: bool = True, log: bool = True):
    """Returns good / defective / unsure / retake, the score, time taken and a heatmap PNG (base64).
    log=false (used by evaluation runs) keeps the photo out of the inspection log and shift report."""
    m = get_model(check_name(name))
    data = read_upload(file)
    decode_image(data, file.filename or "upload")  # reject bad files with a clear 400
    r = m.predict(io.BytesIO(data))
    out = {"label": r["label"], "score": round(r["score"], 4), "ms": round(r["ms"], 1),
           "threshold": round(m.thr, 4), "unsure_band": [round(m.low, 4), round(m.high, 4)],
           "reasons": r["reasons"], "regions": r["regions"], "grid": r["grid"], "grid_size": r["grid_size"],
           "backbone": m.fx.name, "rotations": m.rotations, "strictness": m.strictness,
           "closest_good": r.get("closest_good")}
    buf = io.BytesIO()
    overlay(io.BytesIO(data), r["map"], buf, vmax=m.high * 1.5)
    png = buf.getvalue()
    photo = None
    if log:
        img = decode_image(data, "photo")
        img.thumbnail((640, 640))
        jb = io.BytesIO()
        img.save(jb, format="JPEG", quality=88)
        photo = jb.getvalue()
    out["inspection_id"] = inspection_log.add(name, r["label"], r["score"], m.thr, r["ms"], m.fx.name,
                                              r["reasons"], png, photo) if log else None
    if heatmap:
        out["heatmap_png_base64"] = base64.b64encode(png).decode()
    return out


@app.post("/objects/{name}/feedback")
def feedback(name: str, file: UploadFile = File(...), inspection_id: int | None = Form(None)):
    """Operator marks a false alarm as good. Learned instantly, no retraining.
    Optional `inspection_id` (from /predict) marks that log entry as corrected."""
    name = check_name(name)
    m = get_model(name)
    data = read_upload(file)
    decode_image(data, file.filename or "upload")
    with state_lock:
        m.add_good(io.BytesIO(data))
        m.save(MODELS / f"{name}.pt")
    if inspection_id is not None:
        inspection_log.mark_corrected(inspection_id, name)
    return {"learned": True, "new_label": m.predict(io.BytesIO(data))["label"]}


# ---------- "enough photos?" meter for webcam capture ----------

@app.post("/meter")
def meter_start():
    """Start a capture session. Send each captured photo to /meter/{id} to see if there are enough."""
    with meter_lock:
        now = time.time()
        for k in [k for k, v in meters.items() if now - v.used > METER_TTL_S]:
            del meters[k]
        while len(meters) >= MAX_METERS:  # drop the least recently used session
            del meters[min(meters, key=lambda k: meters[k].used)]
        sid = secrets.token_hex(8)
        meters[sid] = SampleMeter(get_fx("resnet18"))  # always the fast backbone: this runs on every capture
    return {"session": sid, **meters[sid].status()}


@app.post("/meter/{sid}")
def meter_add(sid: str, file: UploadFile = File(...)):
    with meter_lock:
        meter = meters.get(sid)
    if meter is None:
        raise HTTPException(404, "unknown or expired capture session; start a new one")
    if meter.status()["photos"] >= METER_MAX_PHOTOS:
        raise HTTPException(413, f"a capture session holds at most {METER_MAX_PHOTOS} photos")
    data = read_upload(file)
    decode_image(data, file.filename or "upload")
    return meter.add(io.BytesIO(data))


@app.delete("/meter/{sid}")
def meter_end(sid: str):
    with meter_lock:
        meters.pop(sid, None)
    return {"ended": True}


# ---------- inspection log and shift report ----------

def parse_since(hours: float | None):
    """None or 0 = all time; otherwise the last `hours` hours (up to a year)."""
    if not hours:
        return None
    if not 0 < hours <= 24 * 365:
        raise HTTPException(400, "hours must be between 0 (all time) and 8760")
    return time.time() - hours * 3600


@app.get("/log")
def log_list(object: str | None = None, hours: float | None = None, limit: int = 100):
    if object:
        check_name(object)
    return inspection_log.rows(object, parse_since(hours), max(1, min(limit, 1000)))


@app.get("/log.csv", response_class=PlainTextResponse)
def log_csv(object: str | None = None, hours: float | None = None):
    if object:
        check_name(object)
    return PlainTextResponse(inspection_log.csv_text(object, parse_since(hours)), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="inspections.csv"'})


@app.get("/log/{rid}/heatmap.png")
def log_heatmap(rid: int):
    p = inspection_log.heatmap_path(rid)
    if not p:
        raise HTTPException(404, "no heatmap for that inspection")
    return FileResponse(p, media_type="image/png")


@app.get("/report")
def report(object: str | None = None, hours: float | None = None):
    if object:
        check_name(object)
    return inspection_log.report(object, parse_since(hours))


@app.get("/report.html", response_class=HTMLResponse, include_in_schema=False)
def report_page(object: str | None = None, hours: float | None = 12):
    """One-page shift report, ready to print or save as PDF."""
    if object:
        check_name(object)
    r = inspection_log.report(object, parse_since(hours))
    when = lambda t: time.strftime("%d %b %Y %H:%M", time.localtime(t)) if t else "-"
    c = r["counts"]
    flagged = "".join(
        f'<figure><img src="/log/{f["id"]}/heatmap.png" alt="heatmap {f["id"]}"><figcaption>#{f["id"]} '
        f'{html.escape(f["object"])} · {f["label"].upper()} · {f["score"]:.2f}'
        f'{" · corrected" if f["corrected"] else ""}</figcaption></figure>' for f in r["recent_flagged"])
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shift report</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%2324313c'/%3E%3Ccircle cx='8' cy='8' r='3' fill='%23f2c200'/%3E%3C/svg%3E">
<style>@font-face{{font-family:Barlow;font-weight:400;src:url(/static/vendor/fonts/barlow-latin-400-normal.woff2)}}
@font-face{{font-family:Barlow;font-weight:700;src:url(/static/vendor/fonts/barlow-latin-700-normal.woff2)}}
body{{font:15px/1.5 Barlow,system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}}
h1{{margin:0}} .muted{{color:#555}} table{{border-collapse:collapse;margin:16px 0}} td,th{{border:1px solid #ccc;padding:6px 12px;text-align:left}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}} figure{{margin:0}} img{{width:100%;border-radius:6px}}
figcaption{{font-size:12px;color:#444}} @media print{{button{{display:none}}}}</style></head><body>
<h1>Inspection shift report</h1>
<p class="muted">Object: <b>{html.escape(r["object"])}</b> · {f"last {hours:g} h" if hours else "all time"} · {when(r["first"])} to {when(r["last"])}</p>
<button onclick="print()">Print / save as PDF</button>
<table><tr><th>Parts inspected</th><td>{r["total"]}</td></tr>
<tr><th>Good</th><td>{c["good"]}</td></tr><tr><th>Defective</th><td>{c["defective"]} ({r["defect_rate"]:.1%})</td></tr>
<tr><th>Sent to a human (unsure)</th><td>{c["unsure"]}</td></tr><tr><th>Photo retakes</th><td>{c["retake"]}</td></tr>
<tr><th>Operator corrections</th><td>{r["operator_corrections"]}</td></tr>
<tr><th>Speed</th><td>avg {r["avg_ms"]} ms, slowest {r["max_ms"]} ms per photo</td></tr></table>
<h2>Recent flagged parts</h2><div class="grid">{flagged or '<p class="muted">None.</p>'}</div>
<p class="muted">Full list: <a href="/log.csv{('?object=' + r['object']) if object else ''}">download CSV</a></p></body></html>"""
    return HTMLResponse(page)


# web UI: page at /, other assets under /static (not mounted at / so unknown API paths still 404 as before)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


# ---------- logins (three roles) ----------

class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/auth/login")
def auth_login(body: LoginBody):
    got = users.login(body.username, body.password)
    if not got:
        raise HTTPException(401, "Wrong username or password.")
    token, s = got
    return {"token": token, "username": s["username"], "role": s["role"], "role_name": ROLES[s["role"]],
            "display": s["display"]}


@app.get("/auth/me")
def auth_me(authorization: str | None = Header(None)):
    s = users.who(bearer(authorization))
    if not s:
        raise HTTPException(401, "Not logged in.")
    return {"username": s["username"], "role": s["role"], "role_name": ROLES[s["role"]], "display": s["display"]}


@app.post("/auth/logout")
def auth_logout(authorization: str | None = Header(None)):
    users.logout(bearer(authorization))
    return {"ok": True}


# ---------- human verification (QC inspector) ----------

@app.get("/verify/queue")
def verify_queue(object: str | None = None, limit: int = 50, who: dict = Depends(can_verify)):
    if object:
        check_name(object)
    return inspection_log.queue(object, max(1, min(limit, 200)))


@app.get("/log/{rid}/photo.jpg")
def log_photo(rid: int):
    p = inspection_log.photo_path(rid)
    if not p:
        raise HTTPException(404, "no photo stored for that inspection")
    return FileResponse(p, media_type="image/jpeg")


class VerifyBody(BaseModel):
    decision: str
    note: str = ""


@app.post("/verify/{rid}")
def verify(rid: int, body: VerifyBody, who: dict = Depends(can_verify)):
    """The inspector's final call. 'good' also teaches the model that this photo is good (instant, no retraining)."""
    if body.decision not in ("good", "defective"):
        raise HTTPException(400, "decision must be 'good' or 'defective'")
    row = inspection_log.get(rid)
    if not row:
        raise HTTPException(404, "no such inspection")
    learned = False
    if body.decision == "good":
        p = inspection_log.photo_path(rid)
        if p:
            m = get_model(row["object"])
            with state_lock:
                m.add_good(p)
                m.save(MODELS / f"{row['object']}.pt")
            learned = True
    inspection_log.verify(rid, body.decision, who["username"], body.note)
    return {"id": rid, "decision": body.decision, "by": who["username"], "model_learned": learned}


# ---------- summary and assistant ----------

@app.get("/summary")
def summary():
    return inspection_log.summary()


@app.get("/assistant/status")
def assistant_status():
    return assistant.status()


class AskBody(BaseModel):
    message: str
    history: list[dict] = []
    lang: str = "en"   # "kn" = answer in Kannada


@app.post("/assistant")
def assistant_ask(body: AskBody):
    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "Ask a question.")
    detail = None
    rid = assistant.mentioned_id(msg)
    if rid:
        detail = inspection_log.get(rid)
    return assistant.ask(msg, body.history, inspection_log.summary(), inspection_log.rows(limit=15), detail,
                         lang=body.lang)


@app.get("/", include_in_schema=False)
def ui():
    return FileResponse(ROOT / "static" / "index.html")
