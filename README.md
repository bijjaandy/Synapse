# Netrix IQ: Learn from perfection. Detect the rest.

Good-Parts Inspector for SYNAPSE 2.0, PS #12.

Learns from photos of good parts only. Never sees a real defect, even to set the threshold.

## Setup (do this while online, before the hackathon)
    python -m venv .venv
    .venv\Scripts\activate                   # Windows  (macOS/Linux: source .venv/bin/activate)
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # CPU-only torch, smaller
    pip install -r requirements.txt
    python download_weights.py resnet18 wide_resnet50   # saves weights/<backbone>.pth; after this no internet is needed
    python test_inspector.py                 # ML self-check, should print SELF-TEST PASSED
    pytest -q                                # API tests + feature tests (rotation, retake, pins, auto model)

## Netrix IQ app (pages, logins, local AI)

| Page | Who can open it | What happens there |
|---|---|---|
| `/` landing | everyone | Scroll-driven 3D walk through the pipeline (photo → patches → memory → compare → decide), how it works, who it's for, measured numbers |
| `/login` | everyone | Who uses it and why; one-click demo logins |
| `/dashboard` | Operator, QC Inspector, Supervisor | Train a part (upload or webcam) and inspect parts |
| `/evaluation` | QC Inspector, Supervisor | Human verification queue, the local AI assistant, and folder evaluation |
| `/objects` | everyone signed in | Object library: every part and its model |
| `/history` | everyone signed in | Inspection log, filters, CSV and shift report |
| `/summary` | Supervisor | Total evaluated, results per part, people-in-the-loop numbers, speed |

Demo logins (created on first start in `users.json`, which is git-ignored; passwords are stored salted with PBKDF2):
`operator / operator123`, `inspector / inspector123`, `supervisor / supervisor123`.

**Local AI assistant (Ollama, offline).** Install Ollama from https://ollama.com while online, then:
```
ollama pull qwen2.5:1.5b
```
Keep Ollama running (it starts in the tray on Windows). Use another model with `set NETRIX_LLM=llama3.2:3b` before starting the backend.
Without Ollama the assistant still answers counts and how-it-works questions from the log ("offline answer").

New endpoints: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `GET /verify/queue`, `POST /verify/{id}`
(`good` also teaches the model), `GET /log/{id}/photo.jpg`, `GET /summary`, `GET /assistant/status`, `POST /assistant`.

Browser test of all pages: start both servers, then `python netrix_ui_test.py --cleanup` (screenshots in `netrix_shots/`).

## Main UI: the Sightline frontend (Next.js, in `frontend/`)
The designed UI talks to the same FastAPI backend. Two terminals:

    uvicorn app:app --port 8000                       # backend (model), from the project folder
    cd frontend
    npm install                                       # once, while online
    npm run build && npx next start -p 3000           # or: npm run dev
    # open http://localhost:3000  (use localhost: browsers only allow the webcam there)

The frontend calls `http://localhost:8000`; set `NEXT_PUBLIC_API_URL` before building to change it.
Everything runs offline after `npm install`. The simpler page at http://localhost:8000/ still works as a backup.

What is live in it: training with auto model choice, rotation and the real log; webcam capture with the
"enough photos?" meter; inspection with the 3D view (three.js + anime.js), 2D heatmap and layers (score map,
mask); GOOD / DEFECTIVE / UNSURE / RETAKE with reasons and pins; "This was actually good"; evaluation on
labelled folders (not added to the shift log); object library; history, CSV and shift report.

## Web UI (backup, served by the backend)
    uvicorn app:app --port 8000              # then open http://localhost:8000/   (API docs at /docs)

One page (`static/index.html` + `static/stage3d.js`, plain HTML + JS, no build step). Three.js, anime.js, Motion
and the Barlow fonts are bundled in `static/vendor/` (licences in `LICENSES.txt`), so it works with no internet.

1. **Part**: pick a trained part, or type a new name.
2. **Teach it good parts**: good photos and/or a .zip. Model: **auto** (default) times both models on this laptop
   and picks the most accurate one that stays under half the PS limits; or force fast / most accurate.
   Tick "Part can lie at any angle" for screws, nuts and similar: each photo is also checked at 8 angles.
3. **Inspect a photo**: drop or choose one. The **3D view** turns the photo into a surface: a scan sweeps across,
   unusual areas rise and glow red, and numbered pins drop onto the worst spots. Drag to rotate, scroll to zoom,
   "Flat view" shows photo + heatmap. Below: score against the line (amber band = sent to a person), where the
   defects are, time in ms. "This was actually good" teaches the model instantly and marks the log entry.
   **RETAKE PHOTO** appears when the photo itself is the problem (too dark/bright, blurry, or most of the
   picture looks different), instead of a false DEFECTIVE.
4. **Webcam**: Start webcam, capture good samples. The **meter** shows when new photos stop teaching the model
   anything new (12+ photos and a flat line). Then Train on captured, Inspect now.
5. **This shift**: counts for the last 12 hours, CSV download and a printable shift report.

The 3D view is a relief made from one photo plus the model's scores. It shows *where* the model sees a problem;
it is not a 3D scan of the part's real shape. The webcam only works on `http://localhost` (or https).

### Live demo script (about 4 minutes)
1. Start the server, open http://localhost:8000/.
2. New part `bottle`, upload `mvtec_ad/bottle/train/good` as a .zip, Model = auto, Train. Point at the log:
   it timed both models on this laptop and chose one.
3. Drop a `test/good` photo: GOOD. Drop a `test/broken_large` photo: the scan sweeps, the crack rises red,
   a pin lands on it, DEFECTIVE. Rotate the view. Point at the time in ms.
4. Drop a very dark or blurry photo: RETAKE PHOTO with the reason, not a false alarm.
5. On a false alarm press "This was actually good": label changes, no retraining.
6. Webcam: new part (e.g. `mug`), capture until the meter says Enough, Train, Inspect with a sticker on it.
7. Open the shift report: every check is logged with its heatmap.

## Backend

| Method | Path | What it does |
|---|---|---|
| GET  | /health | server is up |
| GET  | /objects | trained objects and their state |
| POST | /objects/{name}/train | field `files` (images and/or .zip); optional `backbone` (`auto` default, `resnet18`, `wide_resnet50`) and `rotations` (1-8); trains in background, returns 202 |
| GET  | /objects/{name}/status | queued / training / ready / failed, backbone (with the auto timing report) and training log |
| POST | /objects/{name}/predict | field `file`; label (good/defective/unsure/retake), score, ms, `reasons`, `regions` (pin positions), `grid` (scores for the 3D view), `inspection_id`, heatmap PNG as base64 |
| POST | /objects/{name}/feedback | field `file`, optional `inspection_id`; operator marks a false alarm as good, learned instantly |
| POST | /meter, /meter/{id} | start a capture session; send each captured photo to get the "enough samples?" meter |
| GET  | /log, /log.csv, /log/{id}/heatmap.png | inspection log (filters `object`, `hours`) |
| GET  | /report, /report.html | shift summary as JSON, or a printable page |

Object names: lowercase letters, digits, `_` or `-`. Models are saved in `models/`, uploaded photos in `data/`,
the inspection log and its heatmaps in `logs/`.

## MVTec AD (the 15 objects)
Download MVTec AD and extract it so you have mvtec_ad/bottle/train/good, mvtec_ad/bottle/test/..., etc.

    python check_dataset.py mvtec_ad         # confirms all 15 categories and prints image counts

    python run.py train   --data mvtec_ad/bottle --model bottle.pt
    python run.py eval    --data mvtec_ad/bottle --model bottle.pt
    python run.py predict --image some.png --model bottle.pt --heatmap out.png
    python run.py feedback --image false_alarm.png --model bottle.pt   # operator correction, instant
    python run.py bench   --root mvtec_ad                              # all 15 -> results.csv + summary
    python run.py bench   --root mvtec_ad --backbone wide_resnet50 --only screw,pill --out wrn.csv

Options: `--backbone resnet18|wide_resnet50`, `--coreset 0.01`, `--band 0.5` (unsure band half-width in std-devs
of good scores; 0 = always decide), `--q 0.95` (threshold quantile of held-out good scores), `--selfcheck`
(also log how many fake defects get flagged; slower), `--only` (comma-separated categories, bench), `--out` (bench CSV).
A model file remembers its backbone, so eval/predict/feedback and the API load the right one automatically.

The bench ends with a summary: per category image/pixel AUROC, accuracy, defect recall and false alarm rate
(plain yes/no at the threshold), train seconds and ms per image; then the means, max train seconds and the
slowest single image in ms, and flags any category over the 10-minute or 1-second limit.

## How it works
1. Pretrained ResNet-18 or Wide-ResNet-50 (layer2 + layer3) turns each image into 28x28 patch features.
2. Greedy coreset keeps ~1% of patches as the memory bank ("what good looks like").
3. Score = distance of the most unusual patch to its nearest good patch; the heatmap shows where.
4. Threshold: 20% of good images are held out and scored; the threshold is the 95th percentile (`q`) of
   those good scores. No defect images, real or fake, are used for it (this raised MVTec accuracy 0.70 -> 0.81).
   Optional self-check: fake defects (cut-paste, scratch, stain) are made from the held-out images and the
   log reports what share of them the threshold catches.
   Small sets (under 40 photos, e.g. a webcam session): instead of holding out 20%, every photo is scored by a
   memory built without it (4 folds), and the final memory uses all photos with at least 2000 patches.
   On 12-photo toy sets this cut false alarms from 18% to 2% with the same defect catch rate.
5. Output is good / defective / unsure (unsure = send to a human). The unsure band is narrow: threshold
   plus/minus `band` x the spread of good validation scores.
6. Retake check: brightness and sharpness are compared with the training photos, and if more than half of the
   photo scores above the threshold the problem is the whole picture (wrong object, angle, lighting), not a
   local defect.
7. Rotation (optional): each photo is also scored at N evenly spaced angles and the best-matching angle wins;
   the heatmap is turned back to line up with the original photo.
8. Auto model: on this computer, times feature extraction, memory search and memory building for each model
   with the real photo count, and picks the most accurate one estimated under half the PS limits.
