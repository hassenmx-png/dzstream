// API Manga maison — source MangaDex en DIRECT via son API REST.
// L'extension Suwayomi n'est plus utilisée (givree) : plus de
// "No chapters found", plus de doublons vides (filtre natif
// hasAvailableChapters), rate-limiting poli (250 ms entre requetes).
import { Hono } from "hono";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { readFile as rf, writeFile as wf } from "node:fs/promises";
import { createHash } from "node:crypto";

const MD = "https://api.mangadex.org";
const SUWAYOMI = "http://127.0.0.1:4567";
const LIBRARY_FILE = "/root/work_v43/data/manga-library.json";
const CACHE_DIR = "/root/work_v43/data/img-cache";
const CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 jours

/* ── MangaDex helpers ─────────────────────────────────────── */
let mdChain: Promise<void> = Promise.resolve();
function md(path: string): Promise<any> {
  const run = mdChain.then(async () => {
    await new Promise((r) => setTimeout(r, 250));
    const r = await fetch(MD + path, {
      headers: { "user-agent": "DZStream/2.0 (self-hosted manga reader)" },
    });
    if (!r.ok) throw new Error("MangaDex HTTP " + r.status);
    return r.json();
  });
  mdChain = run.then(() => undefined, () => undefined);
  return run;
}

const pick = (obj: any, ...langs: string[]) => {
  if (!obj) return undefined;
  for (const l of langs) if (obj[l]) return obj[l];
  const k = Object.keys(obj)[0];
  return k ? obj[k] : undefined;
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const coverOf = (m: any) => {
  const rel = m.relationships?.find((r: any) => r.type === "cover_art");
  const f = rel?.attributes?.fileName;
  return f ? `https://uploads.mangadex.org/covers/${m.id}/${f}.256.jpg` : "";
};

// Images proxifiées : certains réseaux mobiles bloquent les CDN MangaDex.
const px = (u?: string | null) =>
  u ? "/api/manga/proxy-img?src=" + encodeURIComponent(u) : "";

/* ── Bibliothèque locale ──────────────────────────────────── */
interface LibraryEntry { id: string; title: string; thumbnailUrl?: string; addedAt: number }

async function readLibrary(): Promise<LibraryEntry[]> {
  try { return JSON.parse(await rf(LIBRARY_FILE, "utf8")); } catch { return []; }
}
async function writeLibrary(l: LibraryEntry[]) {
  await mkdir("/root/work_v43/data", { recursive: true });
  await wf(LIBRARY_FILE, JSON.stringify(l, null, 2));
}

/* ── Proxy images avec cache disque + retry URL fraîche ───── */
async function fetchImage(url: string): Promise<{ buf: Buffer; type: string } | null> {
  try {
    const r = await fetch(url, { headers: { accept: "image/*" } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf, type: r.headers.get("content-type") ?? "image/jpeg" };
  } catch {
    return null;
  }
}

export const mangaApp = new Hono();

mangaApp.get("/sources", (c) => c.json([{ id: "mangadex", name: "MangaDex", lang: "fr" }]));

mangaApp.get("/library", async (c) => {
  const lib = await readLibrary();
  return c.json(lib.map((m) => ({ ...m, thumbnailUrl: px(m.thumbnailUrl) })));
});

mangaApp.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  const d = await md(
    `/manga?title=${encodeURIComponent(q)}&limit=24&availableTranslatedLanguage[]=fr&hasAvailableChapters=true&includes[]=cover_art&order[relevance]=desc`,
  );
  const out = (d.data ?? [])
    .map((m: any) => ({
      id: m.id,
      title: pick(m.attributes.title, "en", "fr", "ja") ?? "",
      thumbnailUrl: px(coverOf(m)),
      sourceName: "MangaDex",
    }))
    .filter((m: any) => m.title);
  const nq = norm(q);
  const head = await Promise.all(out.slice(0, 8).map(async (m: any) => {
    try {
      const f = await md(`/manga/${m.id}/feed?translatedLanguage[]=fr&limit=100`);
      const readable = (f.data ?? []).filter((ch: any) => !ch.attributes?.externalUrl).length;
      return { ...m, readableCount: readable };
    } catch {
      return { ...m, readableCount: 0 };
    }
  }));
  const tail = out.slice(8).map((m: any) => ({ ...m, readableCount: -1 }));
  const all = [...head, ...tail];
  all.sort((a: any, b: any) => {
    const ra = a.readableCount > 0 ? 0 : 1;
    const rb = b.readableCount > 0 ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (norm(a.title) === nq ? 0 : 1) - (norm(b.title) === nq ? 0 : 1);
  });
  return c.json(all.slice(0, 24));
});

mangaApp.get("/proxy-img", async (c) => {
  const src = c.req.query("src") ?? "";
  const ch = c.req.query("ch") ?? "";
  const idx = c.req.query("i") ?? "";
  const allowed =
    src.startsWith("https://uploads.mangadex.org/") ||
    /^https:\/\/[a-z0-9-]+\.mangadex\.network\//.test(src);
  if (!allowed) return c.body(null, 400);

  const key = createHash("sha256").update(src).digest("hex");
  const path = `${CACHE_DIR}/${key}`;

  try {
    const st = await stat(path);
    if (Date.now() - st.mtimeMs < CACHE_TTL) {
      const buf = await rf(path);
      const meta = JSON.parse(await rf(path + ".json", "utf8").catch(() => '{"type":"image/jpeg"}'));
      const h = new Headers();
      h.set("content-type", meta.type);
      h.set("cache-control", "private, max-age=86400");
      return new Response(new Uint8Array(buf), { headers: h });
    }
  } catch { /* pas en cache */ }

  let got = await fetchImage(src);

  if (!got && ch && idx !== "") {
    try {
      const fresh = await md(`/at-home/server/${ch}`);
      const f2 = fresh.chapter.data?.[Number(idx)];
      if (f2) got = await fetchImage(`${fresh.baseUrl}/data/${fresh.chapter.hash}/${f2}`);
    } catch { /* retry src original */ }
    if (!got) got = await fetchImage(src);
  }
  if (!got) return c.body(null, 502);

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await wf(path, got.buf);
    await wf(path + ".json", JSON.stringify({ type: got.type }));
  } catch { /* cache best-effort */ }

  const h = new Headers();
  h.set("content-type", got.type);
  h.set("cache-control", "private, max-age=86400");
  return new Response(new Uint8Array(got.buf), { headers: h });
});

/* ── Détail / bibliothèque / chapitres / pages ────────────── */
mangaApp.get("/:id", async (c) => {
  const id = c.req.param("id");
  const d = await md(`/manga/${id}?includes[]=cover_art`);
  const m = d.data;
  if (!m) return c.json({ error: "not found" }, 404);
  const lib = await readLibrary();
  return c.json({
    id: m.id,
    title: pick(m.attributes.title, "en", "fr", "ja"),
    description: pick(m.attributes.description, "fr", "en"),
    thumbnailUrl: px(coverOf(m)),
    inLibrary: lib.some((e) => e.id === m.id),
  });
});

mangaApp.post("/:id/refresh", (c) => c.json({ ok: true }));

mangaApp.post("/:id/library", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const lib = await readLibrary();
  const i = lib.findIndex((e) => e.id === id);
  const target = body.inLibrary !== false;
  if (target && i === -1) {
    const d = await md(`/manga/${id}?includes[]=cover_art`);
    lib.push({
      id,
      title: pick(d.data.attributes.title, "en", "fr", "ja") ?? id,
      thumbnailUrl: coverOf(d.data),
      addedAt: Date.now(),
    });
  } else if (!target && i >= 0) {
    lib.splice(i, 1);
  }
  await writeLibrary(lib);
  return c.json({ ok: true });
});

mangaApp.get("/:id/chapters", async (c) => {
  const id = c.req.param("id");
  const d = await md(
    `/manga/${id}/feed?translatedLanguage[]=fr&limit=500&includes[]=scanlation_group`,
  );
  const seen = new Set<string>();
  const out: any[] = [];
  for (const ch of d.data ?? []) {
    if (ch.attributes.externalUrl) continue;
    const num = ch.attributes.chapter ?? "0";
    if (seen.has(num)) continue;
    seen.add(num);
    const grp = ch.relationships?.find((r: any) => r.type === "scanlation_group");
    out.push({
      id: ch.id,
      name: ch.attributes.title || `Chapitre ${num}`,
      chapterNumber: parseFloat(num),
      volume: ch.attributes.volume ?? null,
      scanlator: grp?.attributes?.name,
    });
  }
  out.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  return c.json(out);
});

mangaApp.get("/chapter/:cid/pages", async (c) => {
  const cid = c.req.param("cid");
  const d = await md(`/at-home/server/${cid}`);
  const { baseUrl, chapter } = d;
  return c.json(
    (chapter.data ?? []).map(
      (f: string, i: number) => px(`${baseUrl}/data/${chapter.hash}/${f}`) + `&ch=${cid}&i=${i}`,
    ),
  );
});

mangaApp.get("/debrid-addon", async (c) => {
  try {
    const cfg = JSON.parse(await rf("/root/work_v43/data/debrid-addon.json", "utf8"));
    if (!cfg.blob) return c.json({ url: null });
    const r = await fetch(`http://127.0.0.1:4000/${cfg.blob}/manifest.json`);
    if (!r.ok) return c.json({ url: null });
    return c.json({ url: `/jackettio/${cfg.blob}`, manifest: await r.json() });
  } catch { return c.json({ url: null }); }
});

/* ── Legacy : proxy images Suwayomi (anciennes entrées) ───── */
mangaApp.get("/img/*", async (c) => {
  const path = c.req.path.replace("/api/manga/img", "");
  const target = `${SUWAYOMI}/api/v1${path}${new URL(c.req.url).search}`;
  try {
    const r = await fetch(target, { headers: { accept: "image/*" } });
    const h = new Headers();
    h.set("content-type", r.headers.get("content-type") ?? "image/jpeg");
    h.set("cache-control", "private, max-age=86400");
    return new Response(r.body, { status: r.status, headers: h });
  } catch {
    return c.body(null, 502);
  }
});
