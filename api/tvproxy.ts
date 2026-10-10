import { Hono } from "hono";

export const tvproxyApp = new Hono();

tvproxyApp.get("/", async (c) => {
  const raw = c.req.query("u") || "";
  let target: string;
  try { target = decodeURIComponent(raw); } catch { return c.json({ error: "url invalide" }, 400); }
  if (!/^https?:\/\//.test(target) || target.includes("127.0.0.1") || target.includes("localhost"))
    return c.json({ error: "url refusee" }, 400);
  const origin = target.match(/^(https?:\/\/[^/]+)/)?.[1] ?? "";
  let up: Response;
  try {
    up = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Referer": origin + "/", "Origin": origin },
      signal: AbortSignal.timeout(30000),
    });
  } catch { return c.json({ error: "amont injoignable" }, 502); }
  if (!up.ok && up.status !== 206) return c.json({ error: "amont " + up.status }, 502);
  const ct = (up.headers.get("content-type") || "").toLowerCase();
  const isPlaylist = ct.includes("mpegurl") || ct.includes("m3u") || target.split("?")[0].endsWith(".m3u8");
  if (!isPlaylist) {
    return new Response(up.body, {
      status: up.status,
      headers: { "Content-Type": ct || "application/octet-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  }
  const text = await up.text();
  const base = target.slice(0, target.lastIndexOf("/") + 1);
  const rewritten = text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) {
      // Cles AES et pistes audio : URI="..." a proxifier aussi
      return line.replace(/URI="([^"]+)"/g, (m, u) => {
        const abs = /^https?:\/\//.test(u) ? u : new URL(u, base).href;
        return `URI="/api/stream/tvproxy?u=${encodeURIComponent(abs)}"`;
      });
    }
    const abs = /^https?:\/\//.test(t) ? t : new URL(t, base).href;
    return `/api/stream/tvproxy?u=${encodeURIComponent(abs)}`;
  }).join("\n");
  return c.text(rewritten, 200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
});
