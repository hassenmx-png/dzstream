/** Déclarations minimales pour WebTorrent (pas de types officiels à jour). */
declare module 'webtorrent/dist/webtorrent.min.js' {
  import WebTorrent from 'webtorrent'
  export default WebTorrent
}

declare module 'webtorrent' {
  export interface TorrentFile {
    name: string
    length: number
    renderTo(el: HTMLVideoElement, opts?: { autoplay?: boolean }): void
  }
  export interface Torrent {
    name: string
    numPeers: number
    downloadSpeed: number
    progress: number
    files: TorrentFile[]
    on(event: 'ready' | 'done', cb: () => void): void
    on(event: 'error', cb: (err: unknown) => void): void
  }
  export default class WebTorrent {
    constructor(opts?: Record<string, unknown>)
    add(magnet: string): Torrent
    destroy(cb?: () => void): void
  }
}
