"""Browser smoke test for the Next.js UI (http://localhost:3000) against the backend (http://localhost:8000).

Start both servers first:
    uvicorn app:app --port 8000                 (project folder)
    npx next start -p 3000                      (frontend folder)
Then:
    python ui_smoke_test.py                     (add --headed to watch it)
    python ui_smoke_test.py --cleanup           (also removes the smoke_washer part afterwards)

Trains a toy part "smoke_washer" through the page, inspects good / scratched / dark photos, sends feedback,
opens the 2D view, runs an evaluation, checks the objects tab, history and the webcam meter.
Screenshots go to ui_test_shots/. Ends with every console and page error seen.
"""
import shutil
import sqlite3
import sys
import tempfile
import traceback
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from test_inspector import part

URL = "http://localhost:3000"
PART = "smoke_washer"
HERE = Path(__file__).resolve().parent
SHOTS = HERE / "ui_test_shots"


def make_photos(root):
    rng = np.random.default_rng(7)
    train, good, bad = root / "train", root / "eval_good", root / "eval_scratched"
    for d in (train, good, bad):
        d.mkdir()
    for i in range(30):
        part(rng)[0].save(train / f"good_{i:02d}.png")
    for i in range(6):
        part(rng)[0].save(good / f"good_{i:02d}.png")
        part(rng, scratch=True)[0].save(bad / f"scratch_{i:02d}.png")
    one_good = part(rng)[0]
    one_good.save(root / "inspect_good.png")
    part(rng, scratch=True)[0].save(root / "inspect_scratched.png")
    dark = (np.asarray(one_good, np.float32) * 0.2).clip(0, 255).astype(np.uint8)
    Image.fromarray(dark).save(root / "inspect_dark.png")
    return sorted(train.glob("*.png")), good, bad


def cleanup():
    shutil.rmtree(HERE / "models" / PART, ignore_errors=True)
    for f in (HERE / "models").glob(f"{PART}.*"):
        f.unlink()
    shutil.rmtree(HERE / "data" / PART, ignore_errors=True)
    db = HERE / "logs" / "inspections.db"
    if db.exists():
        with sqlite3.connect(db) as c:
            ids = [r[0] for r in c.execute("SELECT id FROM inspections WHERE object=?", (PART,))]
            c.execute("DELETE FROM inspections WHERE object=?", (PART,))
        for i in ids:
            (HERE / "logs" / "heatmaps" / f"{i}.png").unlink(missing_ok=True)
            (HERE / "logs" / "photos" / f"{i}.jpg").unlink(missing_ok=True)
        print(f"cleanup: removed {PART} model/data and {len(ids)} log rows")


def main():
    headed = "--headed" in sys.argv
    SHOTS.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="ui_smoke_"))
    train_files, good_dir, bad_dir = make_photos(tmp)
    errors, failures = [], []

    def step(name, fn):
        print(f"\n--- {name}")
        try:
            fn()
        except Exception as e:  # keep going so one broken step doesn't hide the others
            failures.append(name)
            print(f"FAILED: {type(e).__name__}: {str(e).splitlines()[0]}")
            if "--trace" in sys.argv:
                traceback.print_exc()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed, args=["--use-fake-device-for-media-stream",
                                                               "--use-fake-ui-for-media-stream"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, permissions=["camera"])
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(URL, wait_until="networkidle")

        def badge():
            page.wait_for_function("document.querySelector('.topbar-demo')?.textContent !== 'CHECKING SERVER'", timeout=15000)
            print("badge:", page.inner_text(".topbar-demo"))

        def untrained():
            page.wait_for_function("[...document.querySelectorAll('#object-select option')].some(o => o.text.includes('(not trained)'))", timeout=15000)
            options = page.locator("#object-select option").all()
            target = next(o for o in options if "(not trained)" in o.inner_text())
            part_id, label = target.get_attribute("value"), target.inner_text()
            print("dropdown:", [o.inner_text() for o in options][:4], "...")
            page.select_option("#object-select", part_id)
            page.set_input_files("#inspect input[type=file]", str(tmp / "inspect_good.png"))
            page.wait_for_selector(".result-error", timeout=15000)
            print("message:", page.inner_text(".result-error").replace(chr(10), " | "))
            page.locator(".result-panel").screenshot(path=str(SHOTS / "untrained.png"))
            page.click(".result-error >> text=Go to Train")
            page.wait_for_timeout(1500)
            in_view = page.evaluate("(() => { const r = document.getElementById('train').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })()")
            tile = page.locator(".object-tile.active").inner_text().replace(chr(10), " ") if page.locator(".object-tile.active").count() else "-"
            print(f"go to train: #train in view={in_view}, selected tile={tile!r} (was {label!r}), message gone={page.locator('.result-error').count() == 0}")

        def train():
            page.fill("#custom-part", PART)
            page.click(".custom-part button")
            page.set_input_files("#train input[type=file]", [str(f) for f in train_files])
            page.select_option(".train-options select", "resnet18")
            page.click(".button-orange")
            page.wait_for_selector(".status-icon.done", timeout=180_000)
            print("status:", " | ".join(page.inner_text(".train-status").split("\n")))
            print("log last line:", page.inner_text(".train-log").strip().splitlines()[-1])

        def inspect_one(name, path):
            page.set_input_files("#inspect input[type=file]", str(path))
            page.wait_for_selector(".verdict:not(.waiting)", timeout=30000)
            page.wait_for_timeout(3500)
            print(f"{name:10s} verdict: {page.inner_text('.verdict strong')!r:20s} pins: {page.locator('.pin-label').count()}")
            page.locator(".inspect-workspace").screenshot(path=str(SHOTS / f"inspect_{name}.png"))

        def inspect():
            page.select_option("#object-select", PART)
            for name in ("good", "scratched", "dark"):
                inspect_one(name, tmp / f"inspect_{name}.png")

        def feedback():
            inspect_one("scratched2", tmp / "inspect_scratched.png")
            page.click(".feedback-button")
            page.wait_for_selector(".feedback-done", timeout=30000)
            print("feedback:", page.inner_text(".feedback-done").strip())

        def view2d():
            page.click("text=2D heatmap")
            page.locator(".view-switch button").nth(2).click()
            page.wait_for_timeout(800)
            page.locator(".result-panel").screenshot(path=str(SHOTS / "result_2d_layers.png"))
            print("2D layers shown:", page.locator(".live-layer").count(), "layer images")

        def evaluation():
            page.click("#evaluation-tab")
            inputs = page.locator(".evaluation-panel input[type=file]")
            inputs.nth(0).set_input_files(str(good_dir))
            inputs.nth(1).set_input_files(str(bad_dir))
            page.click(".evaluation-run")
            page.wait_for_selector(".confusion-summary", timeout=120_000)
            for row in page.locator(".confusion-summary tr").all():
                print("  ", " | ".join(c.strip() for c in row.inner_text().split("\t")))
            page.locator(".evaluation-panel").screenshot(path=str(SHOTS / "evaluation.png"))

        def objects():
            page.click("#objects-tab")
            card = page.locator(".object-status-card", has_text=PART)
            card.wait_for(timeout=10000)
            print("card:", " | ".join(card.inner_text().split("\n")))

        def history():
            page.locator("#history").scroll_into_view_if_needed()
            page.wait_for_timeout(1500)
            print("history rows:", page.locator(".history-table tbody tr").count())
            print("shift strip:", " | ".join(page.inner_text(".shift-strip").split("\n")))
            page.locator("#history").screenshot(path=str(SHOTS / "history.png"))

        def history_filters():
            links = lambda: " | ".join(page.locator(".history-actions a").nth(i).get_attribute("href") for i in range(2))
            print("parts in filter:", page.locator("#history-part option").all_inner_texts())
            page.select_option("#history-part", PART)
            page.select_option("#report-range", "1")
            page.wait_for_timeout(1500)
            print("part + 1 h: rows", page.locator(".history-table tbody tr").count(),
                  "| strip:", " | ".join(page.inner_text(".shift-strip").split(chr(10))))
            print("  links:", links())
            page.select_option("#report-range", "all")
            page.wait_for_timeout(800)
            print("all time links:", links())
            page.select_option("#history-part", "")
            page.select_option("#report-range", "12")

        def auto_model():
            page.locator("#train").scroll_into_view_if_needed()
            page.select_option(".train-options select", "auto")
            page.click(".button-orange")
            page.wait_for_selector(".status-icon.learning", timeout=10000)
            page.wait_for_selector(".status-icon.done", timeout=300_000)
            print("status:", " | ".join(page.inner_text(".train-status").split(chr(10))))
            page.locator(".train-footer").screenshot(path=str(SHOTS / "train_auto.png"))

        def webcam():
            page.locator("#train").scroll_into_view_if_needed()
            page.click("text=Capture good parts with the webcam")
            page.wait_for_timeout(2000)
            page.click(".live-cam-train >> text=Capture 10")
            page.wait_for_timeout(12000)
            print("meter:", " | ".join(page.inner_text(".cam-meter").split("\n")))
            page.locator(".live-cam-train").screenshot(path=str(SHOTS / "webcam_meter.png"))

        for name, fn in [("a. top bar badge", badge), ("a2. untrained part", untrained), ("b. train", train), ("c. inspect", inspect),
                         ("d. feedback", feedback), ("e. 2D view", view2d), ("f. evaluation", evaluation),
                         ("g. objects tab", objects), ("h. history", history), ("h2. history part filter + time range", history_filters),
                         ("k. auto model summary", auto_model), ("i. webcam", webcam)]:
            step(name, fn)
        page.screenshot(path=str(SHOTS / "full_page.png"), full_page=True)
        browser.close()

    print("\n--- j. console and page errors:", len(errors))
    for e in errors:
        print("  ", e)
    shutil.rmtree(tmp, ignore_errors=True)
    if "--cleanup" in sys.argv:
        cleanup()
    print("\nSteps failed:", ", ".join(failures) if failures else "none", "| screenshots in", SHOTS)
    sys.exit(1 if failures or errors else 0)


if __name__ == "__main__":
    main()
