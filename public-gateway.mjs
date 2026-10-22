import { createServer, request as httpRequest } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const configPath = join(import.meta.dirname, 'public-access.json');
if (!existsSync(configPath)) {
  writeFileSync(configPath, JSON.stringify({ username: 'local', password: randomBytes(24).toString('base64url') }, null, 2), { flag: 'wx', mode: 0o600 });
}
const { username, password } = JSON.parse(readFileSync(configPath, 'utf8'));
if (!username || !password) throw new Error('public-access.json 缺少访问凭据');

const publicPort = Number(process.env.JZZM_PUBLIC_PORT || 4176);
const originPort = Number(process.env.JZZM_LOCAL_PORT || 4173);
const originHost = '127.0.0.1';
const expected = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
const session = createHash('sha256').update(`jzzm-public-session:${password}`).digest('base64url');

function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req) {
  if (equal(req.headers.authorization, expected)) return true;
  return String(req.headers.cookie || '').split(';').some(part => {
    const [key, value] = part.trim().split('=', 2);
    return key === 'jzzm_public_session' && equal(value, session);
  });
}

function authority(req) {
  const value = String(process.env.JZZM_PUBLIC_HOST || req.headers['x-forwarded-host'] || req.headers.host || '');
  return /^[A-Za-z0-9.-]+(?::\d+)?$/.test(value) ? value : `127.0.0.1:${publicPort}`;
}

function proxyHeaders(req) {
  const headers = { ...req.headers, host: `${originHost}:${originPort}` };
  delete headers.authorization;
  delete headers.cookie;
  return headers;
}

function reject(req, res) {
  res.writeHead(401, { 'www-authenticate': 'Basic realm="Xingmu Studio"', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('需要网站访问密码');
}

const server = createServer((req, res) => {
  if (!authorized(req)) { reject(req, res); return; }
  const upstream = httpRequest({ hostname: originHost, port: originPort, path: req.url,
    method: req.method, headers: proxyHeaders(req) }, response => {
    const headers = { ...response.headers };
    const csp = headers['content-security-policy'];
    if (typeof csp === 'string') {
      const scheme = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
      headers['content-security-policy'] = csp.replace(/ws:\/\/127\.0\.0\.1:\d+/, `${scheme}://${authority(req)}`);
    }
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    headers['set-cookie'] = `jzzm_public_session=${session}; Path=/; HttpOnly; SameSite=Lax${secure}`;
    headers['referrer-policy'] = 'no-referrer';
    res.writeHead(response.statusCode || 502, headers);
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('本地网站尚未运行');
  });
  req.pipe(upstream);
});

server.on('upgrade', (req, client, head) => {
  if (!authorized(req)) {
    client.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Xingmu Studio"\r\nConnection: close\r\n\r\n');
    return;
  }
  const upstream = httpRequest({ hostname: originHost, port: originPort, path: req.url,
    method: 'GET', headers: proxyHeaders(req) });
  upstream.on('upgrade', (response, socket, upstreamHead) => {
    const headers = Object.entries(response.headers)
      .flatMap(([key, value]) => Array.isArray(value) ? value.map(item => `${key}: ${item}`) : [`${key}: ${value}`]);
    client.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head.length) socket.write(head);
    if (upstreamHead.length) client.write(upstreamHead);
    client.pipe(socket);
    socket.pipe(client);
    socket.on('error', () => client.destroy());
    client.on('error', () => socket.destroy());
  });
  upstream.on('response', response => {
    client.end(`HTTP/1.1 ${response.statusCode || 502} Bad Gateway\r\nConnection: close\r\n\r\n`);
  });
  upstream.on('error', () => client.destroy());
  upstream.end();
});

server.listen(publicPort, '127.0.0.1', () => {
  console.log(`受保护的网站入口：http://127.0.0.1:${publicPort}/homepage`);
});
