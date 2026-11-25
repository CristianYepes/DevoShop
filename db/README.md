# Database (PostgreSQL)

Postgres 17 runs **inside the app container** (root `Dockerfile` + `docker-entrypoint.sh`).
On start the entrypoint creates the database, loads `init.sql`, then runs `node src/server.js`.

```sh
docker build -t devoshop .
docker run --rm -p 8080:8080 --name devoshop devoshop
docker exec -it devoshop psql            # psql shell (PG* env vars are preset)
```

- Listens on `127.0.0.1:5432` only, so it is not reachable from outside the container; no password (trust auth).
- The app gets `DATABASE_URL=postgres://devoshop@127.0.0.1:5432/devoshop` (and `PGHOST`, `PGUSER`, … for `pg`/`postgres` clients).
- **Ephemeral:** the data lives in the container filesystem. Every new container (every Cloud Run instance)
  starts from `init.sql`, and instances don't share data. Fine for the catalogue, which is read-only;
  anything written at runtime (e.g. `pedidos`) is lost on restart and not shared between instances.

## Where the data comes from

`data/` holds the supplier files exactly as delivered (`LEEME.md` has the rules).
`init.sql` is **generated** from them — don't edit it by hand:

```sh
node db/build-init.mjs     # rewrites db/init.sql and prints what it merged/excluded
```

After regenerating, rebuild the image; `init.sql` is copied into it at build time.

Cleaning done by the script:
- Supplier A: latin-1 → UTF-8, decimal commas, prices without VAT (`IVA_INCL=N`) × 1.21, sizes in m or cm, all-caps names tidied.
- Supplier B: English categories/colours/materials → the Spanish vocab in `LEEME.md`, sizes in mm/cm or only in the description, seats (`plazas`) read from the description, `price_cents` without VAT × 1.21.
- Same product in both suppliers (matched by name, ignoring accents, case and "N plazas"): one row, data from the most recent `updated_at` / `F_ACT`, both ids kept.
- Discontinued products (in their latest record) are left out.

## Tables and views

| Name | What |
|---|---|
| `productos` | Clean catalogue: price with VAT, sizes in cm, `plazas` only for sofas, `descripcion` from supplier B |
| `producto_origenes` | Supplier ids (`A-…`, `B-…`) → `sku` |
| `historial_ventas` | Past orders of a similar store |
| `condiciones` | Shipping, assembly, returns, warranty, payment as key/values |
| `pedidos`, `pedido_lineas` | Orders placed in this store |
| `catalogo_json` (view) | The exact `GET /catalogo.json` body: `SELECT catalogo FROM catalogo_json` |
| `comprado_junto` (view) | Products bought together: `WHERE sku = '…' ORDER BY pedidos DESC` |
