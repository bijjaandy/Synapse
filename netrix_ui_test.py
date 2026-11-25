"""Browser test for the Netrix IQ pages (http://localhost:3000) against the backend (http://localhost:8000).

Start both servers first (see README), then:  python netrix_ui_test.py  [--headed] [--cleanup]
Walks: landing scroll -> login per role -> role guard -> dashboard train + inspect -> evaluation
(verification queue + assistant) -> objects -> history -> summary. Screenshots go to netrix_shots/.
"""
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

import ui_smoke_test
from ui_smoke_test import cleanup, make_photos

PRODUCT = "UI Test Washer"            # created through "+ Add new product"; its id must become ui_test_washer
PART = ui_smoke_test.PART = "ui_test_washer"  # cleanup() removes this part (model, photos, details, log rows)

URL = "http://localhost:3000"
SHOTS = Path(__file__).resolve().parent / "netrix_shots"


def main():
    SHOTS.mkdir(exist_ok=True)
    cleanup()  # a test product left by an earlier failed run would block "+ Add new product" (name taken)
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
            for line in [l for l in str(e).splitlines()[1:] if "intercepts" in l or "waiting for" in l][-3:]:
                print("   ", line.strip()[:200])
            try:
                if page.locator(".train-live").count(): print("    train card:", page.inner_text(".train-live")[:200].replace(chr(10), " | "))
                if page.locator(".glass-panel").count(): print("    a glass panel is open")
            except Exception: pass

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
            if page.url.startswith(URL):  # the login page forwards a signed-in user, so sign the last one out first
                page.evaluate("localStorage.removeItem('netrix.session')")
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
            page.wait_for_selector(".libview-grid"); page.click(".libview-grid")  # grid view: cards with the strictness control
            page.wait_for_selector(".object-status-card", timeout=10000); page.wait_for_timeout(1000)
            print("operator strictness: read-only", page.locator(".strictness-readonly").count(), "| sliders", page.locator(".strictness input").count())

        def dashboard():
            page.goto(f"{URL}/dashboard", wait_until="networkidle")
            print("old /dashboard ->", page.url)
            # new product through the Object library's "+ Add new product", which leads to /train with it selected
            page.goto(f"{URL}/objects", wait_until="networkidle")
            page.wait_for_selector(".libview-grid"); page.click(".libview-grid")  # gallery is the default on desktop
            page.click(".add-product-card")
            page.fill("#new-product-name", PRODUCT); page.fill("#new-product-sku", "UT-01")
            page.click(".add-product-submit")
            page.wait_for_url("**/train", timeout=15000)
            page.wait_for_function(f"document.querySelector('#train-product-name')?.textContent === {PRODUCT!r}", timeout=15000)
            import urllib.request, json as _json
            made = [o for o in _json.load(urllib.request.urlopen("http://localhost:8000/objects")) if o["display_name"] == PRODUCT]
            print("product created:", made[0]["id"] if made else "-", "| state:", made[0]["state"] if made else "-",
                  "| train header:", page.inner_text("#train-product-name"), "| old 15-tile grid:", page.locator(".object-grid").count())
            page.set_input_files("input[aria-label='Choose photos or a zip']", [str(f) for f in train_files])
            page.wait_for_function("document.querySelectorAll('.train-thumb').length >= 15 && !/checking/.test(document.querySelector('.train-quality-summary')?.textContent || 'checking')", timeout=60000)
            print("quality:", page.inner_text(".train-quality-summary"), "| step:", page.inner_text(".train-steps li.current"))
            page.screenshot(path=str(SHOTS / "train_photos.png"), full_page=True)
            page.click(".train-settings summary"); page.select_option(".train-settings select", "resnet18")
            page.click(".train-start")
            page.wait_for_selector(".train-live", timeout=15000)
            page.screenshot(path=str(SHOTS / "train_running.png"), full_page=True)
            page.wait_for_selector(".train-live .go-inspect", timeout=180_000)
            print("trained:", page.inner_text(".train-live h3"), "|", page.inner_text(".train-time").replace("\n", " "))
            print("toasts so far:", page.evaluate("window.__netrixToasts || []"), "| nav pill under:", page.evaluate("document.querySelector('.nav-pill')?.parentElement?.textContent"))
            page.click(".train-live .go-inspect"); page.wait_for_url("**/inspect", timeout=15000); page.wait_for_selector("#object-select")
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
                print("   read aloud:", (page.evaluate("window.__spoken")[-1:] or ["-"])[0][:70], "| stop button seen:", page.locator(".stop-speaking").count() > 0 or "(already finished)")
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
            page.click(".input-tab-conveyor")  # inputs are tabs now: Upload | Webcam | Conveyor
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
            page.click(".input-tab-upload"); page.click(".view-tab-2d"); page.wait_for_timeout(500); print("2D legend:", page.locator(".heat-legend").count())
            cg = page.locator(".compare-good-toggle input")
            print("compare toggle:", cg.count(), end=" ")
            if cg.count():
                page.click(".compare-good-toggle"); page.wait_for_timeout(1500)  # the input is hidden behind the styled box
                print("-> captions:", page.locator(".compare-good figcaption").all_inner_texts(), "| images loaded:",
                      page.evaluate("[...document.querySelectorAll('.compare-good img')].map(i => i.complete && i.naturalWidth > 0)"))
                page.locator(".result-panel").screenshot(path=str(SHOTS / "compare_good.png"))
                page.click(".compare-good-toggle")
            page.click(".view-tab-layers"); page.wait_for_timeout(1500); print("layer sheets:", page.locator(".layer-sheet").count(), "images:", page.locator(".layer-sheet img").count())
            page.click("text=Side by side") if page.locator("text=Side by side").count() else None
            page.click(".view-tab-3d")
            page.screenshot(path=str(SHOTS / "dashboard.png"))

        def evaluation():
            login_as("inspector")
            page.goto(f"{URL}/evaluation", wait_until="networkidle")
            page.wait_for_selector(".verify-card", timeout=10000)
            page.wait_for_timeout(1500)
            n = page.locator(".verify-item").count()
            mine = page.locator(".verify-item", has_text=PRODUCT)
            print("queue items:", n, "| from this test:", mine.count())
            page.screenshot(path=str(SHOTS / "evaluation.png"))
            if mine.count():  # only touch the test part's own inspections, never real ones
                mine.first.locator("input").fill("checked by UI test")
                mine.first.locator(".verify-defect").click()
                page.wait_for_timeout(1500)
                print("after confirm:", page.locator(".verify-item", has_text=PRODUCT).count(), "of ours left")
                print("   toast:", page.evaluate("(window.__netrixToasts || []).slice(-1)"))
            import urllib.request, json as _json
            rid = _json.load(urllib.request.urlopen(f"http://localhost:8000/log?object={PART}&limit=1"))[0]["id"]
            page.goto(f"{URL}/evaluation?ask={rid}", wait_until="domcontentloaded")  # it starts asking the AI at once
            page.wait_for_function("document.querySelectorAll('.chat-msg.assistant').length >= 1 && !document.querySelector('.chat-msg .spin')", timeout=150_000)
            print(f"ask={rid}: question:", page.locator(".chat-msg.user").first.inner_text()[:60], "| reply:", page.locator(".chat-msg.assistant").last.inner_text().replace("\n", " ")[:160])
            print("ask answer read aloud:", (page.evaluate("window.__spoken")[-1:] or ["-"])[0][:70])
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
            spoken_before_chat = len(page.evaluate("window.__spoken"))
            page.fill("#chat-q", "How many parts were inspected?")
            before = page.locator(".chat-msg.assistant").count()
            page.click(".chat-input button")
            # done = no "Thinking" bubble left and one more assistant message than before (works for fast and slow answers)
            page.wait_for_function(f"!document.querySelector('.chat-msg .spin') && document.querySelectorAll('.chat-msg.assistant').length > {before}", timeout=150_000)
            print("assistant:", page.locator(".chat-msg.assistant").last.inner_text().replace("\n", " ")[:200])
            print("typed chat read aloud:", len(page.evaluate("window.__spoken")) - spoken_before_chat, "(expected 0)")
            page.screenshot(path=str(SHOTS / "evaluation_chat.png"))

        def objects():
            page.goto(f"{URL}/objects", wait_until="networkidle")
            page.wait_for_selector(".libview-grid"); page.click(".libview-grid"); page.wait_for_timeout(400)
            print("library: add card", page.locator(".add-product-card").count(), "| benchmark section", page.locator("details.benchmark-parts").count(),
                  "| empty note", page.locator(".library-empty").count(), "| products:", page.locator(".product-card h4").all_inner_texts())
            card = page.locator(".object-status-card", has_text=PRODUCT)  # cards show the display name
            card.wait_for(timeout=10000)
            print("object card:", " | ".join(card.inner_text().split("\n"))[:160])
            slider = card.locator(".strictness input[type=range]")
            print("strictness slider (inspector):", slider.count(), "value", slider.get_attribute("value") if slider.count() else "-", end=" ")
            if slider.count():  # only the test part's card is ever changed
                slider.focus(); page.keyboard.press("ArrowRight"); page.wait_for_timeout(1500)
                import urllib.request, json as _json
                saved = _json.load(urllib.request.urlopen(f"http://localhost:8000/objects/{PART}/status"))["strictness"]
                print("-> label:", card.locator(".strictness label").inner_text().replace("\n", " "), "| backend:", saved)
                print("   toast:", page.evaluate("(window.__netrixToasts || []).slice(-1)"))
            # glass detail panel: click opens, Esc closes and focus returns to the card; hover opens; click outside closes
            try: page.wait_for_selector(".toast", state="detached", timeout=8000)  # a toast over the card would delay the click
            except Exception: pass
            card.locator("h4").click()
            page.wait_for_selector(".glass-panel dl", timeout=15000); page.wait_for_timeout(600)
            rows = dict(t.split("\n", 1) for t in page.locator(".glass-stats dl > div").all_inner_texts() if "\n" in t)
            print("glass panel:", page.inner_text("#glass-title"), "| inspections", rows.get("Inspections"), "| line", rows.get("Decision line"),
                  "| band", rows.get("Unsure band"), "| photo shown:", page.locator(".glass-main img").count() + page.locator(".glass-placeholder").count() > 0,
                  "| counts:", page.inner_text(".glass-counts").replace("\n", " "))
            page.screenshot(path=str(SHOTS / "glass_panel.png"))
            page.keyboard.press("Escape"); page.wait_for_selector(".glass-panel", state="detached", timeout=5000)  # after its closing animation
            print("after Esc: panel", page.locator(".glass-panel").count(), "| focus back on card:", page.evaluate("document.activeElement?.dataset?.detail === '1'"))
            page.mouse.move(5, 5); page.wait_for_timeout(200); card.hover(); page.wait_for_timeout(600)  # enter from outside (hover may scroll first)
            bb = card.bounding_box(); page.mouse.move(bb["x"] + bb["width"] / 2 + 4, bb["y"] + 40, steps=3); page.wait_for_timeout(1200)  # a small real movement, then rest
            print("hover opens:", page.locator(".glass-panel").count())
            page.mouse.click(5, 5)
            try: page.wait_for_selector(".glass-panel", state="detached", timeout=5000)  # after its closing animation
            except Exception: pass
            print("click outside closes:", page.locator(".glass-panel").count() == 0)
            # 3D backstage gallery: keys, drag, Enter opens the glass panel (shared photo), Esc closes
            page.click(".libview-gallery"); page.wait_for_selector(".gallery-card"); page.wait_for_timeout(700)
            act = lambda: page.get_attribute(".gallery-card.active", "aria-label")
            print("gallery: cards", page.locator(".gallery-card").count(), "| listbox:", page.get_attribute(".gallery-stage", "role"), "| centre:", act())
            page.locator(".gallery-card.active").focus(); page.keyboard.press("ArrowRight"); page.wait_for_timeout(700)
            print("   ArrowRight ->", act())
            box = page.locator(".gallery-stage").bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 200); page.mouse.down()
            page.mouse.move(box["x"] + box["width"] / 2 + 260, box["y"] + 200, steps=12); page.mouse.up(); page.wait_for_timeout(900)
            print("   drag right ->", act())
            page.click(".gallery-nav.next"); page.wait_for_timeout(700)
            if page.get_attribute(".gallery-card.active", "data-index") == "0": page.click(".gallery-nav.next"); page.wait_for_timeout(700)
            page.locator(".gallery-card.active").focus(); page.keyboard.press("Enter")
            page.wait_for_selector(".glass-panel dl", timeout=15000); page.wait_for_timeout(500)
            print("   Enter opens:", page.inner_text("#glass-title"), "| row dimmed:", page.locator(".gallery.dimmed").count())
            page.screenshot(path=str(SHOTS / "gallery_detail.png"))
            page.keyboard.press("Escape"); page.wait_for_selector(".glass-panel", state="detached", timeout=5000)
            print("   Esc closes, focus back:", page.evaluate("document.activeElement?.classList?.contains('gallery-card')"))
            page.screenshot(path=str(SHOTS / "gallery.png"))
            page.click(".libview-grid")
            page.screenshot(path=str(SHOTS / "objects.png"))

        def history():
            page.goto(f"{URL}/history", wait_until="networkidle")
            page.wait_for_timeout(1500)
            print("history rows:", page.locator(".history-table tbody tr").count())
            page.screenshot(path=str(SHOTS / "history.png"))

        def summary():
            login_as("supervisor")
            page.goto(f"{URL}/summary", wait_until="networkidle")
            page.wait_for_selector(".summary-kpis", timeout=30000)  # slower while another part trains
            page.wait_for_timeout(900)  # KPI numbers count up
            print("sparkline:", page.inner_text(".sparkline-head").replace(chr(10), " | ") if page.locator(".sparkline-head").count() else "-", "| page icon:", page.locator(".page-icon").count())
            print("kpis:", " | ".join(page.locator(".kpi").all_inner_texts()).replace("\n", " "))
            page.screenshot(path=str(SHOTS / "summary.png"), full_page=True)

        def navigation():
            # signed in (supervisor from the summary step): landing says "Open app", the app logo goes to Inspect
            page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(1500)
            print("landing CTA while signed in:", page.inner_text(".landing-cta").strip(), "->", page.get_attribute(".landing-cta", "href"))
            page.goto(f"{URL}/history", wait_until="networkidle")
            print("app logo ->", page.get_attribute(".netrix-topbar .netrix-brand", "href"))
            # log out -> landing page, which offers "Sign in" again
            page.click(".netrix-logout"); page.wait_for_url(f"{URL}/", timeout=15000); page.wait_for_timeout(1000)
            print("after log out:", page.url, "| CTA:", page.inner_text(".landing-cta").strip())
            # a session the server no longer accepts -> /login?next=...&expired=1 with the message; Back doesn't loop
            page.evaluate("""localStorage.setItem('netrix.session', JSON.stringify({token: 'not-a-real-token', username: 'operator',
                             role: 'operator', role_name: 'Operator', display: 'Line Operator'}))""")
            page.goto(f"{URL}/history", wait_until="domcontentloaded")
            page.wait_for_url("**/login**", timeout=15000); page.wait_for_selector(".login-expired", timeout=10000)
            print("expired session ->", page.url.replace(URL, ""), "|", page.inner_text(".login-expired"), "| back link:", page.get_attribute(".login-back", "href"))
            page.go_back(); page.wait_for_timeout(1500)
            print("Back from login ->", page.url.replace(URL, "") or "/", "(not /history again)")

        for name, fn in [("landing", landing), ("login + role guard", guard), ("dashboard", dashboard),
                         ("evaluation", evaluation), ("objects", objects), ("history", history), ("summary", summary),
                         ("navigation", navigation)]:
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
