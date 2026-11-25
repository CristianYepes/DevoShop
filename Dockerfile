# DevoShop, Go server. Two stages: build a static binary, then run it on a distroless image
# that holds nothing else (no shell, no package manager, no source). The supplier data and
# public/ are embedded in the binary (assets.go), so there are no loose files to leak.
# The previous Node.js + in-container PostgreSQL image is kept as Dockerfile.node.
FROM golang:1.26.11-alpine3.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY assets.go ./
COPY cmd ./cmd
COPY internal ./internal
COPY public ./public
COPY db/data/proveedor-a.csv db/data/proveedor-b.json db/data/historial-ventas.csv ./db/data/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /devoshop ./cmd/devoshop

# distroless/static ships CA certificates (HTTPS to the order mailbox) and runs as non-root.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /devoshop /devoshop
USER nonroot:nonroot
# Cloud Run sets PORT (8080); the server reads it.
EXPOSE 8080
ENTRYPOINT ["/devoshop"]
