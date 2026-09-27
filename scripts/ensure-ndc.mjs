// Restaure le binaire natif node-datachannel depuis vendor/ si l'install
// (prebuild-install) ne l'a pas fourni — ex. build avec --ignore-scripts.
// Si la restauration est impossible, on ne fait pas échouer le build :
// le serveur démarre quand même et le streaming P2P bascule en mode navigateur.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

const target = "node_modules/node-datachannel/build/Release/node_datachannel.node";
const vendored = "vendor/node-datachannel/node_datachannel.node";

if (!existsSync("node_modules/node-datachannel")) {
  console.log("[ensure-ndc] node-datachannel absent — ignoré (fallback navigateur).");
  process.exit(0);
}

if (existsSync(target)) {
  console.log("[ensure-ndc] binaire natif déjà présent.");
  process.exit(0);
}

if (existsSync(vendored)) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(vendored, target);
  console.log("[ensure-ndc] binaire natif restauré depuis vendor/.");
} else {
  console.log("[ensure-ndc] aucun binaire disponible — ignoré (fallback navigateur).");
}
