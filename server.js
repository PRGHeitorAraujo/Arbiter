import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const root = __dirname;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.join(root, requestedPath);

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      // SPA fallback: paths without a static file extension are client-side routes
      if (!path.extname(requestedPath)) {
        fs.readFile(path.join(root, "index.html"), (_err, html) => {
          if (_err) { send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" }); return; }
          send(res, 200, html, { "content-type": "text/html; charset=utf-8" });
        });
        return;
      }
      send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    const ext = path.extname(filePath);
    const noCache = ext === ".js" || ext === ".css";
    send(res, 200, data, {
      "content-type": types[ext] || "application/octet-stream",
      ...(noCache ? { "cache-control": "no-store" } : {}),
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Arbiter running at http://127.0.0.1:${port}`);
});
