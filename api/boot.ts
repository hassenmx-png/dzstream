import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { streamApp } from "./stream";
import { syncApp } from "./sync";
import { tmdbApp } from "./tmdb";
import { imgApp } from "./imgproxy";
import { mangaApp } from "./manga";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

// ── Sécurité API ─────────────────────────────────────────────
import { getCookie, setCookie } from "hono/cookie";
import crypto from "node:crypto";

// Code d'accès : .env (ACCESS_CODE) ou généré aléatoirement au démarrage
// (affiché dans le journal, à noter). Le front l'échange contre un cookie
// HttpOnly via POST /api/auth ; toutes les autres routes /api/* l'exigent.
// Si ACCESS_CODE est vide dans le .env : API ouverte (pas de fenêtre code).
// Pour verrouiller l'app, remplissez ACCESS_CODE dans le .env et redémarrez.
const ACCESS_CODE = (process.env.ACCESS_CODE || "").trim();
const AUTH_COOKIE = "dz_auth";
// Rate-limit anti brute-force : 5 tentatives/min ipar IP, puis 429
const authAttempts = new Map<string, { n: number; reset: number }>()
app.use("/api/auth", async (c, n) => {
  if (c.req.method !== "POST") return n()
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown"
  const now = Date.now()
  const rec = authAttempts.get(ip)
  if (rec && now < rec.reset && rec.n >= 5) return c.json({ error: "Trop de tentatives. Réessayez dans une minute." }, 429)
  const res = await n()
  if (c.req.method === "POST") {
    if (!rec || now >= rec.reset) authAttempts.set(ip, { n: 1, reset: now + 60_000 })
    else rec.n += 1
  }
  return res
})


// Rate-limit mémoire : 600 requêtes / min / IP sur /api/*
const buckets = new Map<string, { n: number; t: number }>();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.t > 60_000) { buckets.set(ip, { n: 1, t: now }); return true; }
  if (b.n >= 1500) return false;
  b.n += 1; return true;
}
if (buckets.size > 10_000) buckets.clear();

const AF_BAN=9e5,AF_MAX=5;const af=new Map();
setInterval(()=>{const n=Date.now();for(const[k,v]of af)if(!v.c&&v.b<n-AF_BAN)af.delete(k)},6e5);
app.use("/api/auth",async(c,n)=>{if(c.req.method!=="POST")return n();
const ip=c.req.header("x-real-ip")??c.req.header("x-forwarded-for")?.split(",")[0]?.trim()??"?";
const r=af.get(ip),t=Date.now();
if(r&&r.b>t){c.header("Retry-After",""+Math.ceil((r.b-t)/1000));return c.json({error:"Trop de tentatives."},429)}
await n();
if(c.res.status===401||c.res.status===403){const x=r??{c:0,b:0};x.c++;if(x.c>=AF_MAX){x.b=Date.now()+AF_BAN;x.c=0}af.set(ip,x);await new Promise(s=>setTimeout(s,Math.min(250*2**Math.max(x.c-1,0),4000)))}
else if(c.res.status<300)af.delete(ip)});
app.post("/api/auth", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if ((body.code || "").trim() !== ACCESS_CODE) return c.json({ ok: false }, 401);
  setCookie(c, AUTH_COOKIE, ACCESS_CODE, {
    httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365, secure: true,
  });
  return c.json({ ok: true });
});


// Script de la page de login (fichier externe : la CSP script-src 'self'
// bloque les scripts inline, donc le JS vit ici).
const LOGIN_JS = `document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value.trim()})});if(r.ok)location.href='/';else document.getElementById('e').textContent='Code incorrect';};`;
app.get("/login.js", (c) => c.body(LOGIN_JS, 200, { "Content-Type": "text/javascript" }));

// Garde : la racine (document HTML) exige aussi le jeton -> page login.
app.get("/", async (c, next) => {
  if (!ACCESS_CODE) return next();
  if (getCookie(c, AUTH_COOKIE) === ACCESS_CODE) return next();
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/html")) {
    const login = await import("node:fs/promises").then((m) => m.readFile("/root/work_v43/api/login.html", "utf8"));
    return c.html(login);
  }
  return next();
});

// Garde : routes /api/* (sauf auth + health de l'orchestrateur)
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/auth" || path === "/api/health") return next();

  // CORS strict : seule l'origine du site (pas de *)
  const origin = c.req.header("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "Origine refusée" }, 403);
    } catch { return c.json({ error: "Origine invalide" }, 403); }
  }

  // Rate-limit par IP (sauf proxy d'images : les grilles d'affiches
  // declenchent des vagues de requêtes legitimes)
  if (path !== "/api/img" && path !== "/api/imgproxy") {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!rateLimit(ip)) return c.json({ error: "Trop de requêtes" }, 429);
  }

  // Jeton (cookie HttpOnly) — désactivé si ACCESS_CODE vide.
  // Les liens copiés pour lecteurs externes (VLC, Stremio) n'ont pas de
  // cookie : on accepte le code d'accès en paramètre ?code= en alternative.
  if (ACCESS_CODE && getCookie(c, AUTH_COOKIE) !== ACCESS_CODE) {
    if (c.req.query("code") !== ACCESS_CODE) {
      const accept = c.req.header("accept") ?? "";
      if (accept.includes("text/html") && c.req.method === "GET") {
        const login = await import("node:fs/promises").then((m) => m.readFile("/root/work_v43/api/login.html", "utf8"));
        return c.html(login);
      }
      return c.json({ error: "Code d'accès requis" }, 401);
    }
  }
  await next();
});
// ── Fin sécurité API ─────────────────────────────────────────

// Cache memoire 1 h pour /api/tmdb : le front re-demandait les memes
// recommandations en boucle -> TMDB repondait 429 et bloquait l'app.
const tmdbCache = new Map<string, { body: string; status: number; type: string; at: number }>();
app.use("/api/tmdb/*", async (c, next) => {
  const key = c.req.url;
  const hit = tmdbCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) {
    return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.type } });
  }
  await next();
  if (c.res && c.res.status === 200) {
    const body = await c.res.text();
    const type = c.res.headers.get("content-type") ?? "application/json";
    const status = c.res.status;
    if (tmdbCache.size > 500) tmdbCache.delete(tmdbCache.keys().next().value as string);
    tmdbCache.set(key, { body, status, type, at: Date.now() });
    c.res = new Response(body, { status, headers: { "content-type": type } });
  }
});

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

// Streaming P2P serveur + proxy HTTP (lecture vidéo)
app.route("/api/stream", streamApp);

// Synchro progression/liste entre appareils (code sans compte)
app.route("/api/sync", syncApp);

// Catalogue boosté : TMDB (bandes-annonces FR, casting, recommandations, personnes)
app.route("/api/tmdb", tmdbApp);

// Proxy d'images (hôtes d'affiches uniquement) — sert au halo ambiant
app.route("/api/img", imgApp);

// Scans maison : UI propre dans l'app, Suwayomi reduit au role de backend.
app.route("/api/manga", mangaApp);

// Version de déploiement : change à chaque redémarrage du serveur.
// Le client la sonde régulièrement → propose de recharger après une publication.
const BOOT_ID = `${Date.now()}`
app.get("/api/version", (c) => c.json({ v: BOOT_ID }))

// Sonde de santé : l'orchestrateur de déploiement vérifie que le service
// est bien vivant avant de valider la publication. Doit répondre 200 même
// sans configuration (pas de DB, pas de secrets).
app.get("/api/health", (c) => c.json({ ok: true, status: "healthy" }))

// ── Guide TV (EPG) ────────────────────────────────────────────────
// Le serveur télécharge le XMLTV français (open-epg, ~2,3 Mo gz), le
// parse et renvoie un JSON compact « en ce moment + suivant » par chaîne.
// Le navigateur ne pourrait pas le faire : le CORS d'open-epg est fermé.
// Cache mémoire de 6 h — la page TV reste légère même sur mobile.
interface EpgEntry { now: string; stop: number; next?: string }
let epgCache: { at: number; data: Record<string, EpgEntry> } | null = null

function xmltvTime(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/)
  if (!m) return null
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  const tz = m[7]
  if (tz) {
    const sign = tz[0] === "-" ? -1 : 1
    t -= sign * (+tz.slice(1, 3) * 60 + +tz.slice(3, 5)) * 60000
  }
  return t
}

app.get("/api/tv/epg", async (c) => {
  if (epgCache && Date.now() - epgCache.at < 6 * 3600_000) return c.json(epgCache.data)
  try {
    const { gunzipSync } = await import("node:zlib")
    const res = await fetch("https://www.open-epg.com/files/france.xml.gz", {
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`EPG HTTP ${res.status}`)
    const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8")
    const now = Date.now()
    const byChannel = new Map<string, { title: string; start: number; stop: number }[]>()
    for (const block of xml.split("<programme ").slice(1)) {
      const ch = block.match(/channel="([^"]+)"/)?.[1]
      const start = xmltvTime(block.match(/start="([^"]+)"/)?.[1])
      const stop = xmltvTime(block.match(/stop="([^"]+)"/)?.[1])
      const title = block.match(/<title[^>]*>([^<]*)<\//)?.[1]?.trim()
      if (!ch || start === null || stop === null || !title) continue
      if (stop < now - 6 * 3600_000) continue
      const list = byChannel.get(ch) ?? []
      list.push({ title, start, stop })
      byChannel.set(ch, list)
    }
    const data: Record<string, EpgEntry> = {}
    for (const [ch, list] of byChannel) {
      list.sort((a, b) => a.start - b.start)
      const i = list.findIndex((p) => p.start <= now && now < p.stop)
      if (i === -1) continue
      data[ch] = { now: list[i].title, stop: list[i].stop, next: list[i + 1]?.title }
    }
    epgCache = { at: Date.now(), data }
    return c.json(data)
  } catch (e) {
    console.error("[epg]", e)
    return c.json(epgCache?.data ?? {})
  }
})

// Notifications push serveur (AVANT le catch-all /api/*)
try {
  const { registerPushRoutes, startPushScanner } = await import('./push')
  registerPushRoutes(app)
  startPushScanner()
} catch (e) {
  console.warn('[boot] push désactivé :', (e as Error).message)
}

// Proxy Scans : sert Suwayomi (localhost:4567) sous /scans/ — MÊME ORIGINE
// que l'app, donc l'iframe ne peut jamais être bloquée par Safari/Chrome.
// Les chemins relatifs du WebUI se résolvent naturellement sous /scans/.
app.all("/scans/*", async (c) => {
  try {
    const url = new URL(c.req.url)
    const target = 'http://localhost:4567' + url.pathname.replace(/^\/scans/, '') + url.search
    const headers = new Headers(c.req.raw.headers)
    headers.delete('host'); headers.delete('connection'); headers.set('accept-encoding', 'identity')
    const resp = await fetch(target, {
      method: c.req.method,
      headers,
      // arrayBuffer() et non raw.body : un stream exigerait duplex:"half" sous
      // Node/undici et ferait échouer tous les POST (ex. requêtes GraphQL du WebUI).
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer(),
      redirect: 'manual',
    })
    const h = new Headers(resp.headers)
    h.delete('x-frame-options'); h.delete('content-security-policy'); h.delete('content-length')
    const loc = h.get('location')
    if (loc) h.set('location', '/scans' + (loc.startsWith('/') ? loc : '/' + loc))

    // Réécriture du <base href> : le WebUI Suwayomi est servi sous /scans/,
    // mais son HTML déclare <base href="/"> — les assets relatifs partiraient
    // chercher à la racine du domaine (404) → page blanche. On réécrit en /scans/.
    const type = h.get('content-type') ?? ''
    if (type.includes('text/html')) {
      const text = await resp.text()
      let fixed = text.replace('<base href="/">', '<base href="/scans/">')
      // Purge auto de la clé fantôme : le WebUI Suwayomi lit localStorage
      // ["serverBaseURL"] au démarrage et s'en sert comme adresse API, SANS
      // vérifier qu'elle correspond à l'origine courante. Les téléphones qui
      // ont connu une ancienne URL (tunnel mort) parlent alors à un fantôme :
      // le shell charge (assets relatifs) mais aucune requête API ne part ->
      // écran noir. On efface la clé dès qu'elle ne matche pas l'origine.
      const ghost = `<script>(function(){try{var v=localStorage.getItem("serverBaseURL");if(v&&v.indexOf(window.location.origin)!==0){console.warn("[scans] serverBaseURL fantome purge:",v);localStorage.removeItem("serverBaseURL");}}catch(e){}})();</` + `script>`
      fixed = fixed.replace('<head>', '<head>' + ghost)
      return new Response(fixed, { status: resp.status, headers: h })
    }

    return new Response(resp.body, { status: resp.status, headers: h })
  } catch {
    return c.text('Lecteur de scans indisponible', 502)
  }
})

// Proxy Jackettio (addon Stremio auto-hébergé, localhost:4000) sous /jackettio/
// — MÊME ORIGINE que l'app : fini les tunnels cloudflare éphémères. Les
// endpoints Stremio (/<config>/manifest.json, /stream/…) sont relayés tels quels.
app.all("/jackettio/*", async (c) => {
  try {
    const url = new URL(c.req.url)
    const target = 'http://localhost:4000' + url.pathname.replace(/^\/jackettio/, '') + url.search
    const headers = new Headers(c.req.raw.headers)
    headers.delete('host'); headers.delete('connection'); headers.set('accept-encoding', 'identity')
    const resp = await fetch(target, {
      method: c.req.method,
      headers,
      // arrayBuffer() et non raw.body : un stream exigerait duplex:"half" sous
      // Node/undici et ferait échouer tous les POST (ex. requêtes GraphQL du WebUI).
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer(),
      redirect: 'manual',
    })
    const h = new Headers(resp.headers)
    h.delete('content-length'); h.delete('content-encoding')
    const loc = h.get('location')
    if (loc) h.set('location', '/jackettio' + (loc.startsWith('/') ? loc : '/' + loc))
    return new Response(resp.body, { status: resp.status, headers: h })
  } catch {
    return c.text('Addon Jackettio indisponible', 502)
  }
})

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
  const port = parseInt(process.env.PORT || "3000");
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // ── Relais WebSocket /scans/* → Suwayomi (127.0.0.1:4567) ──────────
  // Le proxy HTTP ci-dessus ne suffit pas : le WebUI Suwayomi ouvre un
  // WebSocket (subscriptions GraphQL). Sans ce handler, la requête
  // d'upgrade retombe sur le proxy HTTP → réponse non-101 → page blanche.
  // On réécrit la ligne de requête (chemin sans le préfixe /scans), on
  // conserve les en-têtes (sauf host/connection/upgrade, réécrits), puis
  // on pipe les sockets dans les deux sens avec destruction propre en
  // cas d'erreur.
  const net = await import("node:net");
  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (!url.pathname.startsWith("/scans/")) { socket.destroy(); return; }
      const targetPath = url.pathname.replace(/^\/scans/, "") + url.search;
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      delete headers.upgrade;
      const lines = [
        `GET ${targetPath} HTTP/1.1`,
        "Host: 127.0.0.1:4567",
        "Connection: Upgrade",
        "Upgrade: websocket",
      ];
      for (const [k, v] of Object.entries(headers)) {
        if (v === undefined) continue;
        lines.push(Array.isArray(v) ? `${k}: ${v.join(", ")}` : `${k}: ${v}`);
      }
      const upstream = net.connect(4567, "127.0.0.1", () => {
        upstream.write(lines.join("\r\n") + "\r\n\r\n");
        if (head && head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on("error", () => { socket.destroy(); upstream.destroy(); });
      socket.on("error", () => { upstream.destroy(); socket.destroy(); });
    } catch {
      socket.destroy();
    }
  });
}
