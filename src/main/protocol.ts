// メディア配信用カスタムプロトコル maqiri-media://
//   maqiri-media://asset/<assetId>  … 選択済み素材の実体(main が解決)
//   maqiri-media://cache/<cacheId>  … main が登録した一時プレビュー
// Range 要求は上限付きで処理。パス文字列は URL から受け取らず、登録済み ID だけを解決する。
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { getAsset } from './assets';

export const MEDIA_SCHEME = 'maqiri-media';
const MAX_CHUNK = 8 * 1024 * 1024;
const cacheFiles = new Map<string, string>();

export function registerMediaSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false, corsEnabled: false } }]);
}

export function registerCacheMedia(cacheId: string, file: string): string {
  cacheFiles.set(cacheId, file);
  return `${MEDIA_SCHEME}://cache/${cacheId}`;
}

export function unregisterCacheMedia(cacheId: string): void {
  cacheFiles.delete(cacheId);
}

export function assetMediaUrl(assetId: string): string {
  return `${MEDIA_SCHEME}://asset/${assetId}`;
}

function resolveFile(url: URL): string | null {
  const host = url.host;
  const id = url.pathname.replace(/^\/+/, '');
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  if (url.search || url.pathname.includes('..') || url.pathname.includes('%')) return null;
  if (host === 'asset') {
    try {
      return getAsset(id).realPath;
    } catch {
      return null;
    }
  }
  if (host === 'cache') return cacheFiles.get(id) ?? null;
  return null;
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, s, e] = m;
  if (s === '' && e === '') return 'invalid';
  let start: number;
  let end: number;
  if (s === '') {
    const suffix = Number(e);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === '' ? size - 1 : Number(e);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return 'invalid';
  end = Math.min(end, size - 1, start + MAX_CHUNK - 1);
  return { start, end };
}

export function installMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    const file = resolveFile(url);
    if (!file) return new Response('not found', { status: 404 });
    let size: number;
    try {
      const st = await stat(file);
      if (!st.isFile()) return new Response('not found', { status: 404 });
      size = st.size;
    } catch {
      return new Response('not found', { status: 404 });
    }
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'invalid') {
      return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const headers: Record<string, string> = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    };
    if (request.method === 'HEAD') {
      headers['Content-Length'] = String(size);
      return new Response(null, { status: 200, headers });
    }
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
      const stream = createReadStream(file, { start: range.start, end: range.end });
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
    }
    // Range なし: 先頭から上限チャンクまでを 206 で返し、巨大ファイルの全読込を避ける
    const end = Math.min(size - 1, MAX_CHUNK - 1);
    headers['Content-Range'] = `bytes 0-${end}/${size}`;
    headers['Content-Length'] = String(end + 1);
    const stream = createReadStream(file, { start: 0, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  });
}

export { parseRange as _parseRangeForTests, resolveFile as _resolveFileForTests };
