import { describe, it, expect } from "vitest";
import app from "./boot";

// Test de fumée : l'API doit répondre sur la sonde de santé, même sans
// aucune variable d'environnement (c'est la condition du conteneur de
// production — le Dockerfile ne copie pas .env).
describe("api de santé", () => {
  it("GET /api/health répond 200", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
