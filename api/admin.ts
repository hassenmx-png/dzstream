import { Hono } from "hono";
import { execSync } from "node:child_process";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";

/**
 * Tableau de bord admin : état système, activité streaming (anneau mémoire
 * alimenté par /api/stream/play), compte Torbox, abonnés push.
 * Rien n'est persisté — tout vit en mémoire et repart à zéro au reboot.
 */
export const adminApp = new Hono();

// ── anneau d'activité (appelé par stream.ts) ──
export interface PlayEvt { at: number; host: string }
const plays: PlayEvt[] = [];
export function trackPlay(host: string): void {
  plays.push({ at: Date.now(), host });
  if (plays.length > 40) plays.shift();
}

const bootAt = Date.now();

function disk(): { usedPct: number; freeGo: number } | null {
  try {
    const out = execSync("df -BG --output=pcent,avail / | tail -1").toString().trim();
    const m = out.match(/(\d+)%\s+(\d+)G/);
    return m ? { usedPct: Number(m[1]), freeGo: Number(m[2]) } : null;
  } catch { return null; }
}

adminApp.get("/stats", async (c) => {
  const now = Date.now();
  const last24h = plays.filter((p) => now - p.at < 24 * 3600 * 1000).length;
  const actifs = plays.filter((p) => now - p.at < 3 * 60 * 1000).length;
  const mem = process.memoryUsage();
  let pushSubs = 0;
  try {
    const f = process.env.PUSH_SUBS_FILE ?? "/root/push-subs.json";
    if (existsSync(f)) pushSubs = (JSON.parse(readFileSync(f, "utf-8")) as unknown[]).length;
  } catch { /* ignore */ }

  // Torbox : état du compte (premium, expiration)
  let torbox: Record<string, unknown> | null = null;
  const key = (process.env.TORBOX_API_KEY || "").trim();
  if (key) {
    try {
      const r = await fetch("https://api.torbox.app/v1/api/user/me", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });
      const j = (await r.json()) as { data?: { is_subscribed?: boolean; premium_expires_at?: string; total_downloaded?: number; email?: string } };
      if (j.data) {
        const exp = j.data.premium_expires_at ? new Date(j.data.premium_expires_at).getTime() : 0;
        torbox = {
          premium: !!j.data.is_subscribed,
          expireLe: j.data.premium_expires_at ?? null,
          joursRestants: exp ? Math.max(0, Math.round((exp - now) / 86400000)) : null,
          telechargeGo: j.data.total_downloaded ? Math.round(j.data.total_downloaded / 1073741824) : null,
        };
      }
    } catch { /* réseau → on laisse null */ }
  }

  return c.json({
    systeme: {
      uptimeAppMin: Math.round((now - bootAt) / 60000),
      uptimeHoteJours: Math.round(os.uptime() / 86400),
      load: os.loadavg().map((x) => +x.toFixed(2)),
      ramUtiliseeMo: Math.round((os.totalmem() - os.freemem()) / 1048576),
      ramTotaleMo: Math.round(os.totalmem() / 1048576),
      nodeMo: Math.round(mem.rss / 1048576),
      disque: disk(),
    },
    activite: {
      lectures24h: last24h,
      fluxProbablesActifs: actifs,
      dernieres: plays.slice(-12).reverse(),
    },
    pushAbonnes: pushSubs,
    torbox,
  });
});
