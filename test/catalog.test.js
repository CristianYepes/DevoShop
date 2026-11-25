import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogReader } from '../src/catalog.js';
import { createApp } from '../src/server.js';

const catalog = {
  productos: [{ sku: 'sofa', ids_origen: ['A-1'], nombre: 'Sofá', categoria: 'sofa', precio: 649 }],
};

test('consulta la vista y comparte el resultado entre peticiones concurrentes', async () => {
  let queries = 0;
  const loadCatalog = createCatalogReader(async (sql) => {
    queries++;
    assert.equal(sql, 'SELECT catalogo FROM catalogo_json');
    return { rows: [{ catalogo: catalog }] };
  });
  assert.deepEqual(await Promise.all([loadCatalog(), loadCatalog()]), [catalog, catalog]);
  assert.deepEqual(await loadCatalog(), catalog);
  assert.equal(queries, 1);
});

test('no cachea fallos ni un catálogo inválido y permite recuperarse', async () => {
  let attempts = 0;
  const loadCatalog = createCatalogReader(async () => {
    attempts++;
    if (attempts === 1) throw new Error('database unavailable');
    if (attempts === 2) return { rows: [{ catalogo: { productos: [] } }] };
    return { rows: [{ catalogo: catalog }] };
  });
  await assert.rejects(loadCatalog(), (error) => error.status === 503);
  await assert.rejects(loadCatalog(), (error) => error.status === 503);
  assert.deepEqual(await loadCatalog(), catalog);
  assert.equal(attempts, 3);
});

test('publica el catálogo y aplica cabeceras de seguridad', async (t) => {
  const server = createApp({ loadCatalog: async () => catalog });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/catalogo.json`;

  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), catalog);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('devuelve 503 sin filtrar detalles si PostgreSQL no responde', async (t) => {
  const loadCatalog = createCatalogReader(async () => { throw new Error('secret database detail'); });
  const server = createApp({ loadCatalog });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.mock.method(console, 'error', () => {});

  const response = await fetch(`http://127.0.0.1:${server.address().port}/catalogo.json`);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret database detail/);
});
