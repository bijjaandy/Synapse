"""Browser test for the Netrix IQ pages (http://localhost:3000) against the backend (http://localhost:8000).

Start both servers first (see README), then:  python netrix_ui_test.py  [--headed] [--cleanup]
Walks: landing scroll -> login per role -> role guard -> dashboard train + inspect -> evaluation
(verification queue + assistant) -> objects -> history -> summary. Screenshots go to netrix_shots/.
"""
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

from ui_smoke_test import PART, cleanup, make_photos

URL = "http://localhost:3000"
SHOTS = Path(__file__).resolve().parent / "netrix_shots"


def main():
    SHOTS.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="netrix_ui_"))
    train_files, _good, _bad = make_photos(tmp)
    errors, failures = [], []

    def step(name, fn):
        print(f"\n--- {name}")
        try:
            fn()
        except Exception as e:
            failures.append(name)
            print(f"FAILED: {type(e).__name__}: {str(e).splitlines()[0]}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless="--headed" not in sys.argv,
                                    args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                                          "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, permissions=["camera"])
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        def login_as(role):
            page.goto(f"{URL}/login", wait_until="networkidle")
            page.locator(".login-role", has_text={"operator": "Line Operator", "inspector": "QC Inspector",
                                                  "supervisor": "Shift Supervisor"}[role]).locator(".login-demo").click()
            page.wait_for_url("**/dashboard", timeout=15000)
            page.wait_for_selector(".netrix-user", timeout=10000)
            print(f"{role}: nav =", page.locator(".netrix-topbar nav a").all_inner_texts(), "| user:", page.inner_text(".netrix-user").replace("\n", " / "))

        def landing():
            page.goto(URL, wait_until="networkidle")
            page.wait_for_timeout(1500)
            print("canvas:", page.locator(".pipeline-canvas canvas").count(), "| h1:", page.inner_text(".pipeline-text h1"))
            page.screenshot(path=str(SHOTS / "landing_0.png"))
            total = page.evaluate("document.querySelector('.pipeline').offsetHeight - innerHeight")
            for s in range(1, 7):
                page.evaluate(f"window.scrollTo(0, {total} * {(s + 0.5) / 7})")
                page.wait_for_timeout(900)
                print(f"stage {s}:", page.inner_text(".pipeline-kicker"), "|", page.inner_text(".pipeline-text h2"))
                page.screenshot(path=str(SHOTS / f"landing_{s}.png"))
            page.locator("#workflow").scroll_into_view_if_needed()
            page.wait_for_timeout(800)
            page.screenshot(path=str(SHOTS / "landing_workflow.png"))
            print("workflow steps:", page.locator(".workflow li").count(), "| roles:", page.locator(".who-grid article").count())

        def guard():
            page.context.clear_cookies()
            page.evaluate("localStorage.removeItem('netrix.session')")
            page.goto(f"{URL}/summary", wait_until="networkidle")
            page.wait_for_url("**/login**", timeout=10000)
            print("no session ->", page.url)
            page.screenshot(path=str(SHOTS / "login.png"), full_page=True)
            login_as("operator")
            page.goto(f"{URL}/summary", wait_until="networkidle")
            page.wait_for_selector(".netrix-denied", timeout=10000)
            print("operator on /summary:", page.inner_text(".netrix-denied").split("\n")[0])

        def dashboard():
            page.goto(f"{URL}/dashboard", wait_until="networkidle")
            page.fill("#custom-part", PART)
            page.click(".custom-part button")
            page.set_input_files("#train input[type=file]", [str(f) for f in train_files])
            page.select_option(".train-options select", "resnet18")
            page.click(".button-orange")
            page.wait_for_selector(".status-icon.done", timeout=180_000)
            print("trained:", " | ".join(page.inner_text(".train-status").split("\n")))
            page.select_option("#object-select", PART)
            for name in ("good", "scratched", "scratched"):
                page.set_input_files("#inspect input[type=file]", str(tmp / f"inspect_{name}.png"))
                page.wait_for_selector(".verdict:not(.waiting)", timeout=30000)
                page.wait_for_timeout(2500)
                print(f"inspect {name}:", page.inner_text(".verdict strong"))
            page.click("text=2D heatmap"); page.wait_for_timeout(500); print("2D legend:", page.locator(".heat-legend").count())
            page.click("text=Layer map"); page.wait_for_timeout(1500); print("layer sheets:", page.locator(".layer-sheet").count(), "images:", page.locator(".layer-sheet img").count())
            page.click("text=Side by side") if page.locator("text=Side by side").count() else None
            page.click("text=3D view")
            page.screenshot(path=str(SHOTS / "dashboard.png"))

        def evaluation():
            login_as("inspector")
            page.goto(f"{URL}/evaluation", wait_until="networkidle")
            page.wait_for_selector(".verify-card", timeout=10000)
            page.wait_for_timeout(1500)
            n = page.locator(".verify-item").count()
            print("queue items:", n, "| count badge:", page.inner_text(".verify-card .netrix-count") if page.locator(".verify-card .netrix-count").count() else "-")
            page.screenshot(path=str(SHOTS / "evaluation.png"))
            if n:
                page.locator(".verify-item").first.locator("input").fill("checked by UI test")
                page.locator(".verify-item").first.locator(".verify-defect").click()
                page.wait_for_timeout(1500)
                print("after confirm:", page.locator(".verify-item").count(), "left")
            page.fill("#chat-q", "How many parts were inspected?")
            page.click(".chat-input button")
            page.wait_for_selector(".chat-msg.assistant >> nth=-1", timeout=150_000)
            page.wait_for_function("document.querySelectorAll('.chat-msg').length >= 2 && !document.querySelector('.chat-input button .spin')", timeout=150_000)
            print("assistant:", page.locator(".chat-msg.assistant").last.inner_text().replace("\n", " ")[:200])
            page.screenshot(path=str(SHOTS / "evaluation_chat.png"))

        def objects():
            page.goto(f"{URL}/objects", wait_until="networkidle")
            card = page.locator(".object-status-card", has_text=PART)
            card.wait_for(timeout=10000)
            print("object card:", " | ".join(card.inner_text().split("\n"))[:160])
            page.screenshot(path=str(SHOTS / "objects.png"))

        def history():
            page.goto(f"{URL}/history", wait_until="networkidle")
            page.wait_for_timeout(1500)
            print("history rows:", page.locator(".history-table tbody tr").count())
            page.screenshot(path=str(SHOTS / "history.png"))

        def summary():
            login_as("supervisor")
            page.goto(f"{URL}/summary", wait_until="networkidle")
            page.wait_for_selector(".summary-kpis", timeout=10000)
            print("kpis:", " | ".join(page.locator(".kpi").all_inner_texts()).replace("\n", " "))
            page.screenshot(path=str(SHOTS / "summary.png"), full_page=True)

        for name, fn in [("landing", landing), ("login + role guard", guard), ("dashboard", dashboard),
                         ("evaluation", evaluation), ("objects", objects), ("history", history), ("summary", summary)]:
            step(name, fn)
        browser.close()

    real = [e for e in errors if "Failed to load resource" not in e]
    print("\nerrors:", real or "none")
    if "--cleanup" in sys.argv:
        cleanup()
    print("FAILED:" if failures else "ALL STEPS PASSED", failures or "")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
