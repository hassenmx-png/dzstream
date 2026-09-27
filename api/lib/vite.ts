import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  // Assets hashés par Vite : compression gzip (le JS principal passe de
  // ~700 Ko à ~200 Ko sur le réseau) + cache HTTP immutable 1 an. Jamais
  // appliqué aux flux vidéo/API (le middleware ne touche que /assets).
  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("/assets/*", compress());

  // sw.js, index.html et manifest : JAMAIS caches. Un navigateur qui garde
  // une vieille copie de l'un de ces trois fichiers fige l'app sur une
  // ancienne version (ecrans noirs, vieilles URL mortes). no-cache = revalider
  // a chaque chargement ; le ETag fait que la revalidation coute 0 octet
  // quand rien n'a change.
  app.use("/sw.js", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  });
  app.use("/index.html", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  });
  app.get("/", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  });

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
