# Database (BigQuery)

The data lives in a **BigQuery dataset** (`devoshop`, region `europe-southwest1`, the same as Cloud Run).
`init.sql` is a GoogleSQL script that creates the dataset, tables and views and loads the catalogue.

```sh
gcloud services enable bigquery.googleapis.com
bq --location=europe-southwest1 mk --dataset devoshop   # once; skip if it exists
bq --location=europe-southwest1 query --use_legacy_sql=false < db/init.sql
```

You can also paste `init.sql` into the BigQuery console and run it as one script.

- **Safe to re-run.** `productos`, `producto_origenes`, `historial_ventas`, `condiciones` and the views are replaced;
  `pedidos` and `pedido_lineas` are only created if missing, so the orders already placed are kept.
- **Shared and persistent.** Unlike the old Postgres in the container, every Cloud Run instance sees the same data,
  and orders survive restarts.
- **No CHECK constraints or enforced keys** in BigQuery: `PRIMARY KEY … NOT ENFORCED` is only a hint.
  The build script checks the vocabularies (categoría, color, material) for the catalogue;
  the app must check what it writes to `pedidos`.
- **Access from Cloud Run:** the service account needs `roles/bigquery.dataViewer` on the dataset
  (`roles/bigquery.dataEditor` to write orders) and `roles/bigquery.jobUser` on the project.
- To use another dataset or region: `BQ_DATASET=devoshop_test BQ_LOCATION=EU node db/build-init.mjs`.

## Where the data comes from

`data/` holds the supplier files exactly as delivered (`LEEME.md` has the rules).
`init.sql` is **generated** from them — don't edit it by hand:

```sh
node db/build-init.mjs     # rewrites db/init.sql and prints what it merged/excluded
```

After regenerating, run the `bq query` command above again.

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
| `catalogo_json` (view) | The exact `GET /catalogo.json` body, as a JSON string: `SELECT catalogo FROM devoshop.catalogo_json` |
| `comprado_junto` (view) | Products bought together: `SELECT * FROM devoshop.comprado_junto WHERE sku = '…' ORDER BY pedidos DESC` |
