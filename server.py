#!/usr/bin/env python3
"""Static file server with a filesystem-backed save-game API.

Serves the game (index.html, src/, ...) over HTTP and exposes endpoints that
persist named saves to the filesystem instead of the browser's localStorage:

    GET    /api/save              -> {"saves": ["name1", "name2", ...]}
    GET    /api/save?name=foo     -> {"exists": true, "data": <save json>} or {"exists": false}
    POST   /api/save?name=foo     (body: save json) -> {"ok": true}
    DELETE /api/save?name=foo     -> {"ok": true}

Saves are written to ./saves/{name}.json (created on first save). The directory
is .gitignored. Run with:

    python3 server.py [port]
"""

import http.server
import json
import os
import socketserver
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SAVE_DIR = ROOT / "saves"
DEFAULT_SAVE = "conquest_save"


def _save_path(name):
    # Sanitize name so it can't escape the saves directory.
    safe = "".join(c for c in name if c.isalnum() or c in "-_.")
    if not safe:
        safe = DEFAULT_SAVE
    return SAVE_DIR / f"{safe}.json"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _parse_name(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        return params.get("name", [DEFAULT_SAVE])[0]

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/save"):
            name = self._parse_name()
            if name == "__list__":
                # Special sentinel: list all save files.
                saves = []
                if SAVE_DIR.exists():
                    for f in sorted(SAVE_DIR.glob("*.json")):
                        saves.append(f.stem)
                self._send_json(200, {"saves": saves})
                return
            save_file = _save_path(name)
            if save_file.exists():
                try:
                    raw = save_file.read_text(encoding="utf-8")
                    # Validate it parses before returning.
                    json.loads(raw)
                    self._send_json(200, {"exists": True, "data": raw})
                except Exception as e:
                    self._send_json(200, {"exists": False, "error": str(e)})
            else:
                self._send_json(200, {"exists": False})
            return
        super().do_GET(self)

    def do_DELETE(self):
        if self.path.startswith("/api/save"):
            name = self._parse_name()
            save_file = _save_path(name)
            try:
                if save_file.exists():
                    save_file.unlink()
                self._send_json(200, {"ok": True})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return
        super().do_DELETE(self)

    def do_POST(self):
        if self.path.startswith("/api/save"):
            try:
                name = self._parse_name()
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length else ""
                # Validate JSON before persisting.
                json.loads(body)
                SAVE_DIR.mkdir(parents=True, exist_ok=True)
                save_file = _save_path(name)
                save_file.write_text(body, encoding="utf-8")
                self._send_json(200, {"ok": True})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return
        super().do_POST(self)

    def log_message(self, fmt, *args):
        # Quiet logging: skip the noisy per-request static file lines unless
        # they're for the API endpoints.
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    with socketserver.TCPServer(("", port), Handler) as httpd:
        print(f"Conquest server on http://localhost:{port}  (saves -> {SAVE_DIR})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")


if __name__ == "__main__":
    main()
