FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev --include=optional
COPY . .
RUN npm run build:render \
    && mkdir -p /var/data \
    && chown node:node /var/data

ENV NODE_ENV=production \
    PORT=3000 \
    SQLITE_PATH=/var/data/argo.sqlite
USER node
EXPOSE 3000
CMD ["node", "scripts/start-node.mjs"]
