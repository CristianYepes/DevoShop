# SPEC V0: primer borrador completo (backend + frontend)

**Objetivo:** que un agente con navegador pueda entrar, encontrar productos **reales**, añadirlos al carrito, pagar (simulado) y que el pedido llegue al buzón. Además: `/catalogo.json`, el asistente y la venta cruzada.
**Fuera de V0:** Postgres en tiempo de ejecución, un asistente con LLM y WebMCP/UCP.

## Decisiones
1. **Catálogo en memoria, generado al arrancar** con la **misma limpieza** que `db/build-init.mjs` (movida a `src/limpieza.js`; `build-init.mjs` la importa, así que `init.sql` no cambia). Así no hay base de datos en el camino de la petición: rápido para Black Friday y el tiempo de respuesta.
2. **El carrito va en una cookie firmada con HMAC** (`hk_carrito`). Solo guarda `[sku, cantidad]`; el nombre y el precio salen siempre del catálogo. Funciona con varias instancias de Cloud Run. La firma usa `CARRITO_SECRETO` (variable de entorno); si no está, se genera una al arrancar y se avisa en el log.
3. **Pedido idempotente:** `GET /checkout` genera un `order_id` (UUID v4) en un campo oculto. `POST /checkout` lo reutiliza: un doble clic manda el mismo `order_id`, y si el buzón responde 422 por "repetido", se trata como pedido ya registrado.
4. **Total en céntimos enteros.** `total = Σ cantidad × céntimos / 100`.
5. **Buzón:** `BUZON_URL` (por defecto, el de la guía) y `CLAVE_EQUIPO` (variable de entorno, nunca en el código). Reintento en 429, 502 y error de red (3 intentos, < 10 s). El pedido se envía **antes** de mostrar la confirmación.
6. **Asistente sin LLM (V0):** busca en el catálogo y en las condiciones de venta. Es rápido (< 50 ms), no cuesta saldo y no hace caso de órdenes porque no "ejecuta" nada: la pregunta es solo un dato. Máximo 1.500 caracteres y 4 precios.
7. **Sin precios "antes" inventados:** la página de ofertas pasa a ser **"Más vendidos"** (unidades del historial, prueba social real).
8. **Venta cruzada:** el bloque "Se compra junto con" sale de `historial-ventas.csv`, filtrado a iluminación, textil, almacenaje y accesorios.

## Mapa de lo que se toca
| Pieza | Cambio | Quién la usa | Estado compartido |
|---|---|---|---|
| `src/limpieza.js` (nuevo) | Limpieza de A + B (sacada de `build-init.mjs`) | `catalog.js`, `build-init.mjs` | — |
| `db/build-init.mjs` | Importa `limpieza.js` (sin cambiar su salida) | equipo (genera `init.sql`) | `init.sql` |
| `src/catalog.js` | Productos reales con la misma API que ya usan las páginas, más `catalogoJson()`, `compradoJunto()`, `masVendidos()` y packs reales | `pages.js`, `server.js`, asistente | catálogo en memoria (solo lectura) |
| `src/carrito.js` (nuevo) | Cookie firmada: leer, escribir, añadir, cambiar cantidad | `server.js` | cookie `hk_carrito` |
| `src/pedido.js` (nuevo) | Construir el pedido v1.0 y enviarlo al buzón | `server.js` | buzón externo (último pedido por clave) |
| `src/asistente.js` (nuevo) | Respuestas a partir del catálogo y las condiciones | `server.js` | — |
| `src/server.js` | Rutas nuevas y lectura de formularios | — | cookies |
| `src/pages.js` | Carrito, checkout, confirmación, más vendidos y "se compra junto con" | `server.js` | — |
| `Dockerfile` | Copiar `db/data` en la imagen | Cloud Build | — |

## Lista de bordes (cada uno con su test)
- `/catalogo.json`: **53** productos; ninguno de A-2337, B-82541, B-21589 ni B-94642; 13 con dos `ids_origen`; precios: escritorio elevable 429,00, flexo 35,00, sofá Lund 1.076,90 y sofá Nórdico 849,00; todos los valores dentro del vocabulario del `LEEME.md`.
- Carrito vacío → `/checkout` no envía nada y manda de vuelta a la tienda.
- Añadir el mismo SKU dos veces → una línea con cantidad 2.
- SKU inexistente al añadir → 404 o aviso; nunca entra en el carrito.
- Cookie manipulada → carrito vacío.
- Cantidad fuera de rango (0, -1, 999, "abc") → se limita a 1–20; con 0 se quita la línea.
- Un precio con céntimos y cantidad > 1 → total exacto al céntimo.
- El formulario no puede cambiar el precio ni el nombre: el pedido sale del catálogo.
- Email no válido o campo vacío → error junto al campo, sin pedido.
- Doble POST con el mismo `order_id` → el buzón recibe el mismo `order_id`; nunca dos pedidos distintos.
- Buzón 502 y después 200 → pedido registrado tras reintentar. Buzón 422 (que no sea "repetido") → página de error, sin confirmación.
- Asistente: 200 con `respuesta`; "¿cuánto cuesta el envío?" menciona 49 € y 500 €; un producto que no existe → lo dice; una orden para salirse de su papel → sigue hablando solo de la tienda; ≤ 1.500 caracteres y ≤ 4 precios.

## Cómo sabremos que funciona
`npm test` en verde, y una compra de punta a punta en local contra un buzón falso. El despliegue se decide después (ver `docs/CLOUD-RUN.md`).
