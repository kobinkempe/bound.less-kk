"""A CORS static file server over the Claude projects folder, for feeding .boundless.json files
to a page in Chrome (the upload tool caps at 10 MB; Magnum Opus is 64 MB). Read-only, localhost
only. launch.json's `fixtures` entry and tools/launch.js run this on :3002. Do not repoint it at
another folder: the browser harness (.claude/rasteriser/browser-harness.js) fetches
/Magnum%20Opus.boundless.json."""
import http.server, sys

ROOT = r"C:\Users\Surface\Documents\Claude projects"
PORT = 3002

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()
    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args)); sys.stdout.flush()

if __name__ == "__main__":
    print("fixture server on", PORT, "over", ROOT, flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
