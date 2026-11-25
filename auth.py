"""Local logins with three roles. Users live in users.json on this laptop (passwords salted and hashed).
Good enough to separate who does what in a factory demo; not internet-facing security."""
import hashlib
import json
import secrets
import threading
import time
from pathlib import Path

from fastapi import Header, HTTPException

ROLES = {
    "operator": "Operator",          # trains parts and inspects on the line
    "inspector": "QC Inspector",     # verifies unsure/defective results, runs evaluations
    "supervisor": "Supervisor",      # everything, plus the summary
}
DEFAULT_USERS = [("operator", "operator123", "operator", "Line Operator"),
                 ("inspector", "inspector123", "inspector", "QC Inspector"),
                 ("supervisor", "supervisor123", "supervisor", "Shift Supervisor")]
TOKEN_TTL_S = 12 * 3600


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


class UserStore:
    def __init__(self, path):
        self.path = Path(path)
        self.tokens = {}
        self.lock = threading.Lock()
        if not self.path.exists():  # first run: create the three demo accounts (change them in users.json)
            users = {}
            for name, pw, role, display in DEFAULT_USERS:
                salt = secrets.token_hex(16)
                users[name] = {"role": role, "display": display, "salt": salt, "hash": _hash(pw, salt)}
            self.path.write_text(json.dumps(users, indent=2))

    def users(self):
        return json.loads(self.path.read_text())

    def login(self, username, password):
        u = self.users().get(username.strip().lower())
        if not u or not secrets.compare_digest(u["hash"], _hash(password, u["salt"])):
            return None
        token = secrets.token_urlsafe(24)
        with self.lock:
            now = time.time()
            self.tokens = {k: v for k, v in self.tokens.items() if v["expires"] > now}
            self.tokens[token] = {"username": username.strip().lower(), "role": u["role"], "display": u["display"],
                                  "expires": now + TOKEN_TTL_S}
        return token, self.tokens[token]

    def who(self, token):
        with self.lock:
            s = self.tokens.get(token or "")
            if not s or s["expires"] < time.time():
                return None
            return s

    def logout(self, token):
        with self.lock:
            self.tokens.pop(token or "", None)


def bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def require_role(store: UserStore, *roles):
    """FastAPI dependency: the caller must be logged in with one of these roles."""
    def dep(authorization: str | None = Header(None)):
        s = store.who(bearer(authorization))
        if not s:
            raise HTTPException(401, "Please log in first.")
        if roles and s["role"] not in roles:
            raise HTTPException(403, f"This needs a {' or '.join(ROLES[r] for r in roles)} login.")
        return s
    return dep
