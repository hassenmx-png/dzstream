# ---- Étape 1 : build ----
FROM node:20-bookworm AS build
WORKDIR /app

# Dépendances d'abord (cache Docker optimal)
COPY package.json package-lock.json ./
COPY patches ./patches
COPY vendor ./vendor
COPY scripts ./scripts

# --ignore-scripts : aucun script natif ne peut faire échouer le build
# (node-datachannel, esbuild, etc.). On restaure ensuite ce qui compte :
# les patches et le binaire natif node-datachannel (vendorisé).
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
 && npx patch-package \
 && node scripts/ensure-ndc.mjs

COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---- Étape 2 : runtime ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg + ffprobe : transcodage audio à la volée (vidéo copiée, AC3/DTS →
# AAC) — dernier recours pour qu'aucune source ne reste jamais muette.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/boot.js"]
