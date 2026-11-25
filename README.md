# Good-Parts Inspector (SYNAPSE 2.0, PS #12)

Learns from photos of good parts only. Never sees a real defect, even to set the threshold.

## Setup (do this while online, before the hackathon)
    python -m venv .venv
    .venv\Scripts\activate                   # Windows  (macOS/Linux: source .venv/bin/activate)
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # CPU-only torch, smaller
    pip install -r requirements.txt
    python download_weights.py resnet18 wide_resnet50   # saves weights/<backbone>.pth; after this no internet is needed
    python test_inspector.py                 # ML self-check, should print SELF-TEST PASSED
    pytest -q                                # API tests

## Web UI
    uvicorn app:app --port 8000              # then open http://localhost:8000/   (API docs at /docs)

One page (`static/index.html`, plain HTML + JS, no build step, works offline):
1. **Object**: pick a trained object, or type a new name and press "Use this name".
2. **Train**: choose good photos and/or a .zip, pick a backbone (resnet18 = fast default, wide_resnet50 = more
   accurate, ~4x slower), press Train. State, backbone, training log and train time update every second.
3. **Inspect**: drop or choose one photo. Shows photo + heatmap, a big GOOD / DEFECTIVE / UNSURE label,
   score, threshold, unsure band and time in ms. "This was actually good" teaches the model instantly.
4. **Webcam**: "Use webcam" -> "Capture good sample" (or burst of 10) -> "Train on captured" -> "Inspect now".
   The browser only allows the webcam on `http://localhost` or https, so open the page on the laptop itself.

### Live demo script (about 3 minutes)
1. Start the server, open http://localhost:8000/.
2. New object `bottle`, upload `mvtec_ad/bottle/train/good` as a .zip, press Train; point at the log and
   the train time (well under 10 minutes).
3. Drop `test/good/000.png` -> green GOOD. Drop a `test/broken_large` photo -> red DEFECTIVE, heatmap on the crack.
   Point at the time in ms (under 1 second).
4. Find an UNSURE or false alarm on a good photo, press "This was actually good" -> label changes, no retraining.
5. Webcam: new object (e.g. `mug`), capture ~20 good samples while turning the object slightly, Train on captured,
   then Inspect now with a sticker or scratch added.

## Backend

| Method | Path | What it does |
|---|---|---|
| GET  | /health | server is up |
| GET  | /objects | trained objects and their state |
| POST | /objects/{name}/train | upload good photos (images and/or a .zip, field `files`); optional form field `backbone` (`resnet18` default, or `wide_resnet50`); trains in background, returns 202 |
| GET  | /objects/{name}/status | queued / training / ready / failed, with backbone and training log |
| POST | /objects/{name}/predict | field `file`; returns label (good/defective/unsure), score, ms, heatmap PNG as base64 |
| POST | /objects/{name}/feedback | field `file`; operator marks a false alarm as good, learned instantly |

Object names: lowercase letters, digits, `_` or `-`. Models are saved in `models/`, uploaded photos in `data/`.

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
of good scores; 0 = always decide), `--only` (comma-separated categories, bench), `--out` (bench CSV).
A model file remembers its backbone, so eval/predict/feedback and the API load the right one automatically.

The bench ends with a summary: per category image/pixel AUROC, accuracy, defect recall and false alarm rate
(plain yes/no at the threshold), train seconds and ms per image; then the means, max train seconds and the
slowest single image in ms, and flags any category over the 10-minute or 1-second limit.

## How it works
1. Pretrained ResNet-18 or Wide-ResNet-50 (layer2 + layer3) turns each image into 28x28 patch features.
2. Greedy coreset keeps ~1% of patches as the memory bank ("what good looks like").
3. Score = distance of the most unusual patch to its nearest good patch; the heatmap shows where.
4. Threshold: 20% of good images are held out, fake defects (cut-paste, scratch, stain; half obvious, half
   subtle and partly transparent) are made from them, and the cut-off that best separates the two is chosen.
   No real defect images are used.
5. Output is good / defective / unsure (unsure = send to a human). The unsure band is narrow: threshold
   plus/minus `band` x the spread of good validation scores.
