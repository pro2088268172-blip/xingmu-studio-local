import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLocalApi } from './local-api.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.JZZM_LOCAL_PORT || 4173);
const apiPrefixes = ['/gw/', '/nestjs/', '/py/'];
const assetPrefix = '/ai_comic/production/';
const staticPrefixes = [assetPrefix, '/resourceBucket/', '/ai_comic/test/', '/fe-infra/', '/plaza-assets/', '/local-upload/'];
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
};

async function serveLocal(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return true;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) {
    res.writeHead(400);
    res.end();
    return true;
  }
  const absolute = resolve(root, '.' + decoded);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    res.writeHead(403);
    res.end();
    return true;
  }
  if (!existsSync(absolute)) return false;
  const info = await stat(absolute);
  if (!info.isFile()) return false;
  const headers = {
    'content-type': mimeTypes[extname(absolute).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': decoded.startsWith(assetPrefix) ? 'public, max-age=3600' : 'no-store',
  };
  if (extname(absolute).toLowerCase() === '.html') {
    headers['content-security-policy'] = `default-src 'self' data: blob:; connect-src 'self' ws://${host}:${port}; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self' blob:`;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else createReadStream(absolute).pipe(res);
  return true;
}

async function receiveUpload(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 25 * 1024 * 1024) { res.writeHead(413); res.end(); return; }
    chunks.push(chunk);
  }
  const form = await new Request('http://127.0.0.1/local-upload', {
    method: 'POST', headers: { 'content-type': req.headers['content-type'] || '' },
    body: Buffer.concat(chunks),
  }).formData();
  const key = String(form.get('key') || '');
  const file = form.get('file');
  if (!/^local-upload\/[A-Za-z0-9_./-]+$/.test(key) || key.includes('..') || typeof file?.arrayBuffer !== 'function') {
    res.writeHead(400); res.end(); return;
  }
  const absolute = resolve(root, key);
  if (!absolute.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, Buffer.from(await file.arrayBuffer()));
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ key }));
}

const server = createServer(async (req, res) => {
  try {
    const routeUrl = new URL(req.url, `http://${host}:${port}`);
    const pathname = routeUrl.pathname;
    if (pathname === '/__local/status') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ frontend: '原站前端本地资源', backend: '本机 API', origin: 'local' }));
      return;
    }
    if (pathname === '/local-upload') { await receiveUpload(req, res); return; }
    if (apiPrefixes.some(prefix => pathname.startsWith(prefix))) {
      await handleLocalApi(req, res, pathname);
      return;
    }
    if (staticPrefixes.some(prefix => pathname.startsWith(prefix))) {
      if (!(await serveLocal(req, res, pathname))) {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    if (pathname === '/favicon.ico') {
      await serveLocal(req, res, '/ai_comic/production/favicon.ico');
      return;
    }
    if (pathname === '/logo.png' || pathname === '/titleIcon.svg' || pathname === '/Sparkles.svg' || pathname === '/score.svg' || pathname === '/canvas-bg.webp') {
      await serveLocal(req, res, pathname);
      return;
    }
    if (mimeTypes[extname(pathname).toLowerCase()]) {
      res.writeHead(404);
      res.end();
      return;
    }
    await serveLocal(req, res, '/index.html');
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`本地服务异常：${error.message}`);
    } else {
      res.destroy(error);
    }
  }
});

server.on('upgrade', (req, client, head) => {
  const pathname = new URL(req.url, `http://${host}:${port}`).pathname;
  if (!apiPrefixes.some(prefix => pathname.startsWith(prefix))) {
    client.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') { client.destroy(); return; }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  client.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  if (head.length) client.unshift(head);
  client.on('data', frame => {
    if (frame.length < 2) return;
    const opcode = frame[0] & 0x0f;
    if (opcode === 0x8) client.end(Buffer.from([0x88, 0x00]));
    else if (opcode === 0x9) client.write(Buffer.from([0x8a, 0x00]));
  });
  client.on('error', () => client.destroy());
});

server.listen(port, host, () => {
  console.log(`剧梦前端发布包本地站：http://${host}:${port}/homepage`);
});
