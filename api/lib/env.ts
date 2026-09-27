import "dotenv/config";

/**
 * Variables d'environnement OPTIONNELLES au démarrage.
 *
 * Règle d'or : le serveur doit TOUJOURS démarrer et servir le front, même
 * sans configuration. Les fonctionnalités qui dépendent d'une variable
 * manquante (sync multi-appareils pour DATABASE_URL…) se désactivent
 * gracieusement à l'appel. Un throw ici faisait crasher le conteneur de
 * production au démarrage (le Dockerfile ne copie pas .env dans l'image
 * finale) → échec de publication côté plateforme.
 */
function optional(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    console.warn(`[env] Variable manquante : ${name} — fonctionnalités associées désactivées.`);
  }
  return value ?? "";
}

export const env = {
  appId: optional("APP_ID"),
  appSecret: optional("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: optional("DATABASE_URL"),
};
