# Pinned Node LTS image; the app has no npm dependencies, so there is no install step.
FROM node:22.22.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
# Cloud Run sets PORT (8080); the server reads it.
CMD ["node", "src/server.js"]
