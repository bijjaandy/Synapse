"""Audit trail: every inspection is stored in SQLite, with its heatmap, for CSV export and shift reports."""
import csv
import io
import sqlite3
import threading
import time
from pathlib import Path

COLUMNS = ["id", "ts", "object", "label", "score", "threshold", "ms", "backbone", "reasons", "corrected",
           "verified_label", "verified_by", "verified_at", "note"]
VERIFY_COLUMNS = {"verified_label": "TEXT", "verified_by": "TEXT", "verified_at": "REAL", "note": "TEXT"}


class InspectionLog:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.heatmaps = self.folder / "heatmaps"
        self.heatmaps.mkdir(parents=True, exist_ok=True)
        self.photos = self.folder / "photos"   # originals, so a QC inspector can verify later
        self.photos.mkdir(parents=True, exist_ok=True)
        self.db = self.folder / "inspections.db"
        self.lock = threading.Lock()
        with self._conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS inspections (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, object TEXT, label TEXT, score REAL,
                threshold REAL, ms REAL, backbone TEXT, reasons TEXT, corrected INTEGER DEFAULT 0)""")
            have = {r["name"] for r in c.execute("PRAGMA table_info(inspections)")}
            for col, kind in VERIFY_COLUMNS.items():  # logs from before human verification existed gain the columns
                if col not in have:
                    c.execute(f"ALTER TABLE inspections ADD COLUMN {col} {kind}")

    def _conn(self):
        c = sqlite3.connect(self.db)
        c.row_factory = sqlite3.Row
        return c

    def add(self, obj, label, score, threshold, ms, backbone, reasons, heatmap_png, photo_jpg=None):
        with self.lock, self._conn() as c:
            cur = c.execute("INSERT INTO inspections (ts, object, label, score, threshold, ms, backbone, reasons) "
                            "VALUES (?,?,?,?,?,?,?,?)",
                            (time.time(), obj, label, score, threshold, ms, backbone, "; ".join(reasons)))
            rid = cur.lastrowid
        if heatmap_png:
            (self.heatmaps / f"{rid}.png").write_bytes(heatmap_png)
        if photo_jpg:
            (self.photos / f"{rid}.jpg").write_bytes(photo_jpg)
        return rid

    def photo_path(self, rid):
        p = self.photos / f"{int(rid)}.jpg"
        return p if p.exists() else None

    def get(self, rid):
        with self._conn() as c:
            r = c.execute("SELECT * FROM inspections WHERE id=?", (int(rid),)).fetchone()
        return dict(r) if r else None

    def queue(self, obj=None, limit=50):
        """Unsure and defective results no person has checked yet, oldest first."""
        q, args = "SELECT * FROM inspections WHERE label IN ('unsure','defective') AND verified_label IS NULL", []
        if obj:
            q += " AND object=?"; args.append(obj)
        q += " ORDER BY id ASC LIMIT ?"; args.append(int(limit))
        with self._conn() as c:
            return [dict(r) for r in c.execute(q, args)]

    def verify(self, rid, decision, by, note=""):
        """A QC inspector's final call: 'good' or 'defective'."""
        with self.lock, self._conn() as c:
            n = c.execute("UPDATE inspections SET verified_label=?, verified_by=?, verified_at=?, note=?, "
                          "corrected=CASE WHEN ?='good' THEN 1 ELSE corrected END WHERE id=?",
                          (decision, by, time.time(), note[:500], decision, int(rid))).rowcount
        return n == 1

    def summary(self):
        """Totals for the whole log: by result, by part, and how human verification went."""
        rows = self.rows()
        labels = ("good", "defective", "unsure", "retake")
        by_obj = {}
        for r in rows:
            o = by_obj.setdefault(r["object"], {"object": r["object"], "total": 0, **{k: 0 for k in labels}})
            o["total"] += 1
            o[r["label"]] = o.get(r["label"], 0) + 1
        verified = [r for r in rows if r.get("verified_label")]
        flagged = [r for r in rows if r["label"] in ("unsure", "defective")]
        return {
            "total": len(rows),
            "counts": {k: sum(r["label"] == k for r in rows) for k in labels},
            "by_object": sorted(by_obj.values(), key=lambda o: -o["total"]),
            "verification": {
                "pending": sum(1 for r in flagged if not r.get("verified_label")),
                "verified": len(verified),
                "confirmed_defective": sum(r["verified_label"] == "defective" for r in verified),
                "overturned_to_good": sum(r["verified_label"] == "good" for r in verified),
            },
            "operator_corrections": sum(r["corrected"] for r in rows),
            "avg_ms": round(sum(r["ms"] for r in rows) / len(rows), 1) if rows else 0.0,
            "max_ms": round(max((r["ms"] for r in rows), default=0.0), 1),
            "first": min((r["ts"] for r in rows), default=None),
            "last": max((r["ts"] for r in rows), default=None),
        }

    def mark_corrected(self, rid, obj):
        """Operator said this one was actually good. Returns False if the id doesn't belong to that object."""
        with self.lock, self._conn() as c:
            return c.execute("UPDATE inspections SET corrected=1 WHERE id=? AND object=?", (rid, obj)).rowcount == 1

    def rows(self, obj=None, since=None, limit=None):
        q, args = "SELECT * FROM inspections WHERE 1=1", []
        if obj:
            q += " AND object=?"; args.append(obj)
        if since:
            q += " AND ts>=?"; args.append(since)
        q += " ORDER BY id DESC"
        if limit:
            q += " LIMIT ?"; args.append(int(limit))
        with self._conn() as c:
            return [dict(r) for r in c.execute(q, args)]

    def delete_object(self, obj):
        """Delete every log row of one part, with its heatmaps and photos. Returns how many rows went."""
        with self._conn() as c:
            ids = [r[0] for r in c.execute("SELECT id FROM inspections WHERE object=?", (obj,))]
            c.execute("DELETE FROM inspections WHERE object=?", (obj,))
        for rid in ids:
            (self.heatmaps / f"{rid}.png").unlink(missing_ok=True)
            (self.photos / f"{rid}.jpg").unlink(missing_ok=True)
        return len(ids)

    def heatmap_path(self, rid):
        p = self.heatmaps / f"{int(rid)}.png"
        return p if p.exists() else None

    def csv_text(self, obj=None, since=None):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "time", "object", "label", "score", "threshold", "ms", "backbone", "retake_reasons",
                    "operator_corrected"])
        for r in reversed(self.rows(obj, since)):
            w.writerow([r["id"], time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(r["ts"])), r["object"], r["label"],
                        f"{r['score']:.4f}", f"{r['threshold']:.4f}", f"{r['ms']:.0f}", r["backbone"], r["reasons"],
                        "yes" if r["corrected"] else ""])
        return buf.getvalue()

    def report(self, obj=None, since=None):
        rows = self.rows(obj, since)
        counts = {k: 0 for k in ("good", "defective", "unsure", "retake")}
        for r in rows:
            counts[r["label"]] = counts.get(r["label"], 0) + 1
        n = len(rows)
        return {
            "object": obj or "all", "since": since, "total": n, "counts": counts,
            "defect_rate": round(counts["defective"] / n, 4) if n else 0.0,
            "sent_to_human": counts["unsure"], "retakes": counts["retake"],
            "operator_corrections": sum(r["corrected"] for r in rows),
            "avg_ms": round(sum(r["ms"] for r in rows) / n, 1) if n else 0.0,
            "max_ms": round(max((r["ms"] for r in rows), default=0.0), 1),
            "first": min((r["ts"] for r in rows), default=None), "last": max((r["ts"] for r in rows), default=None),
            "recent_flagged": [{k: r[k] for k in ("id", "ts", "object", "label", "score", "reasons", "corrected")}
                               for r in rows if r["label"] in ("defective", "unsure")][:12],
        }
