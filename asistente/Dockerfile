# syntax=docker/dockerfile:1

FROM golang:1.23-alpine AS builder

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/asistente ./cmd/asistente

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=builder /out/asistente /app/asistente
COPY --from=builder /src/data /app/data

ENV PORT=8080 \
    CATALOG_PATH=/app/data/catalogo.json \
    CONDITIONS_PATH=/app/data/condiciones-de-venta.md \
    GEMINI_MODEL=gemini-2.5-flash-lite \
    LLM_TIMEOUT_MS=4500 \
    CACHE_TTL_SECONDS=300

EXPOSE 8080

USER nonroot:nonroot

ENTRYPOINT ["/app/asistente"]
