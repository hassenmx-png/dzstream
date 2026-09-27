import { Hono } from "hono";
import { get as httpsGet } from "node:https";

/**
 * Proxy d'images RESTREINT aux hôtes d'affiches connus (TMDB, metahub…).
 * Sert à l'extraction de couleur dominante côté client : certains hôtes
 * (metahub) n'envoient pas d'en-tête CORS, ce qui « souille » le canvas et
 * interdit la lecture des pixels. En passant par le serveur, on sert le
 * même octet avec Access-Control-Allow-Origin: *.
 *
 * Sécurité : liste blanche stricte (pas de proxy ouvert), taille plafonnée.
 */

const ALLOWED: RegExp[] = [
  /^https:\/\/image\.tmdb\.org\//,
  /^https:\/\/images\.metahub\.space\//,
  /^https:\/\/artworks\.thetvdb\.com\//,
  /^https:\/\/assets\.fanart\.tv\//,
];

const MAX_BYTES = 3 * 1024 * 1024;

function httpsBuffer(url: string, timeoutMs = 8000): Promise<{ status: number; type: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { family: 4, timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // Une seule redirection suivie (CDN), toujours bornée par la liste blanche
        const loc = res.headers.location;
        if (!ALLOWED.some((re) => re.test(loc))) {
          reject(new Error("redirection hors liste blanche"));
          return;
        }
        resolve(httpsBuffer(loc, timeoutMs));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error("image trop lourde"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 502,
          type: res.headers["content-type"] ?? "image/jpeg",
          buf: Buffer.concat(chunks),
        }),
      );
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

export const imgApp = new Hono();

imgApp.get("/", async (c) => {
  const url = c.req.query("url") ?? "";
  if (!ALLOWED.some((re) => re.test(url))) return c.json({ error: "hôte non autorisé" }, 403);
  try {
    const { status, type, buf } = await httpsBuffer(url);
    if (status !== 200) return c.json({ error: `amont ${status}` }, 404);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "échec" }, 502);
  }
});
