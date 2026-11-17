"""Servidor local: sirve el juego y guarda los logs de cada partida en ./logs/.
Uso:  python server.py   →  http://localhost:8000
"""
import json, os, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(LOG_DIR, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # siempre carga el código más reciente
        super().end_headers()

    def do_POST(self):
        if self.path != "/log":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            data = json.loads(body)
            name = "session-" + time.strftime("%Y%m%d-%H%M%S") + ".json"
            with open(os.path.join(LOG_DIR, name), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            self.send_response(200); self.end_headers(); self.wfile.write(name.encode())
            print("log guardado:", name)
        except Exception as e:
            self.send_error(400, str(e))


if __name__ == "__main__":
    print("Pilgrim's en http://localhost:8000  (logs en ./logs)")
    ThreadingHTTPServer(("", 8000), Handler).serve_forever()
