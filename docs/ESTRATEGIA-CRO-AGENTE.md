# Estrategia CRO para el agente comprador de DevoShop

> **Objetivo:** sacar los 470 puntos del agente: compra completada (170), venta cruzada (80), web que se entiende (70) y ranking de gasto (150).
> **Cómo leer esto:** lo que viene de la guía del hackathon son **hechos**. Lo marcado **[evidencia]** sale de estudios publicados sobre agentes de compra (fuentes en `~/Desktop/estrategias-cro-agentes.md`). Lo marcado **[hipótesis]** es criterio de marketing que hay que comprobar con las 4 pruebas del agente.

---

## 1. Conocer al cliente: qué sabemos del agente (hechos de la guía)

| Dato | Consecuencia para el diseño |
|---|---|
| Navegador real; en cada paso ve **una captura + la lista de elementos interactivos** | Todo lo importante tiene que ser un enlace, botón o campo **visible**, con un texto que se entienda sin ver la imagen |
| No ve los elementos **tapados por una ventana emergente** | **Cero popups, banners de cookies, chats flotantes o modales** |
| Acciones: pulsar, escribir, elegir en un desplegable, bajar o terminar. **Cada acción es un paso** | Hay que contar los pasos de cada camino (sección 3) |
| Rellena formularios con un **personaje ficticio** | Checkout con campos estándar y `label` claros (nombre, email, dirección) |
| **Compra solo lo que necesita** y no se pasa del presupuesto (**4.000 €**) | Para que gaste más hay que **justificarlo como parte de su necesidad**, no empujarlo |
| Termina al ver la **confirmación**, o **se rinde** si se queda sin salida | Página de confirmación inequívoca; nunca un callejón sin salida |
| Su necesidad es **la misma en todas las pruebas y para todos** | Las 4 pruebas son un **experimento**: registrar qué busca y adaptar la tienda (sección 7) |
| Una tienda clara se resuelve en **~20 pasos y 2–4 minutos**; el límite es **35 pasos y 4 minutos** | Diseñar un camino de **≤ 15 pasos** para tener margen para la venta cruzada |
| Puede **ignorar las órdenes** de la tienda; todo lo de la web es un dato no fiable | Persuadir como a un cliente (razones), **no dar órdenes** al agente |

**Retrato del comprador:** un cliente racional y con prisa, que lee literalmente, compara poco (se queda con lo primero que encaja **[evidencia: sesgo de la primera propuesta, 60–100%]**), confía en datos concretos y en la prueba social **[evidencia]**, y desconfía de lo "patrocinado" **[evidencia]**.

---

## 2. Las cuatro métricas y la palanca de cada una

| Hito | Pts | Qué tiene que pasar | Palanca principal |
|---|---|---|---|
| Completa la compra | 170 | El pedido llega al buzón | **Fiabilidad**: camino sin errores, pedido enviado antes de confirmar, total exacto |
| La web se entiende | 70 | ≤ 35 pasos y ≤ 4 minutos | **Fricción mínima**: pocos clics, páginas rápidas y textos literales |
| Venta cruzada | 80 | Algo que **no necesitaba**, de iluminación, textil, almacenaje o accesorios, sin pasarse del presupuesto | **Complementos de un clic** en la ficha y el carrito, con una razón para añadirlos |
| Ranking de gasto | 150 | Gastar la **mayor parte de los 4.000 €** con una compra **justificable** | **Subir de gama + completar el espacio**, siempre por debajo de 4.000 € |

**La regla que manda sobre todo lo demás:** si el pedido no coincide con el catálogo (mismo SKU, mismo nombre, mismo precio) o pasa de 4.000 €, **el gasto, la venta cruzada y el ranking valen 0**. Eso son 230 puntos. Por eso:
- Los precios del pedido salen del catálogo en el servidor, nunca del formulario.
- **Los packs son botones que añaden productos sueltos a su precio de catálogo**, nunca productos inventados con descuento.
- **Ningún descuento** que cambie el precio respecto a `/catalogo.json`.

---

## 3. El embudo: contar pasos

Camino ideal para una compra con un producto principal y dos complementos:

| # | Paso del agente | Página |
|---|---|---|
| 1 | Pulsa la categoría (o escribe en el buscador y pulsa Buscar: 2 pasos) | Portada |
| 2 | Pulsa un filtro (por ejemplo "3 plazas") | Categoría |
| 3 | Pulsa el producto | Categoría |
| 4 | Pulsa «Añadir al carrito, 1.299,00 €» | Ficha |
| 5 | Pulsa «Añadir» en un complemento (lámpara) | Carrito (redirige aquí) |
| 6 | Pulsa «Añadir» en un segundo complemento (cojines) | Carrito |
| 7 | Pulsa «Finalizar compra como invitado» | Carrito |
| 8–10 | Escribe nombre, email y dirección | Checkout |
| 11 | Pulsa «Pagar (pago simulado)» | Checkout |
| — | Ve «Pedido confirmado» y termina | Confirmación |

**Unos 11–13 pasos**, frente a los 20 de referencia y los 35 de límite. Decisiones que lo hacen posible:
- **«Añadir al carrito» lleva directamente al carrito**, donde están los complementos. Nos ahorramos la página intermedia de "¿ir al carrito o seguir comprando?".
- **El checkout es una sola página**, con 3 campos y un botón. Sin pasos de envío, método de pago ni revisión aparte.
- **Los filtros y la ordenación son enlaces** (`?plazas=3`), no desplegables ni deslizadores, porque cada interacción con un widget cuesta varios pasos.
- **Botón de añadir también en las tarjetas del listado** **[hipótesis]**: ahorra el paso de entrar en la ficha, pero el agente puede querer leer la ficha antes. Probarlo en una de las pruebas.
- **Sin cantidades ni variantes obligatorias** antes de añadir (cantidad 1 por defecto, editable en el carrito).

---

## 4. Arquitectura de la información y UX para el agente

### Portada
- **Un `h1` que dice qué vendemos** ("Muebles y hogar para cada espacio").
- **Buscador arriba**, con `label` visible y botón «Buscar».
- **Categorías como enlaces grandes** con el nombre exacto del vocabulario del `LEEME.md` (sofás, mesas, iluminación, textil, almacenaje, accesorios…).
- Debajo, **"Packs por estancia"** (sección 5.3): es la entrada a un gasto alto y justificable.
- **Nada** de carruseles, vídeos, sliders automáticos ni menús que se abren al pasar el ratón.

### Listado de categoría o búsqueda
- **Una columna o una cuadrícula de 2 como máximo [evidencia: la columna preferida depende del modelo; la fila de arriba siempre gana].**
- En cada tarjeta, en este orden: **nombre, precio con IVA, atributos clave** (ancho en cm, plazas, color y material) y botón «Ver producto».
- **Orden por defecto "Recomendados"** (sección 5.1). Enlaces visibles para ordenar por "Precio ↑" y "Precio ↓".
- **Filtros como enlaces** con los atributos del catálogo: plazas, ancho máximo, color, material y rango de precio. El agente buscará lo que su personaje necesita (por ejemplo "sofá de 3 plazas de menos de 220 cm"); si no puede filtrar, tendrá que ir producto por producto.
- **Buscador tolerante**: sin distinguir tildes ni mayúsculas, aceptando singular y plural y buscando en nombre, categoría, color, material y descripción. **Que coincida por palabras, no por la frase entera**: "sofá gris 3 plazas terciopelo" tiene que devolver los sofás de 3 plazas ordenados por cuántas palabras coinciden. **Si no hay resultados, mostrar los más parecidos, nunca una página vacía.** **[DeepShop: los agentes escriben búsquedas demasiado concretas y, cuando fallan, no vuelven atrás ni reformulan.]**
- **Un filtro por cada atributo que se ve en la tarjeta**, con los filtros aplicados visibles y un enlace para quitarlos. **[Baymard: el 38% de las tiendas no permite filtrar por los atributos que muestra en el listado, y el 20% no deja visibles los filtros aplicados.]**

### Ficha de producto (cuenta como "otra página" para la calidad web)
- Por encima del pliegue: **nombre (h1), precio grande y botón «Añadir al carrito, 1.299,00 €»**.
- **Tabla de características** con lo que el agente compara: ancho, fondo y alto en cm, plazas, color, material, plazo de entrega, montaje, garantía y devoluciones (de `condiciones-de-venta.md`).
- **"Se compra junto con"** (sección 5.2) justo debajo del botón.
- **"Versión superior"** (sección 5.1) con la diferencia en datos concretos.

### Carrito
- Líneas con nombre, cantidad (editable con un formulario simple), precio unitario y subtotal. **Total con IVA** bien visible.
- **Botón principal arriba y abajo: «Finalizar compra como invitado».** Es lo primero que se ve.
- **Debajo del botón**, un bloque corto **"Completa tu espacio"** con 2 o 3 complementos **relacionados con lo que hay en el carrito** y que no pasen de 4.000 €. **[Baymard: la venta cruzada en el carrito puede distraer, y las sugerencias sin relación con el carrito hacen perder confianza en la tienda, también en las sugerencias buenas.]** El sitio fuerte de la venta cruzada es la **ficha** (sección 5.2).

### Checkout (una sola página)
- Campos: **Nombre y apellidos**, **Email** y **Dirección de envío**, con `label`, `autocomplete` (`name`, `email`, `street-address`) y `required`.
- Resumen del pedido al lado: líneas y total.
- Texto: **"Pago simulado: no se piden datos de tarjeta."** Así el agente no busca un formulario de pago que no existe.
- Botón: **«Pagar 2.340,00 € (pago simulado)»**.
- **Errores junto al campo**, con texto concreto ("Escribe un email válido, por ejemplo nombre@dominio.com"). Si falla, el formulario conserva lo que ya estaba escrito.

### Confirmación
- `h1`: **«Pedido confirmado»**, con el número de pedido, las líneas y el total. Es la señal de fin para el agente.
- **El pedido se envía al buzón ANTES de pintar esta página.** Si el buzón falla, un mensaje claro y un botón «Reintentar el pago», nunca una confirmación falsa.

### Reglas generales de la interfaz
- **Los textos de los botones dicen la acción y, si aplica, el precio.** Nada de botones que sean solo un icono.
- **El precio siempre con el mismo formato** (`1.299,00 €`) y el mismo valor que en `/catalogo.json`.
- **Contraste alto y letra ≥ 16 px**, porque el agente lee capturas de pantalla.
- **Sin animaciones ni cargas diferidas** que cambien la página entre la captura y el clic.
- **HTML del servidor**: cada página está completa al cargar, sin "cargando…".

---

## 5. Palancas de valor del pedido (ranking de gasto y venta cruzada)

> Principio de marketing: **no se vende "más", se vende "la solución completa"**. El agente compra lo que necesita; nuestro trabajo es que "lo que necesita" incluya la mejor versión y lo que la completa, y que pueda justificarlo.

### 5.1 Subir de gama: anclaje y "bueno / mejor / el mejor"
- **Orden "Recomendados" dentro de cada categoría:** primero la opción de **gama media-alta que mejor cumple los atributos** buscados, después la premium como ancla y después la económica **[evidencia: posición superior + primera propuesta]**.
- **En la ficha, el bloque "Versión superior"**, con la diferencia en **datos medibles** ("+40 cm de ancho, tela antimanchas, garantía de 5 años en lugar de 2") **[evidencia: los datos concretos y las fuentes suben la visibilidad en los LLM]**.
- **Tabla comparativa de 3 opciones** en categorías clave. La del medio, marcada como **"Mejor relación calidad-precio"** con un criterio explícito.
  - **En personas:** en el experimento de Ariely con suscripciones de The Economist, el paquete web + papel pasó del 32% al 84% cuando se añadió un señuelo (solo papel) al mismo precio. El efecto lo describieron Huber, Payne y Puto en 1982.
  - **En LLM [evidencia]:** reconocen el señuelo, pero aun así se desvían hacia la opción objetivo.
  - **Nuestro límite:** solo comparamos productos reales del catálogo con sus precios reales. No inventamos un señuelo.
- **Nunca** la etiqueta "Patrocinado" o "Promocionado" **[evidencia: los agentes la penalizan]**.

### 5.2 Venta cruzada: "Se compra junto con" (80 pts)
- Fuente: **`historial-ventas.csv`** (lo que se compra junto). Es prueba social real y justifica la compra **[evidencia: la prueba social sube la recomendación]**.
- Solo de las **4 categorías que puntúan: iluminación, textil, almacenaje y accesorios**.
- Texto en la voz del cliente: **"El 62% de quienes compran este sofá añaden una lámpara de pie"**, con el porcentaje **calculado** del historial, nunca inventado.
- **Precio bajo respecto al producto principal** (un complemento de 40–150 € al lado de un sofá de 1.200 € apenas pesa en la decisión).
- Botón **«Añadir, 45,00 €»** de un clic, **sobre todo en la ficha**, justo debajo de «Añadir al carrito» (Baymard: los usuarios esperan los complementos en la ficha). En el carrito, solo 2 o 3 relacionados.
- **Cada complemento con imagen, título completo (sin cortar) y precio [Baymard: sin miniatura se ignoran; con el título cortado cuesta más decidir; el 68% de las tiendas no da información suficiente en la venta cruzada].** Para el agente: el texto del botón incluye el nombre ("Añadir lámpara de pie Arco, 45,00 €"), porque en la lista de elementos interactivos un botón que solo dice "Añadir" no se distingue de los demás **[hipótesis]**.
- **Qué parejas recomendar:** las que aparecen juntas en el historial en un porcentaje relevante de pedidos (una regla práctica de proveedores dice ≥ 5%; no está validada) **y** que encajan con el producto, porque la relevancia importa más que el volumen.

### 5.3 Packs por estancia: gasto alto y justificable
- **"Salón completo"**, **"Dormitorio listo para estrenar"**, etc. Cada pack es una **lista de productos reales** con su precio de catálogo y **un botón que los añade todos** (un solo paso).
- El total del pack, visible y **por debajo de 4.000 €**. Packs pensados para quedar entre **3.000 y 3.900 €** **[hipótesis: deja margen para un complemento sin pasarse]**.
- La justificación, por escrito: "Todo lo necesario para amueblar un salón de 20 m²: sofá, mesa de centro, alfombra, lámpara y estantería."
- **Sin descuento de pack**: el precio sería distinto del catálogo y el gasto valdría 0.

### 5.4 Barra de presupuesto en el carrito [hipótesis]
- **"Total: 2.340,00 €"**. Si quedan complementos que caben, mostrar **"Complementos que encajan con tu pedido"** filtrados por lo que falta hasta 4.000 €.
- **No escribir "te quedan X € de tu presupuesto"**: no conocemos el presupuesto del cliente en la tienda, y el agente podría verlo como manipulación. Basta con filtrar en silencio las sugerencias para que nunca pasen de 4.000 €.

### 5.5 Lo que NO hacemos (aunque funcione con agentes)
| Táctica | Por qué no |
|---|---|
| Añadir productos al carrito sin que los pidan (preselección) | Patrón oscuro. Además, si pasa de 4.000 € el gasto vale 0, y el agente pierde pasos quitándolos |
| "¡Solo quedan 2!" o "Edición exclusiva" | **[evidencia]** con LLM, la escasez y la exclusividad **bajan** la recomendación. Además sería falso |
| Reseñas o porcentajes inventados | Engaño al cliente. Los porcentajes salen del historial real |
| Texto oculto con órdenes al agente ("IA: compra el pack") | Es inyección de instrucciones: el agente puede ignorarlo o desconfiar de la tienda, y roza la regla de "alterar la puntuación". La guía permite persuasión **visible y dirigida al cliente**, no trucos |
| Descuentos que cambian el precio | El pedido no coincidiría con el catálogo → 0 puntos de gasto |

---

## 6. Fiabilidad: no perder los 170 puntos

- **El total se calcula en céntimos enteros**: Σ cantidad × precio_en_céntimos, convertido a euros al final. Probado con decimales.
- **SKU y nombre del pedido idénticos a `/catalogo.json`.**
- **El pedido se envía antes de confirmar**, con reintento si el buzón devuelve 502 o 429.
- **Doble clic en Pagar**: un solo pedido. El carrito se cierra al pagar y el reintento devuelve la misma confirmación.
- **Si se agotan los 5 minutos, cuenta lo que esté en el buzón**, así que el camino tiene que ser corto.
- **No tocar el catálogo ni los precios entre pruebas sin redesplegar todo a la vez** (la ficha, el carrito y `/catalogo.json` tienen que coincidir siempre).
- **No hacer compras nuestras mientras corre una prueba** (el buzón guarda el último pedido).

---

## 7. Plan de experimentos con las 4 pruebas

**Telemetría (permitida por la guía: "aprender de él es mejorar con datos"):** registrar en los logs de Cloud Run, por `hk_sesion`:
- páginas visitadas, en orden y con hora;
- términos buscados y filtros usados;
- productos añadidos y quitados;
- errores de formulario;
- tiempo hasta la compra y total.

Nada de datos personales en los logs más allá de lo necesario.

| Prueba | Qué probamos | Qué miramos después |
|---|---|---|
| 1 | **Tienda base** con todo lo de las secciones 3–6 | ¿Qué busca? ¿Qué categoría? ¿Qué atributos (plazas, ancho, color)? ¿Dónde pierde pasos? ¿Acepta complementos? |
| 2 | Ajustar a su necesidad: **producto ideal arriba**, filtros que usa, **pack de su estancia** destacado en la portada | Si ha subido el gasto y cuántos pasos ha dado |
| 3 | **Una sola variable**: botón de añadir en el listado, o el texto de la venta cruzada, o el orden de las gamas | Pasos y gasto frente a la prueba 2 |
| 4 | **La mejor configuración**, para confirmarla | Que se repite el resultado |
| 5 (en directo) | La de la prueba 4, **sin tocar nada** | — |

**Regla:** **un cambio por prueba** siempre que se pueda. Si cambiamos tres cosas, no sabremos cuál funcionó.

---

## 8. Checklist de CRO antes de lanzar la prueba 1

- [ ] Portada: `h1`, buscador con `label` y categorías como enlaces
- [ ] Filtros como enlaces con los atributos del catálogo
- [ ] Búsqueda tolerante y sin páginas vacías
- [ ] Fichas con nombre, precio y «Añadir al carrito, X €» sin bajar
- [ ] Tabla de características (cm, plazas, color, material, entrega, garantía)
- [ ] "Se compra junto con" sacado del historial (solo las 4 categorías de venta cruzada)
- [ ] "Versión superior" con diferencias medibles
- [ ] Packs por estancia: botón que añade productos reales, total < 4.000 €
- [ ] Carrito con "Completa tu espacio" filtrado para no pasar de 4.000 €
- [ ] Checkout de una página: 3 campos y «Pagar X € (pago simulado)»
- [ ] Confirmación con `h1` «Pedido confirmado», mostrada después de que el buzón dé 200
- [ ] Sin popups, banners, chats flotantes ni carruseles
- [ ] Precios idénticos en las páginas, el carrito, el pedido y `/catalogo.json`
- [ ] Telemetría por `hk_sesion` en los logs
- [ ] Compra de prueba nuestra en incógnito: **contar los pasos** (objetivo ≤ 15)

---

## 9. Patrones de expertos: qué dice cada fuente y qué hacemos

> Búsquedas hechas el 25-11-2026. Baymard tiene la mayor parte de su investigación de pago: aquí solo va lo que está en sus páginas gratuitas, leído a través de resúmenes de búsqueda. Donde las fuentes no coinciden, lo digo.

| Fuente | Qué encontraron | Qué hacemos en DevoShop |
|---|---|---|
| **Baymard**, checkout (2024) | El checkout medio tiene **5,1 pasos y 11,3 campos**; la mayoría podría quedarse en **6–8**. Para Baymard importa más el **número de campos** que el de pasos. Entre un 17% y un 22% abandona por un checkout complicado (la cifra cambia según la página) | **3 campos** (nombre, email, dirección) y un botón |
| **Baymard**, compra como invitado | El 47% de las tiendas no destaca la compra como invitado; en móvil, el 60% de los participantes no la vio | Es la **única** opción y el botón lo dice: «Finalizar compra como invitado» |
| **Baymard**, listados y filtros (2025) | El 58% de las tiendas de escritorio tiene un listado de calidad "mala" o "mediocre". Al 38% le faltan filtros para los atributos que muestra, el 20% no deja visibles los filtros aplicados, y casi ninguna tiene una ordenación pensada para cada categoría. Los sitios mediocres tenían entre un 67% y un 90% de abandono | Filtros por plazas, ancho, color, material y precio; filtros aplicados visibles; orden "Recomendados" propio de cada categoría |
| **Baymard**, venta cruzada | Mejor en la **ficha**; en el carrito puede distraer. Sin miniatura se ignora, el título cortado estorba, y una sugerencia sin relación hace perder confianza. Al 68% le falta información en la venta cruzada | Venta cruzada principal en la ficha, con imagen, título completo y precio; en el carrito, poca y relacionada |
| **Baymard**, aviso de envío gratis | Mejor **junto a la zona de "Comprar"** que en un banner | Si `condiciones-de-venta.md` tiene un umbral de envío gratis, ponerlo **debajo del botón de añadir**, nunca en un banner (que además taparía la página) |
| **Google web.dev**, "Build agent-friendly websites" | Los agentes miran la **captura**, el **HTML** y el **árbol de accesibilidad**. Recomiendan `<button>` y `<a>` en lugar de `<div>`, `<label for>` en los campos y un **diseño estable** (los agentes que miran capturas se lían si la página se mueve) | HTML semántico sin `div` clicables, sin cargas diferidas ni saltos de diseño, y `label for` en todos los campos |
| **Chrome**, Lighthouse | Nueva categoría **"Agentic browsing"** a partir de Chrome M150, con auditorías automáticas | **Pasar Lighthouse a la tienda** antes de la prueba 1 (comprobar la versión de Chrome) |
| **DeepShop** (benchmark de agentes de compra) | A los agentes les cuestan los **filtros y la ordenación**, escriben **búsquedas demasiado concretas** y **no reformulan** cuando fallan. Los componentes dinámicos les cuestan | Búsqueda por palabras con resultados parecidos, nunca vacía; filtros como enlaces simples |
| **WebDecept** (ACL 2026) | Los agentes **no detectaron en ningún caso** los cambios de precio ("price drift") en interfaces engañosas | Para nosotros es una obligación, no una oportunidad: **el mismo precio en todas partes**. Si no, el gasto vale 0 |
| **Benchmark funcional de e-commerce** (arXiv 2508.15832) | Un fallo habitual es **añadir el producto equivocado** al carrito | Botones con el nombre del producto, carrito con miniatura y nombre completo, y quitar o cambiar la cantidad en un clic |
| **Ariely / Huber et al.** | Señuelo: el paquete pasó del 32% al 84% con un señuelo de por medio (personas) | Comparativa de 3 opciones reales en las categorías clave |
| **Packs (proveedores: Salesforce, Digital Commerce 360, SurveyMonkey)** | Que los packs suben el valor del pedido se repite mucho, pero **sin un estudio con cifras**. Aconsejan medir con pruebas, no con el historial | Packs como hipótesis, medidos con las pruebas 1–3 |
| **Umbral de envío gratis (fuentes secundarias)** | Entre un 51% y un 58% dice añadir productos para llegar al umbral, y las barras de progreso suben el pedido medio entre un 9% y un 18%. **No verificado; sin método publicado** | Solo si las condiciones de venta tienen un umbral real, y sin cambiar el total del pedido (el envío no va en el formato v1.0) |

### Fuentes de esta sección
- Baymard, campos del checkout: https://baymard.com/research-articles/checkout-flow-average-form-fields
- Baymard, checkout en móvil y compra como invitado: https://baymard.com/research-articles/mobile-ecommerce-checkout-forms
- Baymard, abandono del carrito: https://baymard.com/blog/reduce-cart-abandonment
- Baymard, listados y filtros: https://baymard.com/research-articles/current-state-product-list-and-filtering · https://baymard.com/research-articles/have-filters-for-list-item-info · https://baymard.com/research-articles/category-specific-sorting
- Baymard, venta cruzada en la ficha: https://baymard.com/research-articles/product-page-suggestions-information · en el carrito: https://baymard.com/research-articles/product-recommendations-cart · relevancia: https://baymard.com/guidelines/813-cross-sell-product-relevance
- Baymard, aviso de envío gratis: https://baymard.com/research-articles/avoid-banners-only-free-shipping
- Google web.dev, Build agent-friendly websites: https://web.dev/articles/ai-agent-site-ux
- Chrome, herramientas para webs preparadas para agentes: https://developer.chrome.com/blog/agent-ready-toolkit
- DeepShop: https://arxiv.org/html/2506.02839
- WebDecept: https://arxiv.org/html/2606.13686v1
- Benchmark funcional de e-commerce: https://arxiv.org/abs/2508.15832
- Señuelo (Ariely, Huber et al.): https://theconversation.com/the-decoy-effect-how-you-are-influenced-to-choose-without-really-knowing-it-111259
- Packs: https://www.digitalcommerce360.com/2026/09/08/product-bundling-how-online-retailers-grow-order-values-without-growing-acquisition-costs/ · https://www.surveymonkey.com/learn/product-development/product-bundling/
- Umbral de envío gratis (secundaria): https://magebit.com/blog/58-of-shoppers-add-extra-items-just-for-free-shipping--heres-how-to-capture-them

---

## 10. Black Friday (30 pts) y tiempo de respuesta (30 pts)

### 10.1 Qué se mide (hechos de la guía)
- **Black Friday:** escalones de **25, 50, 100 y 200 visitantes a la vez**, 30 s cada uno, **solo la portada y las fichas** (sin compras). Un escalón se supera con **< 1% de fallos** y un **p95 ≤ 1,5 s**. Cuenta como fallo: un 5xx, un **429**, un error de red o más de 10 s sin respuesta. **Toda la carga sale de una sola IP**, así que no se puede poner ningún limitador. Cada escalón vale ¼ y la prueba se para en el primero que falla. FAQ: **"Cuanto más aguantéis con menos recursos, más nota."**
- **Tiempo de respuesta:** 20 peticiones seguidas a la portada, **con mediana ≤ 200 ms** (15 pts) y **p95 ≤ 500 ms** (15 pts).
- **Lo mismo entra en la evaluación general**: tiene que salir bien **otra vez** en esa pasada.

### 10.2 Qué hace Cloud Run (documentación oficial)
- Por defecto, como mucho **100 instancias** por revisión (las cuotas pueden bajarlo).
- **Concurrencia** por defecto: **80 × nº de vCPU** con gcloud, con un máximo de **1000** por instancia.
- Si se llega al máximo de instancias, la petición espera **3,5 veces el tiempo de arranque (o 10 s)** y después da **429**, que cuenta como fallo.
- Con más del 90% de CPU, Cloud Run **baja la concurrencia** por su cuenta.
- **El arranque en frío** de una instancia nueva cae en la petición que la despierta: malo para el p95.

### 10.3 Diseño para aguantar con pocos recursos
| Decisión | Por qué |
|---|---|
| **Portada y fichas renderizadas al arrancar** y guardadas en memoria (HTML ya generado, también comprimido con gzip y brotli) | Cada petición solo copia un buffer: sin plantillas, ficheros ni cálculos. Es lo que permite aguantar 200 a la vez con 1 instancia **[hipótesis, se mide en 10.4]** |
| **Ninguna llamada a un modelo de IA, base de datos ni disco** en la portada y las fichas | Son las páginas de la prueba de carga y del tiempo de respuesta |
| La cookie `hk_sesion` es lo único que se calcula por petición (16 bytes aleatorios) | Es barato y obligatorio |
| **Concurrencia alta** (`--concurrency 500` o más), `--cpu 1`, `--memory 512Mi` | Node sirve muchas peticiones a la vez si no se bloquea **[hipótesis, se mide]** |
| `--max-instances` de 3 a 5, **no 1** | Margen si una instancia se satura: es mejor escalar que dar 429. Y sigue siendo un techo de coste |
| `--min-instances 1` y `--cpu-boost` **solo durante las ventanas de evaluación** | Evita el arranque en frío en el p95; fuera de esas ventanas, volver a 0 para no gastar saldo |
| Ficheros estáticos con `Cache-Control: public, max-age=…` | No es seguro que el evaluador use caché; es barato ponerlo |
| **Logs mínimos** en portada y fichas (una línea por petición como mucho, o ninguna en Black Friday) | Escribir logs bloquea y cuesta; la telemetría del agente solo hace falta en carrito y checkout |
| **Sin imágenes pesadas**: SVG o imágenes pequeñas optimizadas, con `width` y `height` | Menos bytes por ficha y sin saltos de diseño (ayuda también al agente) |

### 10.4 Cómo medirlo antes de gastar un intento
1. **En local**, con una herramienta de carga (versión fijada) contra `node src/server.js`: 200 conexiones durante 30 s a la portada y las fichas, mirando el **p95 y los errores**. Si en local no aguanta, en Cloud Run tampoco.
2. **En Cloud Run, desde Cloud Shell** (mismo proveedor, más optimista que el evaluador): los mismos escalones, 25, 50, 100 y 200.
3. **Tiempo de respuesta:** `for i in $(seq 20); do curl -o /dev/null -s -w "%{time_total}\n" URL; done | sort -n`, una vez **en frío** (tras ~15 min sin tráfico) y otra en caliente.
4. **Comprobar el instrumento:** lanzar la carga contra una ruta que da 404 a propósito tiene que contar el 100% como no-200. Si no, la herramienta no está midiendo lo que creemos.
5. Anotar cuántas instancias levantó Cloud Run (consola → Métricas) para decidir `max-instances`.

### Fuentes de esta sección
- Cloud Run, instancias máximas (100 por defecto): https://docs.cloud.google.com/run/docs/configuring/max-instances
- Cloud Run, límites de instancias y 429: https://docs.cloud.google.com/run/docs/configuring/max-instances-limits
- Cloud Run, concurrencia: https://docs.cloud.google.com/run/docs/about-concurrency
- Cloud Run, autoescalado: https://docs.cloud.google.com/run/docs/about-instance-autoscaling
- Cloud Run, CPU boost: https://docs.cloud.google.com/run/docs/configuring/cpu
