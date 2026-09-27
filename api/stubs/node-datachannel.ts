/**
 * Stub de node-datachannel pour le bundling serveur.
 *
 * Le P2P serveur de NovaStream n'utilise que TCP/UDP — WebRTC (via le module
 * natif node-datachannel) n'est pas nécessaire. Ce stub évite d'embarquer le
 * binaire natif dans le bundle ; si webtorrent tente quand même une connexion
 * WebRTC (trackers wss://), l'erreur est interceptée par ses propres handlers
 * et les trackers TCP/UDP continuent de fonctionner.
 */

export class PeerConnection {
  constructor() {
    throw new Error("WebRTC désactivé côté serveur (stub node-datachannel)");
  }
}

export class RtcpReceivingSession {}
export class Video {}
export class Audio {}
export class DataChannel {}
export class Track {}
export function cleanup() {}
export function initLogger() {}
export default {
  PeerConnection,
  RtcpReceivingSession,
  Video,
  Audio,
  DataChannel,
  Track,
  cleanup,
  initLogger,
};
