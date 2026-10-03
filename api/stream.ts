import { Hono } from "hono";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import type WebTorrent from "webtorrent";

type Torrent = import("webtorrent").Torrent;
type WTClient = InstanceType<typeof WebTorrent>;

/**
 * Moteur de streaming P2P côté serveur.
 * - GET /torrent?infoHash=..&fileIdx=..  -> stream HTTP avec support Range
 * - GET /stats?infoHash=..               -> état du téléchargement (pairs, vitesse, progression)
 * - GET /proxy?url=..                    -> proxy HTTP(S) avec passthrough Range (anti-CORS)
 *
 * Le client WebTorrent est chargé en import dynamique : si le module natif
 * (node-datachannel) est indisponible sur l'hôte, le serveur démarre quand
 * même et les routes P2P renvoient 503 — le frontend bascule alors sur
 * WebTorrent navigateur.
 */

const app = new Hono();

// ---- Client WebTorrent partagé (chargement paresseux + tolérant) ----

let clientPromise: Promise<WTClient> | null = null;

async function getClient(): Promise<WTClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const mod = await import("webtorrent");
      const WebTorrent = (mod as { default?: new (o: { maxConns: number }) => WTClient })
        .default ?? (mod as unknown as new (o: { maxConns: number }) => WTClient);
      return new WebTorrent({ maxConns: 100 });
    })();
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
}

interface TorrentEntry {
  torrent?: Torrent;
  lastUsed: number;
  readyPromise: Promise<TorrentEntry>;
  prebuffered?: boolean;
}

/**
 * Pré-télécharge les ~30 premiers Mo du fichier dès que les métadonnées
 * sont là. CRUCIAL : webtorrent ne télécharge rien tant que personne ne
 * lit le fichier — sans ce préchargement, le lecteur attend indéfiniment
 * des données qui n'arrivent jamais (écran noir garanti).
 */
function prebuffer(entry: TorrentEntry, fileIdx: string | undefined): void {
  if (entry.prebuffered || !entry.torrent?.ready) return;
  entry.prebuffered = true;
  const files = entry.torrent.files;
  let f = fileIdx != null ? files[Number(fileIdx)] : undefined;
  if (!f && files.length) f = files.reduce((a, b) => (a.length > b.length ? a : b));
  if (!f) return;
  // 48 Mo de début de fichier en priorité maximale : de quoi démarrer la
  // lecture immédiatement et tenir la première minute sans rebuffering.
  const end = Math.min(f.length - 1, 48 * 1024 * 1024);
  try {
    // select() existe à l'exécution mais n'est pas dans les types webtorrent.
    // Priorité haute (10) : ces pièces du début passent avant tout le reste.
    (f as unknown as { select: (start: number, end: number, priority?: number) => void }).select(0, end, 10);
  } catch { /* ignore */ }
}

const torrents = new Map<string, TorrentEntry>();

// Trackers publics par défaut : accélèrent fortement la récupération des
// métadonnées et la connexion aux pairs (la DHT seule peut prendre >60 s).
// Mix UDP + HTTP(S) : si le réseau bloque l'UDP, les trackers HTTP passent.
const DEFAULT_TRACKERS = [
  // UDP : rapides mais souvent bloqués par les réseaux
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  // HTTP(S) : passent là où l'UDP est bloqué
  "https://tracker.opentrackr.org:443/announce",
  "https://tracker.lilithraws.org:443/announce",
  "https://tracker.tamersunion.org:443/announce",
  "https://tracker.nanoha.org:443/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "http://tracker.gbitt.info:80/announce",
  // WebSocket : pairs web + réseaux très restrictifs
  "wss://tracker.openwebtorrent.com",
];

function getTorrent(infoHash: string, trackers: string[] = []): Promise<TorrentEntry> {
  const existing = torrents.get(infoHash);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.readyPromise;
  }
  const allTrackers = [...new Set([...trackers, ...DEFAULT_TRACKERS])];
  const magnet =
    "magnet:?xt=urn:btih:" +
    infoHash +
    allTrackers.map((t) => "&tr=" + encodeURIComponent(t)).join("");
  const entry = {} as TorrentEntry;
  entry.lastUsed = Date.now();
  entry.readyPromise = (async () => {
    const client = await getClient();
    const torrent = client.add(magnet);
    entry.torrent = torrent;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Torrent introuvable (aucune métadonnée reçue)")),
        60000,
      );
      torrent.on("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      torrent.on("error", (err) => {
        clearTimeout(timeout);
        reject(err as Error);
      });
    });
    return entry;
  })();
  entry.readyPromise.catch(() => {
    torrents.delete(infoHash);
    try { entry.torrent?.destroy(); } catch { /* ignore */ }
  });
  torrents.set(infoHash, entry);
  return entry.readyPromise;
}

// Nettoie les torrents inactifs depuis plus de 15 minutes
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [hash, entry] of torrents) {
    if (now - entry.lastUsed > 15 * 60 * 1000) {
      torrents.delete(hash);
      try { entry.torrent?.destroy(); } catch { /* ignore */ }
    }
  }
}, 60 * 1000);
sweeper.unref?.();

// ---- Utilitaires ----

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  ts: "video/mp2t",
};

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, Content-Type",
    // JAMAIS de cache : sinon Chrome peut resservir un bout de réponse 206
    // partielle d'une lecture précédente → le même lien « ne marche plus »
    // au deuxième essai et il faut forcer pour le relancer.
    "Cache-Control": "no-store",
  };
}

// ---- Routes ----

app.options("*", (c) => c.body(null, 204, corsHeaders()));

app.get("/stats", async (c) => {
  const infoHash = c.req.query("infoHash")?.toLowerCase();
  if (!infoHash) return c.json({ error: "infoHash manquant" }, 400);
  const fileIdxQ = c.req.query("fileIdx");
  const entry = torrents.get(infoHash);
  if (!entry) {
    // Instance froide (les requêtes peuvent atterrir sur des instances
    // différentes derrière la passerelle) : on démarre le torrent ici aussi.
    if (!/^[a-f0-9]{40}$|^[a-z2-7]{32}$/.test(infoHash)) {
      return c.json({ ready: false, peers: 0, downloadSpeed: 0, downloaded: 0, progress: 0 });
    }
    const trackers = (c.req.queries("tr") ?? []).filter((t) => /^(udp|https?|wss?):\/\//.test(t));
    getTorrent(infoHash, trackers)
      .then((e) => prebuffer(e, fileIdxQ))
      .catch(() => { /* le client continuera de poller */ });
    return c.json({ ready: false, peers: 0, downloadSpeed: 0, downloaded: 0, progress: 0 });
  }
  entry.lastUsed = Date.now();
  if (!entry.torrent) return c.json({ ready: false, peers: 0, downloadSpeed: 0, downloaded: 0, progress: 0 });
  const t = entry.torrent;
  // Dès que le torrent est prêt : précharge le début du film (sinon rien
  // ne se télécharge tant que la vidéo n'est pas branchée — cercle vicieux).
  prebuffer(entry, fileIdxQ);
  // Nom du fichier qui sera servi (celui demandé, sinon le plus gros) :
  // permet au lecteur de détecter les conteneurs non lisibles (MKV, AVI…)
  // AVANT de brancher la vidéo, et de basculer sur le transcodage cloud.
  let fileName: string | undefined;
  if (t.ready) {
    const fileIdx = c.req.query("fileIdx");
    let f = fileIdx != null ? t.files[Number(fileIdx)] : undefined;
    if (!f && t.files.length) f = t.files.reduce((a, b) => (a.length > b.length ? a : b));
    fileName = f?.name;
  }
  return c.json({
    ready: t.ready,
    name: t.name,
    fileName,
    peers: t.numPeers,
    downloadSpeed: t.downloadSpeed,
    // Le getter existe au runtime mais manque dans les types publiés
    downloaded: (t as unknown as { downloaded: number }).downloaded,
    progress: t.progress,
  });
});

app.get("/torrent", async (c) => {
  const infoHash = c.req.query("infoHash")?.toLowerCase();
  if (!infoHash || !/^[a-f0-9]{40}$|^[a-z2-7]{32}$/.test(infoHash)) {
    return c.json({ error: "infoHash invalide" }, 400);
  }
  const fileIdx = c.req.query("fileIdx");
  // Trackers transmis par le client (ceux de la source) + les nôtres
  const trackers = (c.req.queries("tr") ?? []).filter((t) => /^(udp|https?|wss?):\/\//.test(t));

  // Mode warmup : démarre le téléchargement SANS attendre les métadonnées.
  // Réponse immédiate (202) — évite les timeouts de passerelle sur les
  // requêtes longues ; le client poll /stats puis branche la vidéo.
  if (c.req.query("warm")) {
    getTorrent(infoHash, trackers)
      .then((e) => prebuffer(e, fileIdx))
      .catch(() => { /* géré côté client via /stats */ });
    return c.json({ status: "warming" }, 202);
  }

  let entry: TorrentEntry;
  try {
    entry = await getTorrent(infoHash, trackers);
  } catch (e) {
    const msg = (e as Error).message ?? "erreur inconnue";
    const engineDown = /webtorrent|node-datachannel|engine|moteur|Cannot find|ERR_MODULE/i.test(msg);
    return c.json({ error: msg }, engineDown ? 503 : 504);
  }

  entry.lastUsed = Date.now();

  const files = entry.torrent!.files;
  let file = fileIdx != null ? files[Number(fileIdx)] : undefined;
  if (!file && files.length) {
    file = files.reduce((a, b) => (a.length > b.length ? a : b));
  }
  if (!file) return c.json({ error: "Aucun fichier disponible" }, 409);

  const range = c.req.header("range");
  const total = file.length;
  let start = 0;
  let end = total - 1;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = Math.min(parseInt(m[2], 10), total - 1);
    }
  }

  if (start >= total || end < start) {
    return c.body(null, 416, {
      ...corsHeaders(),
      "Content-Range": "bytes */" + total,
    });
  }

  const nodeStream = file.createReadStream({ start, end });
  // file.createReadStream renvoie un stream streamx (pas un Readable Node
  // natif) : Readable.toWeb() plante dessus. On convertit à la main avec
  // gestion de la backpressure (pause/resume selon la demande du client).
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Uint8Array | Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 1) <= 0) nodeStream.pause();
      });
      nodeStream.on("end", () => {
        try { controller.close(); } catch { /* déjà fermé */ }
      });
      nodeStream.on("error", (err: unknown) => {
        try { controller.error(err); } catch { /* ignore */ }
      });
    },
    pull() {
      nodeStream.resume();
    },
    cancel() {
      nodeStream.destroy();
    },
  });

  return c.body(webStream, 206, {
    ...corsHeaders(),
    "Content-Type": mimeFor(file.name),
    "Content-Length": String(end - start + 1),
    "Content-Range": "bytes " + start + "-" + end + "/" + total,
    "Accept-Ranges": "bytes",
  });
});

app.get("/proxy", async (c) => {
  const url = c.req.query("url");
  if (url && url.startsWith("/")) return c.redirect(url, 302);
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: "url invalide" }, 400);

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  const range = c.req.header("range");
  if (range) headers["Range"] = range;

  try {
    const upstream = await fetch(url, { headers, redirect: "follow" });
    // Clé debrid refusée : Torrentio redirige vers une vidéo « Access denied ».
    // On renvoie une erreur au lieu de la STREAMER (sinon le lecteur la lit
    // comme un vrai film au lieu de basculer sur la source suivante).
    if (/failed_access/i.test(upstream.url)) {
      try {
        await upstream.body?.cancel();
      } catch {
        /* ignoré */
      }
      return c.json({ error: "Lien premium refusé : clé debrid invalide ou expirée." }, 502, corsHeaders());
    }
    const outHeaders: Record<string, string> = { ...corsHeaders() };
    // NB : on NE copie PAS content-length — le corps est streamé (chunked) et un
    // Content-Length en conflit casse HTTP/2 côté navigateur (connexion coupée).
    for (const h of ["content-type", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) outHeaders[h] = v;
    }
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (e) {
    return c.json({ error: "Proxy: " + (e as Error).message }, 502);
  }
});

// Vérification d'un lien /resolve/ (Torrentio + debrid) : suit la redirection
// SANS JAMAIS télécharger depuis le CDN du debrideur. AllDebrid bannit les
// comptes dont le trafic vient d'IPs de serveurs — une seule requête vers
// Torrentio suffit (c'est Torrentio qui débloque le lien), on lit l'en-tête
// Location et on s'arrête là. Zéro contact serveur ↔ CDN debrid.
// Une clé invalide redirige vers torrentio.strem.fun/videos/failed_access_*.mp4.
app.get("/resolve-check", async (c) => {
  const url = c.req.query("url");
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: "url invalide" }, 400);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      redirect: "manual",
      signal: ctrl.signal,
    });
    // Torrentio répond 301/302 → Location = lien final (CDN debrid ou
    // placeholder). Pas de redirection : on prend l'URL telle quelle.
    const loc = upstream.headers.get("location");
    const finalUrl = loc ? new URL(loc, url).href : upstream.url;
    try {
      await upstream.body?.cancel();
    } catch {
      /* ignoré */
    }
    return c.json({ finalUrl, status: upstream.status }, 200, corsHeaders());
  } catch (e) {
    return c.json({ error: "Vérification impossible: " + (e as Error).message }, 502);
  } finally {
    clearTimeout(timer);
  }
});

// Diagnostic précis d'une clé debrid (AllDebrid) : interroge l'API officielle
// pour distinguer « clé invalide », « compte non premium / expiré » et
// « AUTH_BLOCKED » (AllDebrid exige une confirmation par email pour toute
// nouvelle localisation — le message générique « clé refusée » induisait
// l'utilisateur en erreur).
app.get("/debrid-check", async (c) => {
  const service = c.req.query("service");
  const key = c.req.query("key");
  // Les clés TorBox sont des UUID avec tirets — on les accepte.
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) return c.json({ error: "paramètres invalides" }, 400);

  if (service === "alldebrid") {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const { execSync } = await import("node:child_process");
      const raw = execSync(
        `docker exec mediaflow python3 -c "import urllib.request;print(urllib.request.urlopen('https://api.alldebrid.com/v4/user?agent=novastream&apikey=${encodeURIComponent(key)}',timeout=10).read().decode())"`,
        { timeout: 15000 },
      ).toString();
      const j = JSON.parse(raw) as {
        status: string;
        data?: { user?: { isPremium?: boolean; premiumUntil?: number; username?: string } };
        error?: { code?: string };
      };
      if (j.status === "success" && j.data?.user) {
        const u = j.data.user;
        const premiumUntil = u.premiumUntil ?? 0;
        const premium = !!u.isPremium && premiumUntil * 1000 > Date.now();
        // Compte à rebours côté client (carte premium de l'onglet Addons)
        const daysLeft = premiumUntil ? Math.max(0, Math.ceil((premiumUntil * 1000 - Date.now()) / 86400000)) : null;
        return c.json({ ok: true, premium, premiumUntil, daysLeft, username: u.username }, 200, corsHeaders());
      }
      return c.json({ ok: false, code: j.error?.code ?? "UNKNOWN" }, 200, corsHeaders());
    } catch (e) {
      return c.json({ error: "Vérification impossible: " + (e as Error).message }, 502);
    } finally {
      clearTimeout(timer);
    }
  }
  if (service === "torbox") {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch("https://api.torbox.app/v1/api/user/me", {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      const j = (await r.json()) as {
        success?: boolean;
        data?: { plan?: number; email?: string; premium_expires_at?: string };
      };
      if (r.ok && j.success && j.data) {
        const exp = j.data.premium_expires_at ? new Date(j.data.premium_expires_at).getTime() : 0;
        const daysLeft = exp ? Math.max(0, Math.ceil((exp - Date.now()) / 86400000)) : null;
        return c.json({
          ok: true,
          premium: (j.data.plan ?? 0) >= 0,
          username: j.data.email,
          plan: j.data.plan ?? 0,
          premiumExpiresAt: j.data.premium_expires_at ?? null,
          daysLeft,
        }, 200, corsHeaders());
      }
      return c.json({ ok: false, code: "AUTH_BAD_APIKEY" }, 200, corsHeaders());
    } catch (e) {
      return c.json({ error: "Vérification impossible: " + (e as Error).message }, 502);
    } finally {
      clearTimeout(timer);
    }
  }
  // Autres services : pas de diagnostic dédié — le test /resolve/ suffit.
  return c.json({ ok: null }, 200, corsHeaders());
});

// Analyse le codec audio d'un fichier distant en scannant ses 2 premiers Mo
// (en-têtes MKV/MP4). Utilisé pour les liens premium lus en DIRECT (cross-origin,
// le détecteur Web Audio est impossible) : AC3/E-AC3/DTS = silence garanti dans
// Chrome/Firefox → le lecteur enchaîne alors sur la source suivante.
// Coût : une requête Range de 2 Mo — négligeable, pas du streaming serveur.
app.get("/audio-probe", async (c) => {
  const url = c.req.query("url");
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: "url invalide" }, 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      headers: {
        Range: "bytes=0-2097151",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!r.ok && r.status !== 206) return c.json({ audio: "unknown" }, 200, corsHeaders());
    const buf = Buffer.from(await r.arrayBuffer());
    const has = (needle: string) => buf.includes(needle);
    // Marqueurs réels : CodecID Matroska (A_EAC3…) et fourcc MP4 (ec-3…).
    // Risqué testé EN PREMIER : un MULTI avec piste AC3 + piste AAC reste
    // muet si Chrome prend la piste AC3 par défaut.
    const risky = ["A_EAC3", "EAC3", "A_AC3", "A_DTS", "A_TRUEHD", "TRUEHD", "ec-3", "ac-3", "ac-4", "dtsc", "dtsh", "dtse"].some(has);
    const safe = ["A_AAC", "A_OPUS", "A_MPEG", "A_VORBIS", "mp4a", "Opus"].some(has);
    return c.json({ audio: risky ? "risky" : safe ? "ok" : "unknown" }, 200, corsHeaders());
  } catch {
    return c.json({ audio: "unknown" }, 200, corsHeaders());
  } finally {
    clearTimeout(timer);
  }
});

// ---- Transcodage audio à la volée (dernier recours anti « film muet ») ----
// Les pistes AC3/E-AC3/DTS/TrueHD passent en vidéo mais SANS SON dans
// Chrome/Firefox/Edge. Ici la vidéo est COPIÉE bit à bit (zéro recompression,
// CPU quasi nul) et SEULE la piste audio est ré-encodée en AAC stéréo.
// Le flux sort en Matroska progressif, lu nativement par le navigateur.
//
// GET /tc-info?url=..                  -> { duration, videoCodec, audioTrack, audioLangs }
// GET /transcode?url=..&track=..&t=..  -> flux MKV (vidéo copiée, audio AAC)

interface TcInfo {
  duration: number;
  videoCodec: string;
  audioTrack: number;
  audioLangs: string[];
}
const tcInfoCache = new Map<string, { at: number; info: TcInfo }>();

// ffmpeg/ffprobe ne suivent pas les 302 et leur User-Agent (Lavf/…) est bloqué
// par les CDN debrid. On résout donc la redirection nous-mêmes (1 requête,
// sans télécharger) et on passe l'URL FINALE à ffmpeg avec un UA navigateur.
const FFMPEG_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const resolvedUrlCache = new Map<string, { at: number; finalUrl: string }>();

async function resolveFinalUrl(url: string): Promise<string> {
  const hit = resolvedUrlCache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.finalUrl;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": FFMPEG_UA },
      redirect: "manual",
      signal: ctrl.signal,
    });
    const loc = r.headers.get("location");
    const finalUrl = loc ? new URL(loc, url).href : url;
    try { await r.body?.cancel(); } catch { /* ignoré */ }
    resolvedUrlCache.set(url, { at: Date.now(), finalUrl });
    if (resolvedUrlCache.size > 80) {
      const oldest = [...resolvedUrlCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) resolvedUrlCache.delete(oldest[0]);
    }
    return finalUrl;
  } catch {
    return url; // en cas d'échec on tente l'URL d'origine
  } finally {
    clearTimeout(timer);
  }
}

/** Sonde ffprobe : durée + codec vidéo + meilleure piste audio (FR d'abord). */
async function probeTcInfo(url: string): Promise<TcInfo | null> {
  const hit = tcInfoCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.info;
  const input = await resolveFinalUrl(url);
  const info = await new Promise<TcInfo | null>((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-user_agent", FFMPEG_UA,
      "-show_entries", "stream=index,codec_type,codec_name:stream_tags=language,title:format=duration",
      "-of", "json",
      input,
    ]);
    let out = "";
    const timer = setTimeout(() => { p.kill("SIGKILL"); resolve(null); }, 25000);
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => { clearTimeout(timer); resolve(null); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !out) { resolve(null); return; }
      try {
        const j = JSON.parse(out) as {
          streams?: { index: number; codec_type?: string; codec_name?: string; tags?: { language?: string; title?: string } }[];
          format?: { duration?: string };
        };
        const streams = j.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video");
        const audios = streams.filter((s) => s.codec_type === "audio");
        if (!video || audios.length === 0) { resolve(null); return; }
        // Piste FR en priorité (language=fre/fra/fr ou titre explicite),
        // sinon la première piste audio (convention scene : piste principale).
        const fr = audios.find((s) => /^(fre|fra|fr)$/i.test(s.tags?.language ?? ""))
          ?? audios.find((s) => /\b(vf|vff|french|fran[cç]ais)\b/i.test(s.tags?.title ?? ""));
        const chosen = fr ?? audios[0];
        resolve({
          duration: parseFloat(j.format?.duration ?? "0") || 0,
          videoCodec: (video.codec_name ?? "unknown").toLowerCase(),
          audioTrack: chosen.index,
          audioLangs: audios.map((s) => s.tags?.language ?? "?"),
        });
      } catch {
        resolve(null);
      }
    });
  });
  if (info) tcInfoCache.set(url, { at: Date.now(), info });
  // Nettoyage simple du cache (évite la croissance infinie)
  if (tcInfoCache.size > 60) {
    const oldest = [...tcInfoCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) tcInfoCache.delete(oldest[0]);
  }
  return info;
}

app.get("/tc-info", async (c) => {
  const url = c.req.query("url");
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: "url invalide" }, 400);
  const info = await probeTcInfo(url).catch(() => null);
  if (!info) return c.json({ error: "sonde impossible" }, 502);
  return c.json(info, 200, corsHeaders());
});

app.get("/transcode", async (c) => {
  const url = c.req.query("url");
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: "url invalide" }, 400);
  const t = Math.max(0, parseFloat(c.req.query("t") ?? "0") || 0);
  const eco1080 = c.req.query("q") === "1080";
  let track = parseInt(c.req.query("track") ?? "-1", 10);
  if (track < 0) {
    const info = await probeTcInfo(url).catch(() => null);
    track = info?.audioTrack ?? -1;
  }

  const input = await resolveFinalUrl(url);
  const args = [
    "-hide_banner", "-loglevel", "error",
    // Seek EN AMONT de l'input : ffmpeg demande directement la bonne plage
    // HTTP (Range) au CDN — pas besoin de télécharger le début du fichier.
    ...(t > 0 ? ["-ss", String(t)] : []),
    "-user_agent", FFMPEG_UA,
    // Reconnexion automatique si le CDN coupe la connexion en cours de route.
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-i", input,
    "-map", "0:v:0",
    ...(track >= 0 ? ["-map", `0:${track}`] : ["-map", "0:a:0"]),
    // Mode éco (q=1080) : réencodage 1080p x264 veryfast (temps réel sur 2 vCPU).
    // Sinon vidéo copiée telle quelle (zéro CPU, qualité d'origine).
    ...(eco1080
      ? ["-vf", "scale=1920:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
      : ["-c:v", "copy"]),
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", // audio universel
    "-sn", "-dn",             // sous-titres/données embarqués ignorés (OpenSubtitles gère)
    "-f", "matroska",
    "-flush_packets", "1",    // démarrage quasi immédiat
    "-max_muxing_queue_size", "1024",
    "pipe:1",
  ];
  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });

  // Le client coupe (fermeture onglet, seek…) → on tue ffmpeg aussitôt,
  // sinon il continuerait à pomper le CDN pour rien.
  const kill = () => { try { ff.kill("SIGKILL"); } catch { /* déjà mort */ } };
  c.req.raw.signal.addEventListener("abort", kill);
  ff.on("error", kill);

  const stream = Readable.toWeb(ff.stdout) as unknown as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "video/x-matroska",
      "Cache-Control": "no-store",
    },
  });
});

export { app as streamApp };

// ─── Flux opaques CHIFFRÉS : /wrap + /play (AES-256-GCM — illisible côté client) ───
// Passthrough natif : Content-Length / Accept-Ranges / Content-Range préservés
// (durée + seek fiables). Plus de transcode forcé ici — le cas AC3/DTS garde
// sa route dédiée /transcode (ffprobe).
const _require = createRequire(import.meta.url);

// Charge .env.local au runtime (indépendant de systemd)
try {
  const fs = _require("node:fs") as typeof import("node:fs");
  for (const cand of ["/root/work_v43/.env.local", new URL("../.env.local", import.meta.url).pathname]) {
    try {
      for (const line of fs.readFileSync(cand, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !m[1].startsWith("VITE_") && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
      break;
    } catch {}
  }
} catch {}

const STREAMING_SECRET = process.env.STREAMING_SECRET || "dzstream-dev-secret";
const MF_PW = process.env.MEDIAFLOW_API_PASSWORD || "";
const _crypto = _require("node:crypto") as typeof import("node:crypto");
const ENC_KEY = _crypto.createHash("sha256").update(`${STREAMING_SECRET}:enc`).digest();

/** Chiffre le payload (AES-256-GCM) : confidentiel ET inviolable. */
function encodeToken(u: string, t?: number): string {
  const payload = Buffer.from(JSON.stringify({ u, e: Date.now() + 6 * 3600 * 1000, ...(t ? { t } : {}) }));
  const iv = _crypto.randomBytes(12);
  const cipher = _crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

/** Déchiffre + authentifie le token. Null si falsifié ou corrompu. */
function decodeToken(token: string): { u?: string; e?: number } | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = _crypto.createDecipheriv("aes-256-gcm", ENC_KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(dec.toString()) as { u?: string; e?: number; t?: number };
  } catch {
    return null;
  }
}

app.post("/wrap", async (c) => {
  let body: { urls?: unknown; flags?: unknown } = {};
  try { body = await c.req.json(); } catch {}
  const urls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u) && u.length < 4096)
    : [];
  const flags = Array.isArray(body.flags) ? body.flags : [];
  const code = c.req.query("code") || "";
  const plays = urls.map((u, i) => `/api/stream/play/${encodeToken(u, flags[i] === 1 ? 1 : 0)}` + (code ? `?code=${encodeURIComponent(code)}` : ""));
  return c.json({ plays });
});

app.get("/play/:token", async (c) => {
  try {
    return await handlePlay(c);
  } catch (err) {
    console.error("[play] EXCEPTION:", (err as Error)?.stack ?? String(err));
    return c.json({ error: "erreur interne du lecteur" }, 500);
  }
});

async function handlePlay(c: any) {
  const tok = c.req.param("token");
  const data = decodeToken(tok);
  if (!data) {
    console.log("[play] 403 DECODE FAIL - longueur:", tok.length, "début:", tok.slice(0, 24));
    return c.json({ error: "token invalide ou falsifié" }, 403);
  }
  if (!data.u || !/^https?:\/\//.test(data.u)) return c.json({ error: "URL invalide" }, 400);
  if (data.e && data.e < Date.now()) return c.json({ error: "lien expiré (6 h max)" }, 410);
  const target = data.u.replace("https://comet.dzstream.duckdns.org", "http://127.0.0.1:8001");

  // Torrentio est derrière Cloudflare qui bloque les clients non-navigateur
  // (empreinte TLS, UA trompeur ou pas). On redirige donc le VRAI navigateur
  // directement : il passera la protection sans problème. La clé debrid dans
  // l'URL est celle de l'utilisateur, déjà visible dans son propre navigateur.
  if (/^https:\/\/torrentio\.strem\.fun\//.test(target)) {
    return c.redirect(target, 302);
  }

  // Audio Fix : piste AC3/DTS non décodée par le navigateur -> transcodage
  // audio AAC à la volée via mediaflow (vidéo H.264 copiée, seek préservé
  // par index de cues). Le drapeau t est posé par /wrap côté client.
  if (data.t) {
    const d = encodeURIComponent(target);
    return c.redirect(`https://dzstream.duckdns.org/mf/proxy/stream?d=${d}&transcode=true`, 302);
  }

  // Passthrough : on stream tel quel en préservant les en-têtes de plage
  // (durée fiable + seek dans le player). Pas de transcode forcé.
  try {
    const range = c.req.header("range");
    const upstream = await fetch(target, {
      headers: {
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        ...(range ? { "Range": range } : {}),
      },
      redirect: "follow",
    });
    console.log("[play] target:", (data.u ?? "").slice(0, 80), "-> upstream:", upstream.status, upstream.url.slice(0, 80));
    // Page d'erreur en amont (ex. AllDebrid "Serveur non autorisé") : on
    // renvoie un 502 JSON propre pour que le player passe à la source suivante.
    // Une réponse vidéo ne doit JAMAIS être du HTML : page d'erreur TorBox
    // (« not cached yet »), AllDebrid, etc. → 502 JSON → repli auto sur la
    // source suivante, quel que soit le statut (même 200).
    if ((upstream.headers.get("content-type") ?? "").includes("text/html")) {
      return c.json({ error: `flux indisponible en amont (HTTP ${upstream.status})` }, 502);
    }
    const headers = new Headers();
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has("Accept-Ranges")) headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-cache");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return c.json({ error: "flux indisponible" }, 502);
  }
}

// ─── Santé debrid CÔTÉ SERVEUR : les clés ne transitent JAMAIS par le client ───
app.get("/health", async (c) => {
  const service = (c.req.query("service") || "alldebrid").toLowerCase();
  const envName = service === "torbox" ? "TORBOX_API_KEY" : "ALLDEBRID_API_KEY";
  const key = (process.env[envName] || "").trim();
  if (!key) return c.json({ ok: true, reason: "no-server-key" });
  try {
    if (service === "torbox") {
      const res = await fetch("https://api.torbox.app/v1/api/user/me", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });
      const j = (await res.json()) as { success?: boolean };
      if (!res.ok || !j.success) return c.json({ ok: false, reason: "invalid" });
      return c.json({ ok: true });
    }
    const res = await fetch(`https://api.alldebrid.com/v4/user?agent=novastream&apikey=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(6000),
    });
    const j = (await res.json()) as { status: string; error?: { code?: string }; data?: { user?: { isPremium?: boolean } } };
    if (j.status === "error") return c.json({ ok: false, reason: j.error?.code === "AUTH_USER_BANNED" ? "banned" : "invalid" });
    if (j.data?.user && !j.data.user.isPremium) return c.json({ ok: false, reason: "expired" });
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: true, reason: "network" }); // fail-open
  }
});

// Garde-fous : une erreur non gérée se logge, elle ne coupe jamais la connexion.
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
