// DevoShop HTTP server. Uses only Node's standard library: fewer dependencies means a
// faster cold start on Cloud Run and nothing to leak in "x-powered-by" style headers.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderHome, renderError } from './pages.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY_BYTES = 16 * 1024;

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  // No inline scripts or styles anywhere: all JS/CSS lives in /static.
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, ...extra });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

/** Sets hk_sesion on the first visit only; an existing session is never overwritten. */
function sessionCookie(req) {
  if (/(?:^|;\s*)hk_sesion=[^;]+/.test(req.headers.cookie ?? '')) return {};
  const id = randomBytes(16).toString('hex');
  return { 'set-cookie': `hk_sesion=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400` };
}

/** Serves files from public/ only. Any path that resolves outside it is a 404. */
async function serveStatic(res, urlPath) {
  const ext = path.extname(urlPath);
  const type = STATIC_TYPES[ext];
  if (!type) return false;
  const file = path.resolve(PUBLIC_DIR, '.' + urlPath.slice('/static'.length));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const data = await readFile(file);
    send(res, 200, data, type, { 'cache-control': 'public, max-age=3600' });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return false;
    throw err;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function route(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, renderError(400));
  }

  if (urlPath === '/api/asistente') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usa POST' });
    const body = await readJsonBody(req);
    if (typeof body?.pregunta !== 'string' || !body.pregunta.trim()) {
      return sendJson(res, 400, { error: 'Falta "pregunta"' });
    }
    const assistantBase = process.env.ASISTENTE_URL?.trim();
    if (!assistantBase) {
      return sendJson(res, 200, { respuesta: 'El asistente de DevoShop estará disponible en breve.' });
    }
    const target = `${assistantBase.replace(/\/+$/, '')}/api/asistente`;
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pregunta: body.pregunta }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.error('assistant upstream error:', err?.message ?? err);
      return sendJson(res, 502, { error: 'No se pudo contactar con el asistente' });
    }
    if (!upstream.ok) {
      console.error(`assistant upstream returned HTTP ${upstream.status}`);
      return sendJson(res, 502, { error: 'El asistente no pudo responder en este momento' });
    }
    const data = await upstream.json().catch(() => null);
    if (typeof data?.respuesta !== 'string') {
      console.error('assistant upstream returned invalid JSON payload');
      return sendJson(res, 502, { error: 'Respuesta no válida del asistente' });
    }
    return sendJson(res, 200, { respuesta: data.respuesta });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, renderError(405), undefined, { allow: 'GET, HEAD' });
  }

  if (urlPath === '/') return send(res, 200, renderHome(), undefined, sessionCookie(req));
  if (urlPath.startsWith('/static/') && (await serveStatic(res, urlPath))) return;
  return send(res, 404, renderError(404));
}

export function createApp() {
  return createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err.status ?? 500;
      // Log the detail server-side (Cloud Run logs); the client only gets a generic page.
      if (status >= 500) console.error(`${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) {
        if (req.url.startsWith('/api/')) sendJson(res, status, { error: 'Petición no válida' });
        else send(res, status, renderError(status));
      } else res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  createApp().listen(port, () => console.log(`DevoShop listening on ${port}`));
}
