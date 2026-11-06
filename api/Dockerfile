# Build from the repository root: docker build -f api/Dockerfile .
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.9.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @weatherapp/shared build && pnpm --filter @weatherapp/api build
# Copies the api with only its production dependencies (shared included) into /prod.
RUN pnpm --filter @weatherapp/api deploy --legacy --prod /prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod .

USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
