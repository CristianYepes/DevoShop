# DevoShop

An online furniture and home store built from scratch during the **Devo Team hackathon** (25 November 2026). It runs on **Google Cloud Run** and is designed so that an **AI shopping agent** can browse it and complete a purchase on its own.

> **Status:** work in progress. This README describes the target design; sections are updated as each part is built.

## Ground rules

- **Guest checkout only:** no user accounts, no sign-up, no email verification, no "Sign in with Google".
- **No CAPTCHA.**
- **Simulated payment:** a single "Pay" button. The store never asks anyone, human or agent, for real payment details.
- **No rate limiting:** the load test comes from a single IP address, and any `429` response counts as a failure.

## Features

| Route | Description |
|---|---|
| `GET /` | Home page. On the first visit it sets the `hk_sesion` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`) |
| `GET /catalogo.json` | Clean product catalog, merged from the two supplier files (prices include 21% VAT, in EUR, dimensions in cm) |
| `POST /api/asistente` | Shop assistant. Receives `{"pregunta": "..."}` and returns `{"respuesta": "..."}`. It only talks about the store and refuses requests that try to take it out of that role |
| Product, cart and checkout pages | Short guest checkout flow, with no pop-ups covering the page |

When an order is completed, the **server** sends it to the hackathon order mailbox in the v1.0 JSON format **before** the confirmation page is shown.

## Catalog rules

- A product listed by both suppliers is sold only once, using the most recent update.
- Discontinued products are not sold.
- Prices are shown in EUR with VAT (21%) included.
- Dimensions are in centimeters.

## Security

- Headers on every response: `Strict-Transport-Security` (max-age ≥ 1 year), `X-Content-Type-Options: nosniff`, and a `Content-Security-Policy` without `unsafe-inline` or `unsafe-eval`.
- No framework or server version in response headers.
- Error pages without stack traces or internal paths.
- No internal files exposed (config, source, backups, order or customer lists).
- **Secrets never go into the repository.** The team key is read from the `CLAVE_EQUIPO` environment variable, and `.env` is git-ignored.

## Configuration

| Variable | Description |
|---|---|
| `PORT` | Port to listen on (Cloud Run sets it to `8080`) |
| `CLAVE_EQUIPO` | Team key for the order mailbox. Set it in Cloud Run and never commit it |

## Deploy

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# Store the team key in Secret Manager (paste it when prompted, so it never lands in shell history)
gcloud services enable secretmanager.googleapis.com
read -s CLAVE && printf '%s' "$CLAVE" | gcloud secrets create clave-equipo --data-file=- && unset CLAVE

gcloud run deploy devoshop --source . --region europe-southwest1 \
  --allow-unauthenticated --set-secrets CLAVE_EQUIPO=clave-equipo:latest
```

The Cloud Run service account needs the `roles/secretmanager.secretAccessor` role on the `clave-equipo` secret.

Check that the store is public (it should return `200`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR_URL
```

## Team

Built by the DevoShop team at the Devo Team hackathon, using AI-assisted development.
