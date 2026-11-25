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
        # record what the page would say aloud (headless Chromium has no audio)
        ctx.add_init_script("""window.__spoken = [];
          if (window.speechSynthesis) { const real = speechSynthesis.speak.bind(speechSynthesis);
            speechSynthesis.speak = (u) => { window.__spoken.push(u.text); try { real(u); } catch (e) {} }; }""")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        def login_as(role):
            page.goto(f"{URL}/login", wait_until="networkidle")
            page.locator(".login-role", has_text={"operator": "Line Operator", "inspector": "QC Inspector",
                                                  "supervisor": "Shift Supervisor"}[role]).locator(".login-demo").click()
            page.wait_for_url("**/inspect", timeout=15000)
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
            page.goto(f"{URL}/objects", wait_until="networkidle")
            page.wait_for_selector(".object-status-card", timeout=10000); page.wait_for_timeout(1000)
            print("operator strictness: read-only", page.locator(".strictness-readonly").count(), "| sliders", page.locator(".strictness input").count())

        def dashboard():
            page.goto(f"{URL}/dashboard", wait_until="networkidle")
            print("old /dashboard ->", page.url)
            page.goto(f"{URL}/train", wait_until="networkidle")
            page.fill("#custom-part", PART)
            page.click(".custom-part button")
            page.set_input_files("#train input[type=file]", [str(f) for f in train_files])
            page.select_option(".train-options select", "resnet18")
            page.click(".button-orange")
            page.wait_for_selector(".status-icon.done", timeout=180_000)
            print("trained:", " | ".join(page.inner_text(".train-status").split("\n")))
            print("train page: inspect section", page.locator("#inspect").count(), "| go-to-inspect link", page.locator(".go-inspect").count())
            page.click(".go-inspect"); page.wait_for_url("**/inspect", timeout=15000); page.wait_for_selector("#object-select")
            print("inspect page: train section", page.locator("#train").count(), "| nav:", page.locator(".netrix-topbar nav a").all_inner_texts())
            page.select_option("#object-select", PART)
            for name in ("good", "scratched", "scratched"):
                page.set_input_files("#inspect input[type=file]", str(tmp / f"inspect_{name}.png"))
                page.wait_for_selector(".verdict:not(.waiting)", timeout=30000)
                page.wait_for_timeout(2500)
                print(f"inspect {name}:", page.inner_text(".verdict strong"))
            print("spoken:", page.evaluate("window.__spoken"))
            ask = page.locator(".ask-ai")
            print("ask AI button (operator):", ask.count(), end=" ")
            if ask.count():
                ask.first.click()
                page.wait_for_selector(".ask-ai-answer", timeout=120_000)
                print("-> inline answer:", page.inner_text(".ask-ai-answer").replace("\n", " ")[:140])
            vt = page.locator(".voice-toggle")
            print("voice toggle:", vt.count(), vt.get_attribute("aria-pressed") if vt.count() else "-", end=" ")
            if vt.count():
                vt.click(); print("-> after click:", vt.get_attribute("aria-pressed"), "| stored:", page.evaluate("localStorage.getItem('netrix.voice')"), end=" ")
                n = len(page.evaluate("window.__spoken"))
                page.set_input_files("#inspect input[type=file]", str(tmp / "inspect_good.png"))
                page.wait_for_selector(".verdict:not(.waiting)", timeout=30000); page.wait_for_timeout(1500)
                print("| spoken while muted:", len(page.evaluate("window.__spoken")) - n)
                vt.click()
            # English / Kannada: switch, inspect, check the Kannada words, then back to English for the rest
            page.click(".lang-switch button[lang=kn]"); page.wait_for_timeout(300)
            n_spoken = len(page.evaluate("window.__spoken"))
            page.set_input_files("#inspect input[type=file]", str(tmp / "inspect_scratched.png"))
            page.wait_for_selector(".verdict-kn", timeout=30000); page.wait_for_timeout(1500)
            kn_voice = page.evaluate("speechSynthesis.getVoices().some(v => v.lang.toLowerCase().startsWith('kn'))")
            print("kannada: stored", page.evaluate("localStorage.getItem('netrix.lang')"), "| word:", page.inner_text(".verdict-kn"),
                  "| sentence:", page.inner_text(".kn-sentence"), "| kn voice installed:", kn_voice,
                  "| hint shown:", page.locator(".kn-hint").count(), "| spoken:", page.evaluate("window.__spoken").__len__() - n_spoken)
            page.click(".lang-switch button:has-text('EN')"); page.wait_for_timeout(300)
            print("back to:", page.evaluate("localStorage.getItem('netrix.lang')"), "| kn word shown:", page.locator(".verdict-kn").count())
            # conveyor mode with Chromium's fake camera: switch on, use the manual "Inspect now", check the tally
            page.click(".live-cam-inspect .cam-start")
            page.wait_for_selector(".live-cam-inspect video", timeout=10000); page.wait_for_timeout(2000)
            page.locator(".conveyor-switch input").check()
            page.wait_for_timeout(1500)
            print("conveyor:", page.inner_text(".conveyor-switch").replace("\n", " "), "|", page.inner_text(".conveyor-sensitivity").split("\n")[0])
            before = page.inner_text(".conveyor-tally .tally-inspected strong")
            page.click(".conveyor-now")
            page.wait_for_function(f"Number(document.querySelector('.conveyor-tally .tally-inspected strong')?.textContent) > {before}", timeout=30000)
            page.wait_for_timeout(500)
            print("tally:", " | ".join(page.locator(".conveyor-tally div").all_inner_texts()).replace("\n", " "),
                  "| chips:", page.locator(".conveyor-recent .chip").all_inner_texts(), "| spoken last:", page.evaluate("window.__spoken.slice(-1)"))
            page.locator(".live-cam-inspect").screenshot(path=str(SHOTS / "conveyor.png"))
            page.locator(".conveyor-switch input").uncheck()
            page.click(".live-cam-inspect >> text=Stop")
            page.click("text=2D heatmap"); page.wait_for_timeout(500); print("2D legend:", page.locator(".heat-legend").count())
            cg = page.locator(".compare-good-toggle input")
            print("compare toggle:", cg.count(), end=" ")
            if cg.count():
                page.click(".compare-good-toggle"); page.wait_for_timeout(1500)  # the input is hidden behind the styled box
                print("-> captions:", page.locator(".compare-good figcaption").all_inner_texts(), "| images loaded:",
                      page.evaluate("[...document.querySelectorAll('.compare-good img')].map(i => i.complete && i.naturalWidth > 0)"))
                page.locator(".result-panel").screenshot(path=str(SHOTS / "compare_good.png"))
                page.click(".compare-good-toggle")
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
            mine = page.locator(".verify-item", has_text=PART)
            print("queue items:", n, "| from this test:", mine.count())
            page.screenshot(path=str(SHOTS / "evaluation.png"))
            if mine.count():  # only touch the test part's own inspections, never real ones
                mine.first.locator("input").fill("checked by UI test")
                mine.first.locator(".verify-defect").click()
                page.wait_for_timeout(1500)
                print("after confirm:", page.locator(".verify-item", has_text=PART).count(), "of ours left")
            import urllib.request, json as _json
            rid = _json.load(urllib.request.urlopen(f"http://localhost:8000/log?object={PART}&limit=1"))[0]["id"]
            page.goto(f"{URL}/evaluation?ask={rid}", wait_until="networkidle")
            page.wait_for_function("document.querySelectorAll('.chat-msg.assistant').length >= 1 && !document.querySelector('.chat-msg .spin')", timeout=150_000)
            print(f"ask={rid}: question:", page.locator(".chat-msg.user").first.inner_text()[:60], "| reply:", page.locator(".chat-msg.assistant").last.inner_text().replace("\n", " ")[:160])
            print("url after ask:", page.url)
            page.wait_for_selector(".verify-card", timeout=10000)
            # judge test mode: a folder of three test photos through the test part, not logged
            import shutil
            jdir = tmp / "judge"; (jdir / "sub").mkdir(parents=True, exist_ok=True)
            shutil.copy(tmp / "inspect_good.png", jdir / "a_good.png")
            shutil.copy(tmp / "inspect_scratched.png", jdir / "sub" / "b_scratched.png")
            shutil.copy(tmp / "inspect_dark.png", jdir / "c_dark.png")
            if page.locator("#eval-object").count():
                page.select_option("#eval-object", PART)
            page.locator("#judge-panel input[type=file]").set_input_files(str(jdir))
            page.click(".judge-run")
            page.wait_for_function("document.querySelectorAll('.judge-table tbody tr').length === 3 && !document.querySelector('.judge-run:disabled')", timeout=60000)
            print("judge:", page.inner_text(".judge-summary").split("\n")[0], "| rows:", page.locator(".judge-table tbody tr").count())
            page.click(".judge-sort")
            print("judge sorted:", [t.split("\t")[2] if "\t" in t else t for t in page.locator(".judge-table tbody tr td:nth-child(3)").all_inner_texts()])
            with page.expect_download() as dl:
                page.click(".judge-csv")
            lines = Path(dl.value.path()).read_text(encoding="utf-8").strip().splitlines()
            print("judge csv:", lines[0], "|", len(lines) - 1, "rows")
            page.locator("#judge-panel").screenshot(path=str(SHOTS / "judge.png"))
            page.fill("#chat-q", "How many parts were inspected?")
            before = page.locator(".chat-msg.assistant").count()
            page.click(".chat-input button")
            # done = no "Thinking" bubble left and one more assistant message than before (works for fast and slow answers)
            page.wait_for_function(f"!document.querySelector('.chat-msg .spin') && document.querySelectorAll('.chat-msg.assistant').length > {before}", timeout=150_000)
            print("assistant:", page.locator(".chat-msg.assistant").last.inner_text().replace("\n", " ")[:200])
            page.screenshot(path=str(SHOTS / "evaluation_chat.png"))

        def objects():
            page.goto(f"{URL}/objects", wait_until="networkidle")
            card = page.locator(".object-status-card", has_text=PART)
            card.wait_for(timeout=10000)
            print("object card:", " | ".join(card.inner_text().split("\n"))[:160])
            slider = card.locator(".strictness input[type=range]")
            print("strictness slider (inspector):", slider.count(), "value", slider.get_attribute("value") if slider.count() else "-", end=" ")
            if slider.count():  # only the test part's card is ever changed
                slider.focus(); page.keyboard.press("ArrowRight"); page.wait_for_timeout(1500)
                import urllib.request, json as _json
                saved = _json.load(urllib.request.urlopen(f"http://localhost:8000/objects/{PART}/status"))["strictness"]
                print("-> label:", card.locator(".strictness label").inner_text().replace("\n", " "), "| backend:", saved)
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
