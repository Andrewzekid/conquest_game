#!/usr/bin/env python3
"""Static file server with a filesystem-backed save-game API.

Serves the game (index.html, src/, ...) over HTTP and exposes three endpoints
that persist saves to the filesystem instead of the browser's localStorage:

    GET  /api/save        -> {"exists": true, "data": <save json>} or {"exists": false}
    POST /api/save        (body: save json) -> {"ok": true}
    DELETE /api/save      -> {"ok": true}

Saves are written to ./saves/conquest_save.json (created on first save). The
directory is .gitignored. Run with:

    python3 server.py [port]
"""

import http.server
import json
import os
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SAVE_DIR = ROOT / "saves"
SAVE_FILE = SAVE_DIR / "conquest_save.json"


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

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/save":
            if SAVE_FILE.exists():
                try:
                    raw = SAVE_FILE.read_text(encoding="utf-8")
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
        if self.path == "/api/save":
            try:
                if SAVE_FILE.exists():
                    SAVE_FILE.unlink()
                self._send_json(200, {"ok": True})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return
        super().do_DELETE(self)

    def do_POST(self):
        if self.path == "/api/save":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length else ""
                # Validate JSON before persisting.
                json.loads(body)
                SAVE_DIR.mkdir(parents=True, exist_ok=True)
                SAVE_FILE.write_text(body, encoding="utf-8")
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
        print(f"Conquest server on http://localhost:{port}  (saves -> {SAVE_FILE})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")


if __name__ == "__main__":
    main()