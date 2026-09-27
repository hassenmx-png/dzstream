/**
 * Stub de @thaunknown/simple-peer pour le bundling serveur.
 *
 * WebRTC ne sert pas côté serveur (le P2P y est TCP/UDP). WEBRTC_SUPPORT=false
 * indique à webtorrent de ne pas tenter de connexions WebRTC. Si un tracker
 * wss:// essaie quand même, l'erreur asynchrone est absorbée par les handlers
 * d'erreur de webtorrent — les trackers TCP/UDP continuent de fonctionner.
 */
import { Duplex } from "streamx";

class Peer extends Duplex {
  static WEBRTC_SUPPORT = false;

  constructor(opts = {}) {
    super();
    queueMicrotask(() => {
      try {
        this.destroy(new Error("WebRTC désactivé côté serveur (stub)"));
      } catch {
        /* ignore */
      }
    });
  }
}

export default Peer;
