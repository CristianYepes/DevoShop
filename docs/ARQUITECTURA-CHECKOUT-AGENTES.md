# Arquitectura del proceso de compra para agentes

> **Estado:** documento para organizar opciones. El flujo exacto se decide después.
> **Restricciones fijas:** sin usuarios, sin captcha, sin pasarela de pago (pago simulado con un botón).
> **Cómo leer esto:** lo que viene de la documentación oficial (OpenAI, Stripe, Google, Shopify, Chrome) se dice; lo que es propuesta nuestra lleva **[propuesta]**.

---

## 1. La pregunta clave: ¿qué tipo de agente nos va a comprar?

La guía es clara: el agente evaluador **abre la tienda en un navegador de verdad** y en cada paso ve **una captura + la lista de elementos interactivos**. **No llama a APIs ni a protocolos.**

Por tanto:
- **Lo que puntúa es el flujo en HTML** (páginas, enlaces, formularios y botones).
- Los protocolos de comercio agéntico (ACP, UCP, AG-UI, WebMCP) **no los usará el evaluador**. Sirven para dos cosas:
  1. **Copiar sus patrones de diseño**, que son lo que OpenAI, Stripe, Google y Shopify ya han probado: sesión de checkout con estados, el carrito completo en cada respuesta, idempotencia.
  2. **Un extra para la presentación** ("la tienda también está lista para ChatGPT y Gemini"), si sobra tiempo.

---

## 2. Qué existe y para qué sirve

| Protocolo / arquitectura | Quién | Qué es | ¿Nos sirve? |
|---|---|---|---|
| **AG-UI** (Agent-User Interaction Protocol) | CopilotKit (licencia MIT) | Protocolo de **eventos entre un agente y la interfaz**: el frontend hace un POST y recibe por **SSE** un flujo de ~16–17 tipos de eventos JSON (ciclo de vida, mensajes de texto, llamadas a herramientas, estado compartido). **No es un protocolo de compra** | **Poco.** Solo si ponemos el asistente visible en la web con respuestas en streaming. No ayuda al agente evaluador |
| **ACP** (Agentic Commerce Protocol) | OpenAI + Stripe | Es el checkout de ChatGPT. Endpoints para **crear, actualizar y completar una sesión de checkout** (OpenAI habla de 5 endpoints y Stripe de 4). **Cada respuesta lleva el estado completo del carrito** (precios, impuestos, envío y estado). Cabecera **`Idempotency-Key`** (obligatoria en la versión 2026-04-17, según una fuente secundaria). Pago delegado al proveedor de pagos | **Como patrón, mucho** (sección 3). Como integración real no: hay que ser socio aprobado y tener proveedor de pagos |
| **UCP** (Universal Commerce Protocol) | Google, Shopify y otros | Capacidad de **checkout** con estados: `incomplete` → `ready_for_complete` → `completed`, o `canceled` desde cualquier estado no completado. `requires_escalation` + `continue_url` cuando el comprador tiene que terminar en la web. Se descubre en `/.well-known/ucp` | **Como patrón, mucho** (los estados). Un `/.well-known/ucp` de demo es un extra para la presentación |
| **AP2** (Agent Payments Protocol) | Google y más de 60 socios | "Mandatos" firmados que prueban qué autorizó el usuario | **No.** No tenemos pasarela de pago |
| **WebMCP** | Propuesta de Chrome | Un `<form>` con los atributos **`toolname`** y **`tooldescription`** se expone como **herramienta** para el agente del navegador, y sus campos pasan a ser los parámetros. Hay también una API en JavaScript (`registerTool`). **Experimental:** origin trial de Chrome M149 a M156 | **Extra barato:** son dos atributos en nuestros formularios y no rompen nada. No sabemos si el navegador del evaluador lo soporta, así que no puntúa seguro |
| **"Comprar ya" / 1-Click** | Patrón clásico de e-commerce | Un botón en la ficha que salta el carrito y va directo al pago | **Opción a decidir** (sección 4) |

---

## 3. La arquitectura que proponemos [propuesta]: "sesión de checkout" al estilo ACP/UCP, pero en HTML

### 3.1 Principios que copiamos de ACP y UCP
1. **Una sesión de checkout con estados explícitos:** `incomplete` (faltan datos) → `ready_for_complete` (todo bien) → `completed` (pedido aceptado por el buzón). Cada página muestra en qué estado está, y el agente siempre sabe qué falta.
2. **El estado completo del carrito en cada página** (líneas, precios y total), como hace ACP en cada respuesta. El agente nunca tiene que "recordar" nada.
3. **Idempotencia:** pagar dos veces la misma sesión devuelve **el mismo pedido**, nunca dos.
4. **El servidor es la única fuente de verdad del precio:** las líneas solo llevan `sku` y `cantidad`; el nombre y el precio salen siempre del catálogo en memoria.

### 3.2 Estado sin servidor: el carrito en una cookie firmada
**Problema:** Cloud Run puede levantar varias instancias. Un carrito guardado en la memoria de una instancia **se pierde** si la siguiente petición cae en otra.

**Solución:** el carrito y la sesión de checkout viven en una **cookie firmada con HMAC** (`hk_carrito`, `HttpOnly`, `Secure`, `SameSite=Lax`). Contenido: `[{sku, cantidad}]` + `checkout_id` + `order_id` cuando exista. La clave de firma va en una variable de entorno o en Secret Manager.
- Funciona con 1 o 100 instancias, sin base de datos y sin coste.
- Si alguien altera la cookie, la firma falla y el carrito queda vacío. No se puede inyectar ningún precio, porque la cookie no lleva precios.
- **Límite:** una cookie tiene unos 4 KB, así que hay que poner un máximo de líneas distintas (por ejemplo 40). El buzón acepta hasta 200 líneas.

### 3.3 Flujo y rutas
```
GET  /                         portada (categorías, buscador, packs)
GET  /buscar?q=…               resultados (nunca vacíos)
GET  /c/:categoria?filtros     listado con filtros como enlaces
GET  /p/:sku                   ficha: «Añadir al carrito, X €» + complementos
POST /carrito/anadir           {sku, cantidad=1} → 303 a /carrito
POST /carrito/anadir-pack      {pack} → añade varios SKU reales → 303 a /carrito
POST /carrito/cantidad         {sku, cantidad} (0 = quitar) → 303 a /carrito
GET  /carrito                  líneas + total + «Finalizar compra como invitado»
GET  /checkout                 formulario (nombre, email, dirección) + resumen; crea checkout_id
POST /checkout                 valida → ready_for_complete → ENVÍA AL BUZÓN → completed → 303 a /pedido/:order_id
GET  /pedido/:order_id         «Pedido confirmado» (h1) + líneas + total
```
- **Patrón POST → 303 → GET** en todos los formularios: si se recarga la página no se reenvía nada.
- Cada formulario funciona **sin JavaScript** (la CSP ya prohíbe scripts en línea, y es lo más robusto para el agente).

### 3.4 El pago: el momento crítico
```
POST /checkout
 1. Leer la cookie y comprobar la firma. Si está vacía: volver al carrito con un mensaje "Tu carrito está vacío".
 2. Validar nombre, email y dirección. Si falta algo: la misma página con el error junto al campo y los datos conservados (estado incomplete).
 3. Si la sesión ya está completed: redirigir a /pedido/:order_id (idempotencia, por si hay doble clic).
 4. Generar el order_id (UUID v4) UNA SOLA VEZ y guardarlo en la cookie ANTES de enviar.
 5. Construir el pedido desde el catálogo: nombre y precio en céntimos, total = Σ cantidad × céntimos.
 6. POST al buzón con reintentos (502, 429 o error de red: 3 intentos con espera, en menos de 10 s en total).
      200                          → completed
      422 por "order_id repetido"  → ya se registró en un intento anterior → completed
      otro 422 / 401 / 400 / 413   → log con el mensaje del buzón; página de error clara con «Reintentar»
 7. Solo con completed: 303 a /pedido/:order_id.
```

### 3.5 Lista de bordes que hay que probar (antes de escribir el código)
| Borde | Comportamiento esperado |
|---|---|
| Carrito vacío → /checkout | Mensaje y enlace a la tienda, nunca un pedido vacío |
| Una línea / muchas líneas / el máximo de líneas | Funciona; si se pasa del máximo, aviso claro |
| Añadir el mismo SKU dos veces | Una sola línea con cantidad 2 |
| SKU que no existe o descatalogado (cookie antigua tras redesplegar) | Se quita la línea con un aviso; nunca se envía al buzón |
| Precio cambiado entre añadir y pagar | Se usa el precio actual del catálogo (el que ve el evaluador en `/catalogo.json`) |
| Decimales (por ejemplo 3 × 33,33 €) | Total exacto al céntimo, calculado en céntimos enteros |
| Doble clic en Pagar / recargar la confirmación | Un solo pedido |
| Buzón caído (502), saturado (429) o sin red | Reintento; si sigue fallando, error claro y **sin confirmación falsa** |
| Respuesta perdida pero pedido registrado | El reintento da 422 por repetido → se trata como éxito |
| Cookie manipulada | Firma inválida → carrito vacío |
| Email mal escrito | Error junto al campo con un ejemplo |
| `CLAVE_EQUIPO` sin configurar | El servidor lo dice en el log al arrancar; el pago da un error claro |

---

## 4. Decisiones pendientes (para definir luego)

| Decisión | Opción A | Opción B | Qué depende |
|---|---|---|---|
| **¿"Comprar ya" en la ficha?** | Solo «Añadir al carrito» → carrito con complementos → checkout | «Comprar ya» (directo al checkout con ese producto) **además** de «Añadir al carrito» | A favorece la venta cruzada y el gasto; B ahorra 1–2 pasos pero puede saltarse los complementos. **Probarlo en una de las 4 pruebas** |
| **¿Complementos en el checkout?** | No: el checkout solo tiene datos y Pagar | Sí: una línea "Añade a tu pedido" con 2 complementos de un clic | B es otra oportunidad de venta cruzada, pero más ruido en el paso crítico |
| **¿Formulario de una página o "exprés"?** | 3 campos + Pagar en /checkout | Los 3 campos **en el propio carrito** + «Pagar» (el carrito y el checkout en una sola página) | B ahorra un paso; hay que comprobar que no confunde |
| **¿WebMCP?** | No | `toolname`/`tooldescription` en los formularios de buscar, añadir y pagar | Coste mínimo; beneficio dudoso con el evaluador |
| **¿`/.well-known/ucp` de demo?** | No | Sí, como extra para la presentación | Solo si sobra tiempo |

---

## 5. Fuentes
- AG-UI: https://docs.ag-ui.com/ · https://github.com/ag-ui-protocol/ag-ui · https://www.copilotkit.ai/blog/introducing-ag-ui-the-protocol-where-agents-meet-users
- ACP, Agentic Checkout Spec (OpenAI): https://developers.openai.com/commerce/specs/checkout · en producción: https://developers.openai.com/commerce/guides/production
- ACP, especificación (Stripe): https://docs.stripe.com/agentic-commerce/protocol/specification
- ACP, comentario sobre la versión 2026-04-17 e idempotencia (secundaria): https://vercel.com/i/agentic-commerce-protocol
- UCP, native checkout (Google): https://developers.google.com/merchant/ucp/guides/overview/native-checkout · API: https://developers.google.com/merchant/ucp/implementation/2026-04-08/native-checkout-api
- UCP en Shopify: https://shopify.dev/docs/agents/get-started/checkout · Salesforce: https://developer.salesforce.com/docs/commerce/b2c-commerce/guide/ucp-implementation-considerations.html
- Estados del checkout en Alexa+ (Amazon): https://developer.amazon.com/docs/alexaplus/add-ons/checkout-integration.html
- Shopify, checkout por MCP: https://shopify.dev/docs/agents/checkout/mcp
- WebMCP, API declarativa: https://developer.chrome.com/docs/ai/webmcp/declarative-api · API imperativa: https://developer.chrome.com/docs/ai/webmcp/imperative-api · intento de experimentar (blink-dev): https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8
- Google web.dev, Build agent-friendly websites: https://web.dev/articles/ai-agent-site-ux
