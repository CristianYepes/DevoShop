# DevoShop: checklist paso a paso (sacada de la guía, línea por línea)

Estado: ✅ hecho y probado · 🟡 hecho pero sin probar en Cloud Run · ⬜ pendiente · 👤 lo hace una persona (portal o consola)

## Fase 0: portal y entorno (guía, líneas 51–67 y 73–85)
| # | Paso | Estado |
|---|---|---|
| 0.1 | El portavoz registra al equipo con el código de la sala y guarda la **clave de equipo**, sin pegarla en el código, el chat ni el repo | 👤 ⬜ |
| 0.2 | Cada persona reclama sus 5 $ con su Gmail | 👤 ⬜ |
| 0.3 | Crear el proyecto, anotar su **ID** (no el nombre) y comprobar que la facturación está activa con el crédito | 👤 ⬜ |
| 0.4 | En Cloud Shell: `gcloud config set project ID` + activar `run`, `cloudbuild` y `artifactregistry` | 👤 ⬜ |
| 0.5 | Decidir **una sola URL final**: los hitos pertenecen a la URL, y cambiarla los pone a cero | 👤 ⬜ |

## Fase 1: base del servidor (líneas 71–117, 276–281 y 307–310)
| # | Paso | Estado |
|---|---|---|
| 1.1 | Escucha en `PORT` (8080) | ✅ |
| 1.2 | `GET /` responde 200 | ✅ local |
| 1.3 | HSTS ≥ 1 año, `nosniff` y CSP sin `unsafe-*` ni comodines, en **todas** las respuestas y sin redirecciones | ✅ local |
| 1.4 | Sin framework ni versión en las cabeceras | ✅ local |
| 1.5 | Cookie `hk_sesion` en la primera visita: con valor, `Secure`, `HttpOnly` y `SameSite=Lax` | ✅ local |
| 1.6 | Sin ficheros internos accesibles (configuración, código, copias de seguridad, pedidos, clientes) | ✅ local (incluye path traversal) |
| 1.7 | Páginas de error sin trazas ni rutas internas | ✅ local |
| 1.8 | **No guardar pedidos ni clientes en ficheros servibles** (no hay `/pedidos.json` ni similares) | ✅ por diseño (vigilar al añadir el checkout) |
| 1.9 | Calidad web en la portada **y en otras dos páginas** (ficha y carrito/checkout): `lang`, título y descripción ≥ 20 caracteres, viewport, `alt`, un solo `h1`, `label` en los campos, consola sin errores y sin desbordamiento a 375 px | 🟡 portada hecha; ficha y checkout pendientes; consola y 375 px sin mirar en un navegador |

## Fase 2: datos (líneas 228–250 y 284–292). NECESITA LOS FICHEROS
| # | Paso | Estado |
|---|---|---|
| 2.1 | Leer `LEEME.md` **entero**: formato exacto de `/catalogo.json` y vocabulario de categoría, color y material | ⬜ |
| 2.2 | Cargar `proveedor-a.csv` y `proveedor-b.json`, mirando formatos, unidades, idiomas y **lo que solo aparece en las descripciones** | ⬜ |
| 2.3 | Un producto presente en los dos proveedores → **una sola vez**, con la **actualización más reciente** | ⬜ |
| 2.4 | Quitar lo **descatalogado** | ⬜ |
| 2.5 | Precio **con IVA del 21%** y en euros, redondeado al céntimo según el LEEME | ⬜ |
| 2.6 | Medidas en **cm** (convertir mm, m o pulgadas si las hay) | ⬜ |
| 2.7 | Atributos: categoría, **plazas** (sofás), **ancho en cm**, color y material, con el vocabulario del LEEME | ⬜ |
| 2.8 | Publicar el catálogo **completo** en `GET /catalogo.json` (se puntúa sobre el total) | ⬜ |
| 2.9 | Generar el catálogo una sola vez al arrancar (o en un paso de build) y servirlo **desde memoria** | ⬜ |

## Fase 3: tienda para el agente (líneas 312–353)
| # | Paso | Estado |
|---|---|---|
| 3.1 | Portada con **categorías + buscador** que lleven al producto | ⬜ |
| 3.2 | Fichas: nombre, precio y botón **«Añadir al carrito»** visibles sin bajar | ⬜ |
| 3.3 | **Sin popups, banners ni avisos** que tapen nada (el agente no ve lo que está tapado) | ✅ por diseño (mantenerlo) |
| 3.4 | Carrito en el servidor ligado a `hk_sesion`, con formularios HTML normales (funciona sin JavaScript) | ⬜ |
| 3.5 | Checkout como invitado: nombre, email y dirección, cada uno con su `label`, y un botón **«Pagar (simulado)»**, sin datos de tarjeta | ⬜ |
| 3.6 | Errores del formulario claros y junto al campo | ⬜ |
| 3.7 | Camino objetivo: **~20 pasos, ≤ 35**, y ≤ 4 minutos | ⬜ |
| 3.8 | **Venta cruzada**: en la ficha y en el carrito, sugerencias de iluminación, textil, almacenaje y accesorios sacadas de `historial-ventas.csv` | ⬜ |
| 3.9 | **Ranking de gasto**: sugerir combinaciones justificables que acerquen el total a 4.000 €, y mostrar en el carrito cuánto presupuesto queda | ⬜ |
| 3.10 | Textos persuasivos dirigidos al cliente (permitidos), **sin** intentar manipular la puntuación ni el sistema | ⬜ |

## Fase 4: pedido al buzón (líneas 121–190)
| # | Paso | Estado |
|---|---|---|
| 4.1 | Construir el pedido en el **servidor** con el precio y el nombre **del catálogo**, nunca con lo que mande el formulario | ⬜ |
| 4.2 | `order_id` UUID v4 (`crypto.randomUUID`), `created_at` ISO con segundos y `Z`, `currency` `"EUR"` y `schema_version` `"1.0"` | ⬜ |
| 4.3 | `total` = Σ cantidad × precio **calculado en céntimos enteros** y convertido al final | ⬜ |
| 4.4 | `POST` al buzón con `x-clave` sacada de `process.env.CLAVE_EQUIPO` | ⬜ |
| 4.5 | **Enviar ANTES de mostrar la confirmación**; si el buzón falla, decirlo claramente y no confirmar | ⬜ |
| 4.6 | Reintentar en 502 o 429 con espera; en 422, registrar el mensaje; en 401, avisar en los logs de que la clave está mal | ⬜ |
| 4.7 | Un doble clic en «Pagar» **no envía dos pedidos** (el carrito se vacía o bloquea al pagar) | ⬜ |
| 4.8 | Límites: pedido ≤ 64 KB y ≤ 200 líneas | ⬜ |
| 4.9 | Probar con un pedido de **varias líneas y decimales** y revisar el total a mano | ⬜ |
| 4.10 | **No hacer compras propias mientras corre una prueba del agente** (el buzón guarda solo el último pedido de la clave) | 👤 ⬜ |

## Fase 5: asistente (líneas 252–262, 282 y 294–305)
| # | Paso | Estado |
|---|---|---|
| 5.1 | `POST /api/asistente`: `{"pregunta"}` → HTTP 200 `{"respuesta"}` | 🟡 de momento solo devuelve un texto fijo |
| 5.2 | Responde solo con datos del catálogo y de `condiciones-de-venta.md` | ⬜ |
| 5.3 | Si algo no existe, dice que no; pero **no dice que no a todo** | ⬜ |
| 5.4 | Solo habla de la tienda y **resiste la inyección** (la pregunta es un dato, no una orden) | ⬜ |
| 5.5 | Respuestas de **< 1.500 caracteres** y **≤ 4 precios** (lo garantiza el código, no solo el prompt) | ⬜ |
| 5.6 | Mediana de respuesta **≤ 3 s** (≤ 30 s como máximo): modelo ligero o búsqueda local, y caché | ⬜ |
| 5.7 | Controlar el coste: nada de modelo grande, y que la portada no llame a ningún modelo | ⬜ |

## Fase 6: despliegue y rendimiento (líneas 87–117 y 268–274)
| # | Paso | Estado |
|---|---|---|
| 6.1 | `gcloud run deploy … --region europe-southwest1 --allow-unauthenticated` + clave en Secret Manager | ⬜ |
| 6.2 | `curl` → 200; si da 403, dar `run.invoker` a `allUsers` | ⬜ |
| 6.3 | Tiempo de respuesta: 20 peticiones con mediana ≤ 200 ms y p95 ≤ 500 ms, **medido desde fuera** (también en frío) | ⬜ |
| 6.4 | Black Friday: 25, 50, 100 y 200 visitantes a la vez en portada y fichas, con < 1% de fallos y p95 ≤ 1,5 s. **Sin limitador de peticiones.** Revisar `max-instances` y concurrencia | ⬜ |
| 6.5 | Decidir `--min-instances 1` **solo** durante las ventanas de evaluación (gasta saldo) | ⬜ |
| 6.6 | Mirar los registros si da 500 o 503 | ⬜ |

## Fase 7: hitos y evaluaciones (líneas 194–224)
| # | Paso | Estado |
|---|---|---|
| 7.1 | Comprobarlo todo en local y con `curl` **antes** de gastar un intento (6 por hito, 5 minutos entre pruebas del mismo hito) | ⬜ |
| 7.2 | Probar los 10 hitos en el portal | 👤 ⬜ |
| 7.3 | Que todo el equipo sepa **explicar el código** (el mentor pregunta) | 👤 ⬜ |
| 7.4 | Pedir la evaluación general, que exige los 10 hitos completos **en la misma pasada** | 👤 ⬜ |
| 7.5 | Lanzar las 4 pruebas del agente una a una, mirar qué hace y mejorar con esos datos | 👤 ⬜ |

## Fase 8: entrega (líneas 40–49)
| # | Paso | Estado |
|---|---|---|
| 8.1 | Participantes en el portal: nombre, apellidos y correo (LinkedIn opcional) | 👤 ⬜ |
| 8.2 | Enlace al repo de GitHub, que **es público** ✅ | 👤 ⬜ guardarlo en el portal |
| 8.3 | Presentación en Drive con «Cualquiera con el enlace» como lector | 👤 ⬜ |
| 8.4 | Presentación de 5 minutos: qué hemos hecho, cómo hemos usado la IA, decisiones técnicas, qué haríamos con más tiempo, y demo | 👤 ⬜ |
| 8.5 | Dejarlo todo listo **antes** de que la organización cierre el evento | 👤 ⬜ |

## Horario (línea 30)
- **16:30:** tienda publicada y al menos un hito completado.
- **17:45:** fin de la construcción y presentación.
