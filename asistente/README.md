# DevoShop Asistente (Microservicio en Go)

Microservicio independiente en Go (sin dependencias externas) para el endpoint `POST /api/asistente` de **DevoShop**, diseñado para cumplir los logros **IA (120)** y **El asistente resiste la inyección (30)** con latencia baja (< 3 s).

## Qué incluye

- `POST /api/asistente`: recibe `{"pregunta": "..."}` y devuelve `{"respuesta": "..."}` con HTTP `200`.
- `GET /healthz`: comprobación de salud (`{"status":"ok"}`).
- `GET /` y `GET /static/*`: interfaz web ligera y accesible (sin scripts ni estilos inline) para que los clientes puedan consultar al asistente desde el navegador.
- **Carga dinámica** de catálogo (`CATALOG_URL` / `CATALOG_PATH`) y condiciones de venta (`CONDITIONS_URL` / `CONDITIONS_PATH`) al arrancar, con refresco opcional por intervalo (`DATA_REFRESH_SECONDS`).
- **Motor híbrido**:
  - Usa **Gemini (`gemini-2.5-flash-lite`)** con `thinkingBudget: 0` y `temperature: 0` para respuestas rápidas (< 1-2 s) y basadas estrictamente en el catálogo y `condiciones-de-venta.md`.
  - Si no hay `GEMINI_API_KEY` o la API externa falla/supera el timeout (`LLM_TIMEOUT_MS`), usa un **motor determinista local** en Go.
  - **Caché en memoria** con TTL para responder preguntas repetidas en < 1 ms.
- **Garantías por código** (no solo por prompt):
  - Máximo **4 precios** por respuesta.
  - Longitud estricta **< 1.500 caracteres** (máximo 1.450).
  - Filtro de **inyección de prompt** y peticiones fuera de dominio.
  - Cabeceras de seguridad (`HSTS`, `X-Content-Type-Options: nosniff`, `CSP` estricta sin `unsafe-inline`/`unsafe-eval`, `Referrer-Policy`).

## Datos (`catalogo.json` y `condiciones-de-venta.md`)

En `asistente/data/` hay ficheros de ejemplo (`catalogo.json` y `condiciones-de-venta.md`). Antes de desplegar a producción:

1. Sustituye `asistente/data/condiciones-de-venta.md` por el fichero real del paquete del hackathon (o configura `CONDITIONS_URL` / `CONDITIONS_PATH`).
2. Sustituye `asistente/data/catalogo.json` por el catálogo limpio real, o apunta `CATALOG_URL` a `https://TU_TIENDA.run.app/catalogo.json`.

## Ejecución local

```bash
cd asistente
go test ./...
GEMINI_API_KEY="tu_clave" go run ./cmd/asistente
```

Prueba rápida:

```bash
curl -s -X POST http://localhost:8080/api/asistente \
  -H 'content-type: application/json' \
  -d '{"pregunta":"¿Cuánto cuesta el envío?"}'
```

## Contenedor Docker

```bash
cd asistente
docker build -t devoshop-asistente .
docker run --rm -p 8080:8080 \
  -e GEMINI_API_KEY="tu_clave" \
  devoshop-asistente
```

## Despliegue en Google Cloud Run (`europe-southwest1`)

```bash
cd asistente
gcloud run deploy devoshop-asistente \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars CATALOG_URL=https://TU_TIENDA.run.app/catalogo.json
```

> **Integración con el servidor base (`src/server.js`):** si la tienda principal corre en otro servicio de Cloud Run, puedes reenviar `POST /api/asistente` desde `src/server.js` hacia la URL de `devoshop-asistente` (por ejemplo leyendo `ASISTENTE_URL` desde variable de entorno) manteniendo una única URL pública para el portal del hackathon.
