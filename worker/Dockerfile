# Build from the repository root: docker build -f worker/Dockerfile .
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.9.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @weatherapp/shared build && pnpm --filter @weatherapp/worker build
# Copies the worker with only its production dependencies (shared included) into /prod.
RUN pnpm --filter @weatherapp/worker deploy --legacy --prod /prod

FROM node:24-bookworm-slim
# Fonts for drawing the weather text onto the images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod .

USER node
CMD ["node", "dist/index.js"]
