"""Audit trail: every inspection is stored in SQLite, with its heatmap, for CSV export and shift reports."""
import csv
import io
import sqlite3
import threading
import time
from pathlib import Path

COLUMNS = ["id", "ts", "object", "label", "score", "threshold", "ms", "backbone", "reasons", "corrected"]


class InspectionLog:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.heatmaps = self.folder / "heatmaps"
        self.heatmaps.mkdir(parents=True, exist_ok=True)
        self.db = self.folder / "inspections.db"
        self.lock = threading.Lock()
        with self._conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS inspections (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, object TEXT, label TEXT, score REAL,
                threshold REAL, ms REAL, backbone TEXT, reasons TEXT, corrected INTEGER DEFAULT 0)""")

    def _conn(self):
        c = sqlite3.connect(self.db)
        c.row_factory = sqlite3.Row
        return c

    def add(self, obj, label, score, threshold, ms, backbone, reasons, heatmap_png):
        with self.lock, self._conn() as c:
            cur = c.execute("INSERT INTO inspections (ts, object, label, score, threshold, ms, backbone, reasons) "
                            "VALUES (?,?,?,?,?,?,?,?)",
                            (time.time(), obj, label, score, threshold, ms, backbone, "; ".join(reasons)))
            rid = cur.lastrowid
        if heatmap_png:
            (self.heatmaps / f"{rid}.png").write_bytes(heatmap_png)
        return rid

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
