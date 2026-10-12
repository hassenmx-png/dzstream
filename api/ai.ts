// IA maison via OpenRouter — modèles GRATUITS avec chaîne de repli.
// La clé vit dans .env (OPENROUTER_API_KEY) : jamais dans le front.
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { mkdir, readFile as rf, writeFile as wf } from "node:fs/promises";

const KEY = () => (process.env.OPENROUTER_API_KEY || "").trim();
const MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];
const CACHE_FILE = "/root/work_v43/data/ai-cache.json";

async function ask(
  messages: { role: string; content: string }[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string | null> {
  if (!KEY()) return null;
  for (const model of MODELS) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY()}`, "content-type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) continue; // 429 saturé → modèle suivant
      const d: any = await r.json();
      const txt: unknown = d?.choices?.[0]?.message?.content;
      if (typeof txt === "string" && txt.trim()) return txt.trim();
    } catch { /* modèle suivant */ }
  }
  return null;
}

/* ── Traduction EN → FR avec cache disque (les synopsis MangaDex
 *  sont souvent anglais) ───────────────────────────────────── */
const tCache = new Map<string, string>();
let tLoaded = false;
async function loadCache(): Promise<void> {
  if (tLoaded) return;
  tLoaded = true;
  try {
    const d = JSON.parse(await rf(CACHE_FILE, "utf8"));
    for (const [k, v] of Object.entries(d)) tCache.set(k, String(v));
  } catch { /* cache vide */ }
}
async function saveCache(): Promise<void> {
  try {
    await mkdir("/root/work_v43/data", { recursive: true });
    await wf(CACHE_FILE, JSON.stringify(Object.fromEntries(tCache)));
  } catch { /* best-effort */ }
}

function looksFrench(t: string): boolean {
  const fr = (t.match(/\b(le|la|les|des|une|dans|avec|est|sur|pour|qui|que|pas|son|sa|ses)\b/gi) ?? []).length;
  const en = (t.match(/\b(the|and|is|of|with|his|her|when|but|who|that|from)\b/gi) ?? []).length;
  return fr >= en;
}

/** Renvoie le texte en français (traduit si besoin, sinon tel quel).
 *  En cas d'indisponibilité de l'IA : renvoie le texte d'origine. */
export async function translateFr(text?: string | null): Promise<string | undefined | null> {
  if (!text) return text;
  if (looksFrench(text)) return text;
  await loadCache();
  const key = createHash("sha256").update(text).digest("hex");
  const hit = tCache.get(key);
  if (hit) return hit;
  const out = await ask(
    [
      { role: "system", content: "Tu traduis en français le texte donné, fidèlement et naturellement. Tu ne réponds QUE par la traduction, sans commentaire." },
      { role: "user", content: text.slice(0, 4000) },
    ],
    900,
    20_000,
  );
  if (!out) return text;
  tCache.set(key, out);
  void saveCache();
  return out;
}

export const aiApp = new Hono();

aiApp.post("/chat", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const msgs: { role: string; content: string }[] = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
  if (!msgs.length) return c.json({ error: "message vide" }, 400);
  const reply = await ask(
    [
      {
        role: "system",
        content:
          "Tu es l'assistant de DZ STREAM, une appli de streaming (films, séries, animés, mangas). " +
          "Tu réponds TOUJOURS en français, de façon concise et chaleureuse. " +
          "Quand on te demande quoi regarder ou lire, tu proposes 3 à 5 titres précis avec une phrase d'accroche chacun. " +
          "Tu peux répondre aux questions sur un titre (intrigue, casting, ordre de visionnage). " +
          "Pas de disclaimers, pas de blabla.",
      },
      ...msgs.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 2000),
      })),
    ],
    700,
    45_000,
  );
  if (!reply) return c.json({ error: "IA indisponible" }, 502);
  return c.json({ reply });
});

aiApp.post("/translate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text = String(body?.text ?? "").slice(0, 4000).trim();
  if (!text) return c.json({ error: "texte vide" }, 400);
  const out = await translateFr(text);
  return c.json({ text: out });
});
