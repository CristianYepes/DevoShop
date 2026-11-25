# Pinned Node LTS image; the app has no npm dependencies, so there is no install step.
# PostgreSQL runs in the same container, on 127.0.0.1 only (see docker-entrypoint.sh).
FROM node:22.22.0-alpine
RUN apk add --no-cache postgresql17 postgresql17-client \
 && mkdir -p /run/postgresql /var/lib/postgresql/data \
 && chown -R node:node /run/postgresql /var/lib/postgresql

ENV NODE_ENV=production \
    PGDATA=/var/lib/postgresql/data \
    PGHOST=127.0.0.1 \
    PGPORT=5432 \
    PGUSER=devoshop \
    PGDATABASE=devoshop \
    DATABASE_URL=postgres://devoshop@127.0.0.1:5432/devoshop

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node db/init.sql ./db/init.sql
COPY --chown=node:node --chmod=755 docker-entrypoint.sh ./
USER node
# Cloud Run sets PORT (8080); the server reads it.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
