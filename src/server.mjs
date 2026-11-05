import { createReadStream, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

// Threads in WebAssembly need cross-origin isolation, so every response sets it.
export const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

export function startServer({ pageDir, engineDir, modelFile, config, onEvent }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/event") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(204, ISOLATION_HEADERS);
        res.end();
        onEvent(JSON.parse(body));
      });
      return;
    }
    if (url.pathname === "/config.json") {
      res.writeHead(200, { ...ISOLATION_HEADERS, "Content-Type": MIME[".json"] });
      res.end(JSON.stringify(config));
      return;
    }
    const file = resolveFile(url.pathname, { pageDir, engineDir, modelFile });
    try {
      if (!file) throw new Error("not found");
      const { size } = statSync(file);
      res.writeHead(200, {
        ...ISOLATION_HEADERS,
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Content-Length": size,
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, ISOLATION_HEADERS);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() });
    });
  });
}

export function resolveFile(pathname, { pageDir, engineDir, modelFile }) {
  if (pathname === "/") return path.join(pageDir, "index.html");
  if (pathname === "/worker.js") return path.join(pageDir, "worker.js");
  if (pathname === "/model.gguf") return modelFile;
  if (pathname === "/wllama.wasm") return path.join(engineDir, "wasm", "wllama.wasm");
  if (pathname === "/engine/index.js") return path.join(engineDir, "index.js");
  return null;
}
