// "No filtra nada" milestone: internal files, error pages and what the server advertises,
// plus the Docker image actually containing what the server reads at startup.
// Each test names the bug it is meant to catch ("KILLS: ...").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.js';

let server;
let base;
before(async () => {
  server = createApp({ secreto: 'test', claveEquipo: '' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const TRACE = /\bat [\w.<>]+ \(|node:internal|[A-Z]:\\|\/app\/|\.js:\d+|Error: |ENOENT|SyntaxError|TypeError/;

test('raw supplier data and repo files are not served. KILLS: data or source leak', async () => {
  for (const p of [
    '/db/data/proveedor-a.csv', '/data/proveedor-a.csv', '/proveedor-a.csv', '/historial-ventas.csv',
    '/static/../db/data/proveedor-b.json', '/static/..%2f..%2fdb%2fdata%2fproveedor-a.csv', '/db/init.sql',
    '/backend/store.go', '/backend/go.mod', '/db/build-init.mjs', '/src/limpieza.js', '/.gcloudignore',
    '/pedidos.csv', '/clientes.json', '/api/pedidos', '/admin', '/server.js.bak', '/backup.sql', '/static/carrito.js.map',
  ]) {
    const res = await fetch(base + p, { redirect: 'manual' });
    assert.equal(res.status, 404, `${p} must be 404, got ${res.status}`);
    assert.doesNotMatch(await res.text(), /REF;DESCRIPCION|pedido,fecha|"products"|package main|CREATE TABLE/, p);
  }
});

test('oversized bodies get a clean 413 page, not a reset connection. KILLS: error without a proper page', async () => {
  for (const [path, type, body] of [
    ['/api/asistente', 'application/json', JSON.stringify({ pregunta: 'x'.repeat(20000) })],
    ['/checkout', 'application/x-www-form-urlencoded', `nombre=${'x'.repeat(40000)}`],
  ]) {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': type }, body });
    assert.equal(res.status, 413, path);
    assert.doesNotMatch(await res.text(), TRACE, path);
  }
});

test('malformed input never answers 5xx or shows a trace. KILLS: stack trace or internal path on an error page', async () => {
  for (const [path, init] of [
    ['/producto/%00', {}],
    ['/buscar?q=%E0%A4%A', {}],
    ['/api/asistente', { method: 'POST', body: 'null', headers: { 'content-type': 'application/json' } }],
    ['/api/asistente', { method: 'POST', body: '"texto"', headers: { 'content-type': 'application/json' } }],
    ['/carrito/anadir', { method: 'POST', body: '%%%', headers: { 'content-type': 'application/x-www-form-urlencoded' } }],
    ['/carrito/cantidad', { method: 'POST', body: 'sku=sofa-nordico&cantidad=-99999999999999999999', headers: { 'content-type': 'application/x-www-form-urlencoded' } }],
    ['/carrito', { headers: { cookie: 'hk_carrito=%%%.%%%' } }],
    ['/pedido/00000000-0000-4000-8000-000000000000', { headers: { cookie: 'hk_pedido=eyJ9.x' } }],
    ['/', { method: 'PUT', body: 'x' }],
  ]) {
    const res = await fetch(base + path, { redirect: 'manual', ...init });
    assert.ok(res.status < 500, `${init.method ?? 'GET'} ${path} -> ${res.status}`);
    assert.doesNotMatch(await res.text(), TRACE, path);
  }
});

test('no framework or server version in any response. KILLS: advertising the stack', async () => {
  for (const p of ['/', '/no-existe', '/catalogo.json', '/static/styles.css']) {
    const res = await fetch(base + p);
    assert.equal(res.headers.get('x-powered-by'), null, p);
    assert.equal(res.headers.get('server'), null, p);
  }
});

test('the Docker image contains every data file the server reads at startup. KILLS: store crashing on Cloud Run (ENOENT)', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const limpieza = readFileSync(new URL('../src/limpieza.js', import.meta.url), 'utf8');
  const needed = [...new Set([...limpieza.matchAll(/join\(dataDir, '([^']+)'\)/g)].map((m) => m[1]))];
  assert.ok(needed.length >= 3, 'expected to find the supplier files read by limpieza.js');
  for (const f of needed) assert.match(dockerfile, new RegExp(`db/data/${f.replace('.', '\\.')}`), `Dockerfile must COPY db/data/${f}`);
  assert.doesNotMatch(dockerfile, /COPY[^\n]*\bdb\/data\s+\.\/public|COPY[^\n]*\s\.\s+\./, 'never copy data into public/ or the whole repo');
});
