import { Hono } from "hono";
import { env } from "./lib/env";

/**
 * Synchro légère entre appareils, SANS compte :
 * l'utilisateur génère un code (ex. NS-XXXX-XXXX) sur un appareil et le
 * saisit sur l'autre. Le serveur stocke un blob JSON (progression + liste)
 * par code. La fusion (last-write-wins par élément) est faite côté client.
 *
 * Stockage : MySQL/TiDB via DATABASE_URL, avec création paresseuse de la
 * table (pas de migration à lancer). Si la base est injoignable (ex. dev
 * local hors réseau plateforme), repli sur une Map en mémoire pour ne
 * jamais casser l'API.
 */

interface SyncPayload {
  progress?: unknown[];
  library?: unknown[];
  ratings?: unknown[];
}

const CODE_RE = /^NS-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MAX_BODY = 256 * 1024; // 256 ko, très au-delà d'un usage réel

// ---------------------------------------------------------------- stockage

type Row = { data: string; updatedAt: number };
const memory = new Map<string, Row>();

let pool: import("mysql2/promise").Pool | null | undefined;
let poolDiag: string | null = null; // cause exacte d'une indisponibilité DB
let tableReady = false;
let dbDownUntil = 0; // anti-spam : après un échec, on retente dans 30 s

async function getPool() {
  if (pool !== undefined) return pool;
  if (!env.databaseUrl) {
    poolDiag = "DATABASE_URL absente";
    return (pool = null);
  }
  try {
    // Pilote MySQL EMBARQUÉ (vendor) : ne dépend plus des node_modules du
    // déploiement — le bundle esbuild l'inclut via ce chemin relatif.
    const mod = await import("./vendor/mysql2.cjs");
    const mysql = (mod.default ?? mod) as typeof import("mysql2/promise");
    pool = mysql.createPool({
      uri: env.databaseUrl,
      connectionLimit: 4,
      connectTimeout: 4000,
      enableKeepAlive: true,
      // TiDB/MySQL managé : TLS obligatoire
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: false },
    });
  } catch (e) {
    poolDiag = `import mysql2 : ${e instanceof Error ? e.message : String(e)}`;
    pool = null;
  }
  return pool;
}

async function ensureTable(p: import("mysql2/promise").Pool) {
  if (tableReady) return;
  await p.query(`CREATE TABLE IF NOT EXISTS sync_store (
    code VARCHAR(24) PRIMARY KEY,
    data LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  tableReady = true;
}

async function dbGet(code: string): Promise<Row | null> {
  const p = await getPool();
  if (!p || Date.now() < dbDownUntil) throw new Error("db-down");
  try {
    await ensureTable(p);
    const [rows] = await p.query("SELECT data, updated_at AS updatedAt FROM sync_store WHERE code = ?", [code]);
    const r = (rows as { data: string; updatedAt: number | string }[])[0];
    return r ? { data: r.data, updatedAt: Number(r.updatedAt) } : null;
  } catch (e) {
    dbDownUntil = Date.now() + 30_000;
    throw e;
  }
}

async function dbPut(code: string, row: Row): Promise<void> {
  const p = await getPool();
  if (!p || Date.now() < dbDownUntil) throw new Error("db-down");
  try {
    await ensureTable(p);
    await p.query(
      "INSERT INTO sync_store (code, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)",
      [code, row.data, row.updatedAt],
    );
  } catch (e) {
    dbDownUntil = Date.now() + 30_000;
    throw e;
  }
}

async function dbDel(code: string): Promise<void> {
  const p = await getPool();
  if (!p || Date.now() < dbDownUntil) throw new Error("db-down");
  try {
    await ensureTable(p);
    await p.query("DELETE FROM sync_store WHERE code = ?", [code]);
  } catch (e) {
    dbDownUntil = Date.now() + 30_000;
    throw e;
  }
}

/** Lecture tolérante : DB d'abord, mémoire en repli (jamais d'exception). */
async function storeGet(key: string): Promise<Row | null> {
  try {
    const r = await dbGet(key);
    if (r) return r;
  } catch { /* repli mémoire */ }
  return memory.get(key) ?? null;
}

/** Écriture tolérante : DB d'abord, mémoire en repli. */
async function storePut(key: string, row: Row): Promise<void> {
  try {
    await dbPut(key, row);
    memory.delete(key);
    return;
  } catch { /* repli mémoire */ }
  memory.set(key, row);
}

async function storeDel(key: string): Promise<void> {
  memory.delete(key);
  try { await dbDel(key); } catch { /* déjà parti */ }
}

// ---------------------------------------------------------------- routes

export const syncApp = new Hono();

// ------------------------------------------------- partage de liste (lecture seule)

/**
 * Partage public d'une liste : stocké sous une clé DÉRIVÉE (« share:CODE »)
 * contenant UNIQUEMENT la bibliothèque — jamais la progression (vie privée).
 */
syncApp.put("/:code/share", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!CODE_RE.test(code)) return c.json({ error: "Code invalide" }, 400);
  // Le coffre principal doit exister (sinon n'importe qui créerait des partages)
  let owner: Row | null = null;
  try { owner = await dbGet(code); } catch { owner = memory.get(code) ?? null; }
  if (!owner) return c.json({ error: "Crée d'abord la synchro sur cet appareil" }, 404);
  let body: { library?: unknown[] };
  try {
    body = (await c.req.json()) as { library?: unknown[] };
  } catch {
    return c.json({ error: "JSON invalide" }, 400);
  }
  if (!Array.isArray(body.library) || body.library.length > 500) {
    return c.json({ error: "Données invalides" }, 400);
  }
  const row: Row = { data: JSON.stringify({ library: body.library }), updatedAt: Date.now() };
  let mode: "db" | "memory" = "db";
  try {
    await dbPut(`share:${code}`, row);
  } catch {
    mode = "memory";
    memory.set(`share:${code}`, row);
  }
  return c.json({ ok: true, updatedAt: row.updatedAt, mode });
});

syncApp.get("/:code/share", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!CODE_RE.test(code)) return c.json({ error: "Code invalide" }, 400);
  let row: Row | null = null;
  try { row = await dbGet(`share:${code}`); } catch { row = memory.get(`share:${code}`) ?? null; }
  if (!row) return c.json({ error: "Liste partagée introuvable" }, 404);
  return c.json({ library: (JSON.parse(row.data) as { library: unknown[] }).library, updatedAt: row.updatedAt });
});


// ------------------------------------------------- salon « regarder ensemble »

/**
 * Salon de lecture synchronisée (watch party) SANS compte :
 * l'hôte crée un salon depuis le lecteur → code « SN-XXXX-XXXX » à partager.
 * Les invités rejoignent avec le code et suivent la lecture de l'hôte
 * (lecture/pause/position) en interrogeant l'état toutes les ~2,5 s.
 *
 * L'état est un blob JSON opaque pour le serveur, SAUF :
 * - `at` : réécrit avec l'horloge SERVEUR à chaque mise à jour (évite les
 *   décalages d'horloge entre appareils — les invités calculent la position
 *   courante avec serverNow - at) ;
 * - `guests` : carte clientId → timestamp, fusionnée (jamais écrasée) pour
 *   que les battements de cœur des invités survivent aux mises à jour hôte.
 *
 * Stockage : même table sync_store, clé « room:CODE » (éphémère, fermeture
 * explicite ou écrasement — pas de TTL nécessaire à cette échelle).
 */

const ROOM_RE = /^SN-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GUEST_TTL = 40_000; // un invité sans battement depuis 40 s est retiré

function genRoomCode(): string {
  const pick = () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `SN-${group()}-${group()}`;
}

type RoomState = {
  v?: number;
  host?: string;
  media?: unknown;
  playing?: boolean;
  position?: number;
  at?: number;
  guests?: Record<string, number>;
};

function pruneGuests(guests: Record<string, number> | undefined, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(guests ?? {})) {
    if (now - t < GUEST_TTL) out[k] = t;
  }
  return out;
}

// Création d'un salon (hôte). Body : { state } — media, playing, position…
syncApp.post("/room", async (c) => {
  let body: { state?: RoomState };
  try {
    body = (await c.req.json()) as { state?: RoomState };
  } catch {
    return c.json({ error: "JSON invalide" }, 400);
  }
  if (!body.state || typeof body.state !== "object" || !body.state.media) {
    return c.json({ error: "État de salon invalide" }, 400);
  }
  const now = Date.now();
  // Anti-collision : on retente avec un autre code si celui-ci existe déjà
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genRoomCode();
    if (await storeGet(`room:${code}`)) continue;
    const state: RoomState = { ...body.state, at: now, guests: {} };
    await storePut(`room:${code}`, { data: JSON.stringify(state), updatedAt: now });
    return c.json({ ok: true, code, serverNow: now });
  }
  return c.json({ error: "Aucun code libre, réessaie" }, 503);
});

// Lecture de l'état (invités : polling ~2,5 s ; hôte : compteur d'invités)
syncApp.get("/room/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_RE.test(code)) return c.json({ error: "Code invalide" }, 400);
  const row = await storeGet(`room:${code}`);
  if (!row) return c.json({ error: "Salon introuvable ou terminé" }, 404);
  const state = JSON.parse(row.data) as RoomState;
  const now = Date.now();
  state.guests = pruneGuests(state.guests, now);
  return c.json({ state, serverNow: now });
});

// Mise à jour. Deux formes :
// - hôte   : { state }        → remplace l'état (media/playing/position…)
// - invité : { guest: "cid" } → battement de cœur, ne touche pas à la lecture
syncApp.put("/room/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_RE.test(code)) return c.json({ error: "Code invalide" }, 400);
  const row = await storeGet(`room:${code}`);
  if (!row) return c.json({ error: "Salon introuvable ou terminé" }, 404);
  const cur = JSON.parse(row.data) as RoomState;
  let body: { state?: RoomState; guest?: string };
  try {
    body = (await c.req.json()) as { state?: RoomState; guest?: string };
  } catch {
    return c.json({ error: "JSON invalide" }, 400);
  }
  const now = Date.now();
  let next: RoomState;
  if (typeof body.guest === "string" && body.guest.length >= 6 && body.guest.length <= 64) {
    next = { ...cur, guests: { ...pruneGuests(cur.guests, now), [body.guest]: now } };
  } else if (body.state && typeof body.state === "object") {
    next = { ...body.state, at: now, guests: pruneGuests(cur.guests, now) };
  } else {
    return c.json({ error: "Requête invalide" }, 400);
  }
  await storePut(`room:${code}`, { data: JSON.stringify(next), updatedAt: now });
  return c.json({ ok: true, serverNow: now });
});

// Fermeture du salon (hôte)
syncApp.delete("/room/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_RE.test(code)) return c.json({ error: "Code invalide" }, 400);
  await storeDel(`room:${code}`);
  return c.json({ ok: true });
});

// État du service (utile au diagnostic : "db" en production attendu)
syncApp.get("/status", async (c) => {
  try {
    const p = await getPool();
    if (!p) return c.json({ mode: "memory", reason: poolDiag ?? "pool indisponible" });
    await ensureTable(p);
    return c.json({ mode: "db", url: env.databaseUrl.replace(/\/\/.*@/, "//***@") });
  } catch (e) {
    return c.json({ mode: "memory", reason: `query : ${e instanceof Error ? e.message : String(e)}` });
  }
});

syncApp.get("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!CODE_RE.test(code)) return c.json({ error: "Code invalide" }, 400);
  let row: Row | null = null;
  let mode: "db" | "memory" = "db";
  try {
    row = await dbGet(code);
  } catch {
    mode = "memory";
    row = memory.get(code) ?? null;
  }
  if (!row) return c.json({ error: "Code inconnu", mode }, 404);
  return c.json({ data: JSON.parse(row.data) as SyncPayload, updatedAt: row.updatedAt, mode });
});

syncApp.put("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!CODE_RE.test(code)) return c.json({ error: "Code invalide" }, 400);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: "Données trop volumineuses" }, 413);
  let payload: SyncPayload;
  try {
    payload = JSON.parse(raw) as SyncPayload;
  } catch {
    return c.json({ error: "JSON invalide" }, 400);
  }
  const clean: SyncPayload = {
    progress: Array.isArray(payload.progress) ? payload.progress.slice(0, 200) : [],
    library: Array.isArray(payload.library) ? payload.library.slice(0, 500) : [],
    ratings: Array.isArray(payload.ratings) ? payload.ratings.slice(0, 500) : [],
  };
  const row: Row = { data: JSON.stringify(clean), updatedAt: Date.now() };
  let mode: "db" | "memory" = "db";
  try {
    await dbPut(code, row);
  } catch {
    mode = "memory";
    memory.set(code, row);
  }
  return c.json({ ok: true, updatedAt: row.updatedAt, mode });
});
