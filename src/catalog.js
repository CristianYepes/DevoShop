import pg from 'pg';

function unavailable(message, cause) {
  return Object.assign(new Error(message, { cause }), { status: 503 });
}

export function createCatalogReader(query) {
  let cached;
  return async function readCatalog() {
    if (!cached) {
      cached = (async () => {
        let result;
        try {
          result = await query('SELECT catalogo FROM catalogo_json');
        } catch (cause) {
          throw unavailable('No se pudo consultar el catálogo', cause);
        }
        const catalog = result.rows?.[0]?.catalogo;
        if (!Array.isArray(catalog?.productos) || catalog.productos.length === 0) {
          throw unavailable('El catálogo está vacío o tiene un formato inválido');
        }
        return catalog;
      })().catch((error) => {
        cached = undefined;
        throw error;
      });
    }
    return cached;
  };
}

let pool;
export const readCatalog = createCatalogReader((sql) => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurada');
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 });
  return pool.query(sql);
});
