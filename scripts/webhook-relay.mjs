// Local development only: lets a cloud Convex deployment reach the n8n webhook on this machine
// without exposing the n8n editor. Tunnel this port, never n8n's own:
//   npm run relay                                   # 127.0.0.1:5679
//   cloudflared tunnel --url http://127.0.0.1:5679
// Only POST /webhook/lendloop-events is forwarded (body up to 64 KB); everything else gets 404.
import http from "node:http";

const PORT = Number(process.env.RELAY_PORT ?? 5679);
const N8N = process.env.N8N_URL ?? "http://127.0.0.1:5678";
const PATH = "/webhook/lendloop-events";
const MAX_BODY = 64 * 1024;

http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== PATH) {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      try {
        const answer = await fetch(N8N + PATH, {
          method: "POST",
          headers: {
            "content-type": req.headers["content-type"] ?? "application/json",
            ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          },
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(15_000),
        });
        res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "text/plain" });
        res.end(Buffer.from(await answer.arrayBuffer()));
      } catch {
        res.writeHead(502).end();
      }
      console.log(new Date().toISOString(), "relayed", res.statusCode);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`relay on http://127.0.0.1:${PORT}${PATH} -> ${N8N}`));
