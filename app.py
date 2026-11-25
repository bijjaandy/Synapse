"""REST backend for the good-parts inspector.

Run:  uvicorn app:app --port 8000      Docs: http://localhost:8000/docs
"""
import base64
import io
import re
import threading
import time
import zipfile
from pathlib import Path

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from inspector import BACKBONES, WEIGHTS_DIR, FeatureExtractor, Inspector, list_images, overlay

ROOT = Path(__file__).parent
DATA, MODELS = ROOT / "data", ROOT / "models"
MAX_FILE_MB, MAX_IMAGES, MIN_IMAGES = 25, 1000, 5
NAME_RE = re.compile(r"^[a-z0-9_-]{1,40}$")
IMG_EXT = (".png", ".jpg", ".jpeg", ".bmp")

app = FastAPI(title="Good-Parts Inspector")
# shortcut: open CORS so a local frontend on any port works; restrict origins if this is ever deployed
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

extractors = {"resnet18": FeatureExtractor("resnet18")}  # one per backbone, shared by all objects; others load on first use
models: dict[str, Inspector] = {}
jobs: dict[str, dict] = {}       # per-object training status
train_lock = threading.Lock()    # one training at a time: a laptop CPU can't do two well
state_lock = threading.Lock()
fx_lock = threading.Lock()


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


def run_training(name, folder, backbone):
    job = jobs[name]
    log = lambda msg: job["log"].append(msg)
    with train_lock:
        job["state"], job["started"] = "training", time.time()
        try:
            if backbone not in extractors:
                log(f"loading {backbone} backbone...")
            m = Inspector(get_fx(backbone)).fit(list_images(folder), log=log)
            MODELS.mkdir(exist_ok=True)
            m.save(MODELS / f"{name}.pt")
            with state_lock:
                models[name] = m
            job.update(state="ready", train_s=round(time.time() - job["started"], 1))
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
def train(name: str, files: list[UploadFile] = File(...), backbone: str = Form("resnet18")):
    """Upload good-part photos (images and/or a .zip). Training starts in the background.
    Optional form field `backbone`: resnet18 (default, fast) or wide_resnet50 (bigger, slower)."""
    check_name(name)
    if backbone not in BACKBONES:
        raise HTTPException(400, f"backbone must be one of {', '.join(BACKBONES)}")
    if not (WEIGHTS_DIR / f"{backbone}.pth").exists():
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
    jobs[name] = {"state": "queued", "n_images": n, "backbone": backbone, "log": []}
    threading.Thread(target=run_training, args=(name, folder, backbone), daemon=True).start()
    return {"name": name, "n_images": n, "backbone": backbone, "state": "queued"}


@app.get("/objects/{name}/status")
def status(name: str):
    check_name(name)
    if name in jobs:
        return {"name": name, **jobs[name]}
    path = MODELS / f"{name}.pt"
    if path.exists():
        with state_lock:
            m = models.get(name)
        return {"name": name, "state": "ready", "backbone": m.fx.name if m else saved_backbone(path)}
    raise HTTPException(404, f"unknown object '{name}'")


@app.post("/objects/{name}/predict")
def predict(name: str, file: UploadFile = File(...), heatmap: bool = True):
    """Returns good / defective / unsure, the score, time taken and a heatmap PNG (base64)."""
    m = get_model(check_name(name))
    data = read_upload(file)
    decode_image(data, file.filename or "upload")  # reject bad files with a clear 400
    r = m.predict(io.BytesIO(data))
    out = {"label": r["label"], "score": round(r["score"], 4), "ms": round(r["ms"], 1),
           "threshold": round(m.thr, 4), "unsure_band": [round(m.low, 4), round(m.high, 4)]}
    if heatmap:
        buf = io.BytesIO()
        overlay(io.BytesIO(data), r["map"], buf, vmax=m.high * 1.5)
        out["heatmap_png_base64"] = base64.b64encode(buf.getvalue()).decode()
    return out


@app.post("/objects/{name}/feedback")
def feedback(name: str, file: UploadFile = File(...)):
    """Operator marks a false alarm as good. Learned instantly, no retraining."""
    name = check_name(name)
    m = get_model(name)
    data = read_upload(file)
    decode_image(data, file.filename or "upload")
    with state_lock:
        m.add_good(io.BytesIO(data))
        m.save(MODELS / f"{name}.pt")
    return {"learned": True, "new_label": m.predict(io.BytesIO(data))["label"]}


# web UI: page at /, other assets under /static (not mounted at / so unknown API paths still 404 as before)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/", include_in_schema=False)
def ui():
    return FileResponse(ROOT / "static" / "index.html")
