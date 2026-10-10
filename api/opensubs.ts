import { Hono } from "hono";

/**
 * Proxy OpenSubtitles. Leur API n'envoie AUCUN en-tête CORS : tous les
 * appels navigateur (recherche, download, lien signé dl.opensubtitles.com)
 * étaient bloqués — les sous-titres FR ne fonctionnaient jamais.
 * La clé reste côté client et transite dans le header x-os-key.
 */
export const opensubsApp = new Hono();

const UP = "https://api.opensubtitles.com/api/v1";

opensubsApp.get("/subtitles", async (c) => {
  const key = c.req.header("x-os-key") ?? "";
  if (!key) return c.json({ data: [] }, 401);
  try {
    const qs = new URL(c.req.url).searchParams;
    const r = await fetch(`${UP}/subtitles?${qs}`, {
      headers: { "Api-Key": key, "User-Agent": "DZ STREAM" },
      signal: AbortSignal.timeout(10000),
    });
    return c.json(await r.json(), r.status as 200);
  } catch {
    return c.json({ data: [] }, 502);
  }
});

opensubsApp.post("/download", async (c) => {
  const key = c.req.header("x-os-key") ?? "";
  if (!key) return c.json({ message: "clé manquante" }, 401);
  try {
    const r = await fetch(`${UP}/download`, {
      method: "POST",
      headers: { "Api-Key": key, "User-Agent": "DZ STREAM", "Content-Type": "application/json" },
      body: await c.req.text(),
      signal: AbortSignal.timeout(10000),
    });
    return c.json(await r.json(), r.status as 200);
  } catch {
    return c.json({ message: "OpenSubtitles indisponible" }, 502);
  }
});

// Le lien signé (dl.opensubtitles.com) est lui aussi sans CORS → proxifié.
opensubsApp.get("/file", async (c) => {
  const u = c.req.query("u") ?? "";
  if (!u.startsWith("https://dl.opensubtitles.com/")) return c.text("url invalide", 400);
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(25000) });
    const buf = await r.arrayBuffer();
    return new Response(buf, { status: r.status, headers: { "content-type": "application/octet-stream" } });
  } catch {
    return c.text("téléchargement impossible", 502);
  }
});
