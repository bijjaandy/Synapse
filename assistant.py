"""Netrix IQ assistant: a local language model (Ollama) that answers from this laptop's own inspection data.
Nothing leaves the laptop. If Ollama isn't running, a small offline fallback answers the common questions."""
import json
import os
import re
import time
import urllib.error
import urllib.request

# 127.0.0.1, not "localhost": on Windows a refused connection to localhost is retried (~2 s per address)
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("NETRIX_LLM", "qwen2.5:1.5b")
TIMEOUT_S = 120
DOWN_RECHECK_S = 30   # after Ollama is found not running, answer offline straight away for this long
_down = ("", 0.0)  # (url, until): Ollama at this url was found not running

ABOUT = """Netrix IQ is an offline visual inspection system (SYNAPSE 2.0, problem statement 12).
It learns what a good part looks like from photos of good parts only, then flags anything different.
How it works: a pretrained network (resnet18 or wide_resnet50) turns each photo into 784 patch descriptions;
the 1% most varied patches of the good photos are kept as memory; each patch of a new photo is compared with
its nearest good patch; the line between good and defective is the 95th percentile of held-out good scores.
No defect photo is ever used. Answers: good, defective, unsure (close to the line, a person checks it) and
retake (the photo itself is too dark, blurry or shows the wrong thing). Operators can click "This was actually
good" to teach it instantly. QC inspectors verify unsure and defective parts. Auto model choice times both
networks on the laptop and picks the most accurate one within the limits.
Measured on MVTec AD (15 objects, CPU): training at most 68 s (limit 600 s), at most 249 ms per photo
(limit 1000 ms), mean image AUROC 0.960, accuracy 0.881, 88.7% of defects caught. Weakest: screw, grid, pill
(accuracy about 0.70); textures like wood and leather get the most false alarms."""

RULES = """You are the Netrix IQ assistant inside a factory inspection app. Answer in at most 5 short sentences.
Use ONLY the facts and data below. If the data doesn't contain the answer, say you don't have that information.
Never invent numbers, parts or inspection ids. When you quote a number, it must appear in the data."""
KANNADA_RULE = "Answer in simple Kannada (ಕನ್ನಡ). Keep numbers and inspection ids as digits."
LANGS = ("en", "kn")


def _post(path, payload, timeout):
    req = urllib.request.Request(f"{OLLAMA_URL}{path}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def status():
    global _down
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2) as r:
            models = [m["name"] for m in json.loads(r.read()).get("models", [])]
        installed = MODEL in models or (":" not in MODEL and any(m.startswith(MODEL + ":") for m in models))
        _down = ("", 0.0)  # it's up: the next question goes to Ollama
        return {"ollama": True, "model": MODEL, "model_installed": installed, "models": models}
    except (urllib.error.URLError, OSError, ValueError):
        return {"ollama": False, "model": MODEL, "model_installed": False, "models": []}


def build_context(summary, recent, detail=None):
    lines = [ABOUT, "", "LIVE DATA FROM THIS LAPTOP (as of " + time.strftime("%d %b %H:%M") + "):",
             f"Totals: {json.dumps(summary, default=str)}"]
    if recent:
        lines.append("Most recent inspections (newest first):")
        for r in recent:
            lines.append(f"#{r['id']} {r['object']} {r['label']} score {r['score']:.2f} (line {r['threshold']:.2f}) "
                         f"{r['ms']:.0f} ms" + (f", retake because: {r['reasons']}" if r.get("reasons") else "")
                         + (f", verified by a person as {r['verified_label']}" if r.get("verified_label") else "")
                         + (", operator marked it good" if r.get("corrected") else ""))
    if detail:
        lines.append(f"The user asked about inspection #{detail['id']}: {json.dumps(detail, default=str)}")
    return "\n".join(lines)


def fallback(message, summary, lang="en"):
    """Offline answers when no language model is running, so the panel never just fails."""
    m = message.lower()
    c = summary.get("counts", {})
    pending = summary.get("verification", {}).get("pending", 0)
    if lang == "kn":  # Kannada: the count sentence (numbers stay as digits), otherwise a short note
        if any(w in m for w in ("how many", "total", "count", "summary", "today", "ಎಷ್ಟು", "ಒಟ್ಟು", "ಇಂದು")):
            return (f"{summary.get('total', 0)} ತಪಾಸಣೆಗಳು ದಾಖಲಾಗಿವೆ: {c.get('good', 0)} ಸರಿ, {c.get('defective', 0)} ದೋಷಯುಕ್ತ, "
                    f"{c.get('unsure', 0)} ಖಚಿತವಿಲ್ಲ, {c.get('retake', 0)} ಮತ್ತೆ ತೆಗೆಯಬೇಕು. "
                    f"{pending} ವ್ಯಕ್ತಿಯ ಪರಿಶೀಲನೆಗೆ ಕಾಯುತ್ತಿವೆ.")
        return "ಸ್ಥಳೀಯ AI ಮಾದರಿ ಚಾಲನೆಯಲ್ಲಿಲ್ಲ, ಆದ್ದರಿಂದ ನಾನು ಎಣಿಕೆಗಳಿಗೆ ಮಾತ್ರ ಉತ್ತರಿಸಬಲ್ಲೆ."
    if any(w in m for w in ("how many", "total", "count", "summary", "today")):
        return (f"{summary.get('total', 0)} inspections logged: {c.get('good', 0)} good, {c.get('defective', 0)} "
                f"defective, {c.get('unsure', 0)} unsure, {c.get('retake', 0)} retakes. "
                f"{pending} are waiting for a person to verify.")
    if any(w in m for w in ("how", "work", "what is", "explain")):
        return ("It learns only from photos of good parts, remembers their small patches, and flags any part of a "
                "new photo that matches none of them. The line comes from good photos only.")
    return "The local AI model isn't running, so I can only answer counts and how it works."


def ask(message, history, summary, recent, detail=None, lang="en"):
    lang = lang if lang in LANGS else "en"
    context = build_context(summary, recent, detail)
    rules = RULES + ("\n" + KANNADA_RULE if lang == "kn" else "")
    messages = [{"role": "system", "content": rules + "\n\n" + context}]
    for h in history[-6:]:
        if h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str):
            messages.append({"role": h["role"], "content": h["content"][:2000]})
    messages.append({"role": "user", "content": message[:2000]})
    global _down
    t0 = time.perf_counter()
    offline_note = " (ಪೂರ್ಣ ಉತ್ತರಗಳಿಗೆ Ollama ಪ್ರಾರಂಭಿಸಿ.)" if lang == "kn" else " (Start Ollama to get full answers.)"
    if _down[0] == OLLAMA_URL and time.monotonic() < _down[1]:  # known to be off: don't wait for another refused connection
        return {"answer": fallback(message, summary, lang) + offline_note, "source": "offline-fallback", "model": None,
                "ms": round((time.perf_counter() - t0) * 1000)}
    try:
        r = _post("/api/chat", {"model": MODEL, "messages": messages, "stream": False,
                                "options": {"temperature": 0.2, "num_ctx": 4096,
                                            "num_predict": 300}}, TIMEOUT_S)  # cap: a runaway answer can't block for 2 min
        answer = (r.get("message") or {}).get("content", "").strip() or "I couldn't produce an answer."
        return {"answer": answer, "source": "ollama", "model": MODEL, "ms": round((time.perf_counter() - t0) * 1000)}
    except urllib.error.HTTPError as e:
        note = f" (Ollama says: model '{MODEL}' isn't installed; run: ollama pull {MODEL})" if e.code == 404 else ""
        return {"answer": fallback(message, summary, lang) + note, "source": "offline-fallback", "model": None,
                "ms": round((time.perf_counter() - t0) * 1000)}
    except (urllib.error.URLError, OSError, ValueError, TimeoutError) as e:
        if not isinstance(getattr(e, "reason", e), TimeoutError) and not isinstance(e, TimeoutError):
            _down = (OLLAMA_URL, time.monotonic() + DOWN_RECHECK_S)  # refused / unreachable, not just slow
        return {"answer": fallback(message, summary, lang) + offline_note,
                "source": "offline-fallback", "model": None, "ms": round((time.perf_counter() - t0) * 1000)}


def mentioned_id(message):
    m = re.search(r"#\s?(\d{1,7})\b", message)
    return int(m.group(1)) if m else None
