import { Hono } from "hono";

/**
 * Catalogue boosté via TMDB (The Movie Database) — proxy serveur :
 * - bandes-annonces (FR en priorité),
 * - casting avec photos (cliquable),
 * - recommandations / similaires,
 * - recherche de personnes + filmographie.
 *
 * Tout est converti en IDs IMDB côté serveur (le coeur de NovaStream,
 * addons Stremio compris, parle IMDB) et mis en cache mémoire (TTL).
 * Clé : TMDB_API_KEY en env si fournie, sinon clés publiques de secours
 * (rotation automatique en cas de 401/429).
 */

const HOSTS = ["https://api.themoviedb.org/3", "https://api.tmdb.org/3"];
let preferredHost = 0; // mémorise l'hôte qui répond pour éviter les timeouts en chaîne
const IMG = "https://image.tmdb.org/t/p";

// Clé LUE UNIQUEMENT depuis le .env serveur (jamais dans le bundle,
// jamais en dur ici). Sans TMDB_API_KEY, le catalogue est dégradé mais
// le serveur démarre et sert le front normalement.
const keys = process.env.TMDB_API_KEY ? [process.env.TMDB_API_KEY] : [];
const keyDeadUntil = new Map<string, number>();
// Un hôte TMDB injoignable (DNS menteur, réseau qui bloque un des deux
// domaines officiels) est marqué mort 10 min : sinon CHAQUE requête payait
// le timeout complet avant de tomber sur l'hôte sain — les pages personne
// (~70 appels) dépassaient alors les 10 s côté client.
const hostDeadUntil = new Map<string, number>();

// ------------------------------------------------------------------ helpers

interface CacheEntry<T> { v: T; exp: number }
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string): T | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) {
    cache.delete(key);
    return undefined;
  }
  return e.v as T;
}
function setCache(key: string, v: unknown, ttlMs: number) {
  if (cache.size > 2000) cache.clear(); // garde-fou mémoire
  cache.set(key, { v, exp: Date.now() + ttlMs });
}

const DAY = 24 * 3600 * 1000;

/**
 * GET JSON via node:https avec family:4. Le fetch global (undici) peut
 * rester bloqué sur des routes IPv6 mortes dans certains réseaux
 * (ETIMEDOUT alors que l'IPv4 répond) — https + family:4 est fiable
 * partout, sandbox de test compris.
 */
import { get as httpsGet, Agent as HttpsAgent } from "node:https";

// Keep-alive : sans agent persistant, CHAQUE appel TMDB refait poignée TLS +
// handshake (~1 s pièce). Les pages personne enchaînent ~70 résolutions IMDB
// → c'était le goulot qui faisait dépasser les 10 s côté client.
const tmdbAgent = new HttpsAgent({ keepAlive: true, maxSockets: 32, timeout: 60_000 });

function httpsJSON<T>(url: string, timeoutMs = 4000): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { family: 4, timeout: timeoutMs, agent: tmdbAgent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as T });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const alive = keys.filter((k) => (keyDeadUntil.get(k) ?? 0) < Date.now());
  if (alive.length === 0) return null;
  let hosts = [HOSTS[preferredHost], ...HOSTS.filter((_, i) => i !== preferredHost)]
    .filter((h) => (hostDeadUntil.get(h) ?? 0) < Date.now());
  if (hosts.length === 0) hosts = [HOSTS[preferredHost]]; // tous marqués morts → on retente le préféré
  for (const host of hosts) {
    for (const key of alive) {
      try {
        const qs = new URLSearchParams({ api_key: key, language: "fr-FR", ...params });
        const { status, body } = await httpsJSON<T>(`${host}${path}?${qs}`);
        if (status === 401 || status === 429) {
          keyDeadUntil.set(key, Date.now() + 3600_000);
          continue;
        }
        if (status === 404) return null;
        if (status < 200 || status >= 300) break; // erreur serveur → hôte suivant
        preferredHost = HOSTS.indexOf(host);
        hostDeadUntil.delete(host);
        return body;
      } catch {
        hostDeadUntil.set(host, Date.now() + 10 * 60_000); // hôte injoignable → mort 10 min
        break;
      }
    }
  }
  return null;
}

/** Limiteur de concurrence minimaliste — préserve l'ordre d'entrée. */
async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx]);
        } catch { /* élément ignoré */ }
      }
    }),
  );
  return out.filter((r): r is R => r !== null);
}

// ------------------------------------------------------------------ mapping

interface TmdbListItem {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
}

export interface MappedPreview {
  id: string; // IMDB tt…
  type: "movie" | "series";
  name: string;
  poster?: string;
  background?: string;
  releaseInfo?: string;
  imdbRating?: string;
  role?: string; // personnage joué (cast) ou fonction (crew) — page personne
  popularity?: number;
}

async function toImdbId(type: "movie" | "series", tmdbId: number): Promise<string | null> {
  const ck = `xid:${type}:${tmdbId}`;
  const hit = cached<string | null>(ck);
  if (hit !== undefined) return hit;
  const ext = await tmdb<{ imdb_id?: string | null }>(`/${type === "movie" ? "movie" : "tv"}/${tmdbId}/external_ids`);
  const imdb = ext?.imdb_id && /^tt\d+/.test(ext.imdb_id) ? ext.imdb_id : null;
  setCache(ck, imdb, 7 * DAY);
  return imdb;
}

async function mapList(type: "movie" | "series", items: TmdbListItem[], cap: number): Promise<MappedPreview[]> {
  // Marge raisonnable pour les sans-IMDB (cap + 8, pas cap × 2 : chaque
  // élément coûte un appel external_ids) et concurrence élevée — sinon la
  // filmographie d'un acteur prolifique dépassait les 10 s côté client.
  const picked = items.filter((x) => x.poster_path).slice(0, cap + 8);
  const mapped = await pool(picked, 20, async (x) => {
    const imdb = await toImdbId(type, x.id);
    if (!imdb) return null;
    const date = x.release_date ?? x.first_air_date ?? "";
    const credit = x as TmdbListItem & { character?: string; job?: string };
    return {
      id: imdb,
      type,
      name: x.title ?? x.name ?? "",
      poster: x.poster_path ? `${IMG}/w500${x.poster_path}` : undefined,
      background: x.backdrop_path ? `${IMG}/w1280${x.backdrop_path}` : undefined,
      releaseInfo: date.slice(0, 4) || undefined,
      imdbRating: x.vote_average ? x.vote_average.toFixed(1) : undefined,
      role: credit.character || credit.job || undefined,
      popularity: x.popularity,
    } satisfies MappedPreview;
  });
  const seen = new Set<string>();
  return mapped
    .filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .slice(0, cap);
}

async function resolveImdb(imdbId: string): Promise<{ tmdbId: number; type: "movie" | "series" } | null> {
  const ck = `find:${imdbId}`;
  const hit = cached<{ tmdbId: number; type: "movie" | "series" } | null>(ck);
  if (hit !== undefined) return hit;
  const data = await tmdb<{
    movie_results?: { id: number }[];
    tv_results?: { id: number }[];
  }>(`/find/${imdbId}`, { external_source: "imdb_id" });
  const found = data?.movie_results?.[0]
    ? { tmdbId: data.movie_results[0].id, type: "movie" as const }
    : data?.tv_results?.[0]
      ? { tmdbId: data.tv_results[0].id, type: "series" as const }
      : null;
  setCache(ck, found, 7 * DAY);
  return found;
}

// ------------------------------------------------------------------ routes

export const tmdbApp = new Hono();

interface TmdbVideo { key: string; site: string; type: string; iso_639_1?: string; official?: boolean }
interface TmdbCast { id: number; name: string; character?: string; profile_path?: string | null; order?: number }
interface TmdbCrew { id: number; name: string; job?: string; profile_path?: string | null }

/** Bundle page détail : bande-annonce FR + casting photos + réalisateurs. */
tmdbApp.get("/discover/:type/:genreId", async (c) => {
  const type = c.req.param("type") === "tv" ? "tv" : "movie";
  const genreId = c.req.param("genreId") ?? "";
  if (!/^\d+$/.test(genreId)) return c.json({ error: "genre invalide" }, 400);
  const ck = `discover:${type}:${genreId}`;
  const hit = cached<object>(ck);
  if (hit) return c.json(hit);
  const j = await tmdb<{ results?: { id: number; title?: string; name?: string }[] }>(`/discover/${type}`, {
    with_genres: genreId,
    sort_by: "popularity.desc",
    "vote_count.gte": "100",
    page: "1",
  });
  if (!j?.results) return c.json({ items: [] }, 502);
  const items = (await Promise.all(j.results.slice(0, 18).map(async (r): Promise<object | null> => {
    try {
      const ext = await tmdb<{ imdb_id?: string }>(`/${type}/${r.id}/external_ids`);
      if (!ext?.imdb_id) return null;
      return { id: ext.imdb_id, type: type === "tv" ? "series" : "movie", name: r.title ?? r.name ?? "", poster: `https://images.metahub.space/poster/medium/${ext.imdb_id}/img` };
    } catch { return null; }
  }))).filter(Boolean);
  const out = { items };
  cache.set(ck, { v: out, exp: Date.now() + 86400000 });
  return c.json(out);
});

tmdbApp.get("/extras/:imdbId", async (c) => {
  const imdbId = c.req.param("imdbId");
  if (!/^tt\d+$/.test(imdbId)) return c.json({ error: "id invalide" }, 400);
  const ck = `extras:${imdbId}`;
  const hit = cached<object>(ck);
  if (hit) return c.json(hit);

  const found = await resolveImdb(imdbId);
  if (!found) return c.json({ found: false }, 404);
  const kind = found.type === "movie" ? "movie" : "tv";
  const data = await tmdb<{
    videos?: { results?: TmdbVideo[] };
    credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
    belongs_to_collection?: { id: number; name: string } | null;
  }>(`/${kind}/${found.tmdbId}`, {
    append_to_response: "videos,credits",
    include_video_language: "fr,en,null",
  });
  if (!data) return c.json({ error: "tmdb indisponible" }, 502);

  // Bande-annonce : YouTube, type Trailer, FR d'abord puis EN puis le reste
  const vids = (data.videos?.results ?? []).filter((v) => v.site === "YouTube");
  const score = (v: TmdbVideo) =>
    (v.type === "Trailer" ? 100 : v.type === "Teaser" ? 60 : 0) +
    (v.iso_639_1 === "fr" ? 40 : v.iso_639_1 === "en" ? 20 : 0) +
    (v.official ? 10 : 0);
  const trailer = vids.sort((a, b) => score(b) - score(a))[0];

  const cast = (data.credits?.cast ?? [])
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 14)
    .map((p) => ({
      id: p.id,
      name: p.name,
      character: p.character,
      photo: p.profile_path ? `${IMG}/w185${p.profile_path}` : null,
    }));
  const crew = data.credits?.crew ?? [];
  // Réalisateurs uniquement si trouvés ; producteurs/créateurs en repli
  // (séries sans « Director » explicite, ex. créateurs de show).
  const dirOnly = crew.filter((p) => p.job === "Director" || p.job === "Series Director");
  const extraCrew = crew.filter((p) => p.job === "Creator" || p.job === "Executive Producer");
  const directors = (dirOnly.length > 0 ? dirOnly : extraCrew)
    .slice(0, 4)
    .map((p) => ({ id: p.id, name: p.name }));

  // Saga / collection (films) : les autres volets, convertis en IMDB,
  // triés par date de sortie → « Matrix, Matrix Reloaded, Matrix Revolutions… »
  let collection: { name: string; parts: MappedPreview[] } | null = null;
  if (found.type === "movie" && data.belongs_to_collection) {
    const coll = await tmdb<{ name: string; parts?: TmdbListItem[] }>(
      `/collection/${data.belongs_to_collection.id}`,
    );
    if (coll?.parts?.length) {
      const sorted = [...coll.parts].sort((a, b) =>
        (a.release_date ?? "").localeCompare(b.release_date ?? ""),
      );
      const parts = (await mapList("movie", sorted, 12)).filter((x) => x.id !== imdbId);
      if (parts.length > 0) collection = { name: coll.name.replace(/\s*[-–—]\s*(Collection|Saga)$/i, ""), parts };
    }
  }

  const payload = { found: true, tmdbId: found.tmdbId, type: found.type, trailerYtId: trailer?.key ?? null, cast, directors, collection };
  setCache(ck, payload, DAY);
  return c.json(payload);
});

/** Recommandations + similaires, convertis en IDs IMDB. */
tmdbApp.get("/recs/:imdbId", async (c) => {
  const imdbId = c.req.param("imdbId");
  if (!/^tt\d+$/.test(imdbId)) return c.json({ error: "id invalide" }, 400);
  const ck = `recs:${imdbId}`;
  const hit = cached<object>(ck);
  if (hit) return c.json(hit);

  const found = await resolveImdb(imdbId);
  if (!found) return c.json({ found: false, items: [] }, 404);
  const kind = found.type === "movie" ? "movie" : "tv";
  const [recs, sim] = await Promise.all([
    tmdb<{ results?: TmdbListItem[] }>(`/${kind}/${found.tmdbId}/recommendations`),
    tmdb<{ results?: TmdbListItem[] }>(`/${kind}/${found.tmdbId}/similar`),
  ]);
  const combined = [...(recs?.results ?? []), ...(sim?.results ?? [])];
  const items = await mapList(found.type, combined, 20);
  const payload = { found: true, type: found.type, items: items.filter((x) => x.id !== imdbId) };
  setCache(ck, payload, DAY);
  return c.json(payload);
});

/** Recherche de personnes (acteurs, réalisateurs…). */
tmdbApp.get("/people", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ items: [] });
  const ck = `ppl:${q.toLowerCase()}`;
  const hit = cached<object>(ck);
  if (hit) return c.json(hit);
  const data = await tmdb<{
    results?: {
      id: number; name: string; profile_path?: string | null;
      known_for_department?: string;
      known_for?: { title?: string; name?: string; media_type?: string }[];
    }[];
  }>("/search/person", { query: q, include_adult: "false" });
  const items = (data?.results ?? []).slice(0, 8).map((p) => ({
    id: p.id,
    name: p.name,
    photo: p.profile_path ? `${IMG}/w185${p.profile_path}` : null,
    department: p.known_for_department ?? "",
    knownFor: (p.known_for ?? []).map((k) => k.title ?? k.name ?? "").filter(Boolean).slice(0, 3),
  }));
  const payload = { items };
  setCache(ck, payload, 6 * 3600 * 1000);
  return c.json(payload);
});

/** Page personne : bio + filmographie convertie en IMDB. */
tmdbApp.get("/person/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "id invalide" }, 400);
  const ck = `person2:${id}`;
  const hit = cached<object>(ck);
  if (hit) return c.json(hit);

  const data = await tmdb<{
    name: string;
    biography?: string;
    birthday?: string | null;
    deathday?: string | null;
    place_of_birth?: string | null;
    profile_path?: string | null;
    known_for_department?: string;
    gender?: number;
    popularity?: number;
    homepage?: string | null;
    also_known_as?: string[];
    external_ids?: {
      imdb_id?: string | null; instagram_id?: string | null;
      twitter_id?: string | null; facebook_id?: string | null; tiktok_id?: string | null;
    };
    images?: { profiles?: { file_path: string }[] };
    combined_credits?: {
      cast?: (TmdbListItem & { media_type?: string; character?: string })[];
      crew?: (TmdbListItem & { media_type?: string; job?: string })[];
    };
  }>(`/person/${id}`, { append_to_response: "combined_credits,external_ids,images" });
  if (!data?.name) return c.json({ error: "personne introuvable" }, 404);

  const dept = data.known_for_department ?? "Acting";
  const cc = data.combined_credits;
  // Un réalisateur voit ses films en tant que « crew », un acteur en « cast »
  const credits = dept === "Directing" || dept === "Writing" || dept === "Production"
    ? (cc?.crew ?? []).filter((x) => ["Director", "Writer", "Screenplay", "Creator", "Executive Producer"].includes(x.job ?? ""))
    : (cc?.cast ?? []);

  const movies = credits.filter((x) => x.media_type === "movie");
  const series = credits.filter((x) => x.media_type === "tv");
  const byPop = (a: TmdbListItem, b: TmdbListItem) => (b.popularity ?? 0) - (a.popularity ?? 0);
  const [filmography, tv] = await Promise.all([
    mapList("movie", movies.sort(byPop), 30),
    mapList("series", series.sort(byPop), 30),
  ]);

  const ext = data.external_ids ?? {};
  const payload = {
    id: Number(id),
    name: data.name,
    department: dept,
    gender: data.gender ?? 0,
    bio: data.biography || null,
    birthday: data.birthday || null,
    deathday: data.deathday || null,
    placeOfBirth: data.place_of_birth || null,
    photo: data.profile_path ? `${IMG}/w342${data.profile_path}` : null,
    popularity: data.popularity ?? 0,
    homepage: data.homepage || null,
    alsoKnownAs: (data.also_known_as ?? []).slice(0, 4),
    socials: {
      imdb: ext.imdb_id || null,
      instagram: ext.instagram_id || null,
      twitter: ext.twitter_id || null,
      facebook: ext.facebook_id || null,
      tiktok: ext.tiktok_id || null,
    },
    photos: (data.images?.profiles ?? []).slice(0, 9).map((p) => `${IMG}/w185${p.file_path}`),
    // Totaux réels (filmography/series sont plafonnés à 30 pour l'affichage)
    counts: { movies: movies.length, series: series.length },
    filmography,
    series: tv,
  };
  setCache(ck, payload, DAY);
  return c.json(payload);
});
