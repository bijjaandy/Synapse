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

A `.venv` keeps the project's packages separate, but it isn't required: the system Python works too (tested on
Python 3.13). Whichever you use, start the backend and run the tests with that same Python.
Parts trained before the blur-check fix show "Retrain recommended" in the Object library; their blur check stays
off until you retrain them with the same photos.

## Netrix IQ app (pages, logins, local AI)

| Page | Who can open it | What happens there |
|---|---|---|
| `/` landing | everyone | Dark-forest landing: isometric 3D hero (three.js + bloom), scroll-driven walk through the five layers of one inspection, what it checks, how it works, measured results |
| `/login` | everyone | Who uses it and why; one-click demo logins |
| `/train` | Operator, QC Inspector, Supervisor | Products list, add photos (upload, folder, zip or webcam) with a photo-quality check, train |
| `/inspect` | Operator, QC Inspector, Supervisor | Inspect from a photo, the webcam or conveyor mode: 3D view, 2D heatmap, layer map, closest good part, Ask AI why (`/dashboard` redirects here) |
| `/evaluation` | QC Inspector, Supervisor | Human verification queue, the local AI assistant, and folder evaluation |
| `/objects` | everyone signed in | Object library (grid or gallery): every product, its model, strictness, export/import, and a detail panel with its photos and numbers |
| `/history` | everyone signed in | Inspection log, filters, CSV and shift report |
| `/summary` | Supervisor | All-time totals, inspections per hour, results per part, people-in-the-loop numbers, speed |

Demo logins (created on first start in `users.json`, which is git-ignored; passwords are stored salted with PBKDF2):
`operator / operator123`, `inspector / inspector123`, `supervisor / supervisor123`.

**Local AI assistant (Ollama, offline).** Install Ollama from https://ollama.com while online, then:
```
ollama pull qwen2.5:1.5b
```
Keep Ollama running (it starts in the tray on Windows). Use another model with `set NETRIX_LLM=llama3.2:3b` before starting the backend.
Without Ollama the assistant still answers counts and how-it-works questions from the log ("offline answer").

New endpoints: `DELETE /objects/{name}` (QC inspector or supervisor; `?purge_log=true` also deletes its history), `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `GET /verify/queue`, `POST /verify/{id}`
(`good` also teaches the model), `GET /log/{id}/photo.jpg`, `GET /summary`, `GET /assistant/status`, `POST /assistant`.

Browser test of all pages: start both servers, then `python netrix_ui_test.py --cleanup` (screenshots in `netrix_shots/`).

### Newer features

**Products.** A product has a name, an optional SKU and a description (`POST /products`, `PATCH /products/{id}` for QC
inspectors and supervisors); its id comes from the name and never changes. *Export* downloads one zip with the model,
`product.json` and the good photos (`GET /objects/{id}/export.zip`); *Import product* on another laptop accepts that zip
(`POST /objects/import`, 409 if the id already exists).

**Closest good part.** `/predict` also returns `closest_good`, the index of the training photo nearest to this one. On
Inspect, *Compare with closest good part* (2D view) shows both side by side; the photo comes from
`GET /objects/{name}/good/{index}.jpg`.

**Ask AI why and Kannada.** After an inspection, the robot button asks the local assistant to explain that inspection
(operators get the answer in place; QC inspectors and supervisors open Evaluation). Answers can be read aloud; while one
is being read, the speaker button turns into *Stop*. The EN / ಕನ್ನಡ switch in the top bar sets the spoken verdicts and
the assistant's language. The backend sends the assistant numbers already rounded (scores and the line to 2 decimals,
ms whole, percentages to 1 decimal) and its rules tell it to round too.

**Verification with the same heatmap.** Each logged inspection now also stores its score grid
(`logs/grids/<id>.json`, served at `GET /log/{id}/grid.json`), so the Evaluation queue draws *Where it differs* with
the same overlay as Inspect (clear where the part looks good). Older checks without a stored photo show their saved
heatmap full width with "photo not stored for this older check". `/verify/queue` items carry `has_photo` and `has_grid`.

**Demo quick-load.** With *Bottle* selected under Inspect → Upload, *Try a good sample* / *Try a defective sample*
inspect `frontend/public/demo/bottle_good.jpg` / `bottle_defect.jpg` (a training photo, and the same photo with a drawn
crack) through the normal path, so they are logged like an upload.

### Line features

**Voice.** After each inspection on the dashboard the verdict is spoken with the browser's built-in voices (offline on
Windows): "Good." / "Defective, middle left." (the first spot's position, as under *Where*) / "Unsure, please check." /
"Retake the photo: too dark compared with the training photos." The speaker button next to *3D view / 2D heatmap /
Layer map* mutes it; the choice is remembered in the browser (`localStorage` `netrix.voice`, on by default). A new
verdict cuts off one still being spoken. The button is hidden in browsers without speech.

**Strictness per part.** In the Object library every trained part has a slider from *Lenient 0.8* through *Normal 1.0*
to *Strict 1.25* (QC inspectors and supervisors; operators see the value). It is saved when you let go. The line the
model decides with becomes `threshold / strictness`, and the unsure band moves with it: strict flags more (fewer missed
defects), lenient flags less (fewer false alarms). The calibrated threshold itself is kept, so 1.0 is always "as
trained"; the "retake photo" check is not affected. Saved in the model file (`strictness`; older files load as 1.0)
and kept when the part is retrained. API: `PUT /objects/{name}/strictness` with `{"factor": 0.8..1.25}`
(400 outside that range, 403 for operators); `strictness` is also returned by `/status` and `/predict`.

**Judge test mode (folder in, CSV out).** For a test set without labels:
```
python judge.py bottle test_photos --out results.csv
```
Runs the trained model on this laptop (no server needed) on every image in the folder and its sub-folders, writes
`file, label, score, threshold, ratio, ms, where, reasons` (ratio = score / threshold, where = defect positions), then
prints the counts and the average and slowest ms. The same is on the **Evaluation** page as *Judge test mode*: pick a
folder, each photo goes through `/predict?log=false` (so it stays out of the history) with a progress bar, a results
table (thumbnail, file, verdict, score, ms) that can be sorted by verdict, and *Download CSV* with the same columns.

**Conveyor mode.** On the dashboard, *Use the webcam* under Inspect, then switch on *Conveyor mode* with the belt empty.
The page compares each video frame with the previous one on a small 64x48 grey copy; when part of the picture changes
(a part coming in) and then stays still for 0.5 s, it captures the frame and inspects it like *Inspect this frame*
(logged, and spoken). It then waits for the next change; when the belt is empty again nothing is inspected. A strip shows
inspected / good / defective / unsure / retake and parts per minute, with the last 5 verdicts as coloured chips.
*Motion sensitivity* sets how much of the picture must change (10 = 0.5 %, 6 = 2.5 %, 1 = 5 %) and shows the current
motion. *Inspect now* inspects the current frame by hand. Keep the camera and the lighting fixed.

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
| PUT  | /objects/{name}/strictness | JSON `{"factor": 0.8..1.25}`, QC inspector or supervisor; line = threshold / factor (see Strictness per part) |
| GET  | /objects/{name}/stats | inspections, result mix, defect rate, average and slowest ms for one part |
| GET  | /objects/{name}/good/{index}.jpg | one training photo (the `closest_good` from /predict) |
| POST, PATCH | /products, /products/{id} | new product / edit its name, SKU or description |
| GET, POST | /objects/{id}/export.zip, /objects/import | move a product (model + photos) to another laptop |
| GET  | /log/{id}/photo.jpg, /log/{id}/grid.json | the stored photo and score grid of one inspection |
| GET, POST | /verify/queue, /verify/{id} | QC verification queue (`has_photo`, `has_grid`) and the final call |
| GET  | /summary | all-time totals, per part, people in the loop, speed |
| GET, POST | /assistant/status, /assistant | local AI status and questions |

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
