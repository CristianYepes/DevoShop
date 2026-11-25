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

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP de escucha |
| `GEMINI_API_KEY` | *(vacía)* | Clave de Gemini API. Si se omite, usa el motor determinista local |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | Modelo rápido recomendado para mantener la mediana `<= 3 s` |
| `CATALOG_PATH` | `data/catalogo.json` | Ruta local al catálogo JSON |
| `CATALOG_URL` | *(vacía)* | URL remota opcional del catálogo (con respaldo en `CATALOG_PATH`) |
| `CONDITIONS_PATH` | `data/condiciones-de-venta.md` | Ruta local a las condiciones de venta en Markdown |
| `CONDITIONS_URL` | *(vacía)* | URL remota opcional de condiciones (con respaldo en `CONDITIONS_PATH`) |
| `DATA_REFRESH_SECONDS` | `0` | Segundos para recarga periódica si se usan URLs (`0` = solo al arrancar) |
| `LLM_TIMEOUT_MS` | `4500` | Timeout máximo en milisegundos para la llamada a Gemini |
| `CACHE_TTL_SECONDS` | `300` | TTL de la caché en memoria por pregunta normalizada |

## Ejecución local

```bash
cd asistente
go test ./...
GEMINI_API_KEY="tu_clave" go run ./cmd/asistente
```

Prueba rápida en Bash / WSL:

```bash
curl -s -w "\nHTTP: %{http_code} | Tiempo: %{time_total}s\n" \
  -X POST http://localhost:8080/api/asistente \
  -H 'content-type: application/json' \
  -d '{"pregunta":"¿Cuánto cuesta el envío?"}'
```

Prueba rápida en PowerShell (Windows):

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/api/asistente" `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes('{"pregunta":"¿Cuánto cuesta el envío?"}'))
```

## Contenedor Docker

```bash
cd asistente
docker build -t devoshop-asistente .
docker run --rm -p 8080:8080 \
  -e GEMINI_API_KEY="tu_clave" \
  devoshop-asistente
```

Para comprobar los logs del contenedor y confirmar el número de productos cargados y si Gemini está activo:

```bash
docker logs <id_o_nombre_contenedor>
```

## Despliegue en Google Cloud Run (`europe-southwest1`)

1. Despliega el contenedor Go **desde la carpeta `asistente/`** (si ejecutas `gcloud run deploy` desde la raíz del repo, se desplegará el servidor Node.js, no el asistente en Go):

```bash
cd asistente
gcloud run deploy devoshop-asistente \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest"
```

*(Opcional: añade `--set-env-vars CATALOG_URL=https://TU_TIENDA.run.app/catalogo.json` si quieres que lea el catálogo remoto en lugar del fichero empaquetado en `asistente/data/catalogo.json`).*

2. Conecta el servicio principal `devoshop` a la `Service URL` devuelta en el paso anterior:

```bash
gcloud run services update devoshop \
  --region europe-southwest1 \
  --update-env-vars="ASISTENTE_URL=https://TU_ASISTENTE_URL.run.app"
```

3. Verifica la respuesta final a través de la URL pública de la tienda:

```bash
curl -s -w "\nHTTP: %{http_code} | Tiempo: %{time_total}s\n" \
  -X POST https://TU_TIENDA.run.app/api/asistente \
  -H "content-type: application/json" \
  -d '{"pregunta":"¿Cuánto cuesta el envío?"}'
```
