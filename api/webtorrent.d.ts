declare module "webtorrent" {
  import type { Readable } from "node:stream";



  export interface TorrentFile {
    name: string;
    length: number;
    createReadStream(opts?: { start?: number; end?: number }): Readable;
  }
  export interface Torrent {
    name: string;
    ready: boolean;
    numPeers: number;
    downloadSpeed: number;
    uploaded: number;
    progress: number;
    files: TorrentFile[];
    destroy(): void;
    on(event: string, cb: (...args: unknown[]) => void): void;
  }
  export default class WebTorrent {
    constructor(opts?: unknown);
    add(magnet: string, opts?: unknown): Torrent;
    destroy(cb?: () => void): void;
  }
}
