# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/admin-panel/package.json packages/admin-panel/package.json
COPY packages/demo-bff/package.json packages/demo-bff/package.json
COPY packages/demo-web/package.json packages/demo-web/package.json
COPY packages/docs/package.json packages/docs/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/ddl-schema/package.json packages/shared/ddl-schema/package.json
COPY packages/shared/openapi/package.json packages/shared/openapi/package.json
COPY packages/skill-evals/package.json packages/skill-evals/package.json
# Every workspace package.json is copied because `--frozen-lockfile` validates the lockfile against
# the whole workspace and fails on a missing importer, but only this package is installed.
RUN pnpm install --frozen-lockfile --filter @tsh/demo-bff...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/demo-bff ./packages/demo-bff
RUN pnpm --filter @tsh/demo-bff build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache curl
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
# The personas ship inside the image; PERSONAS_DIR points at them.
COPY --from=build /app /app
RUN chown -R app:app /app
USER app
WORKDIR /app/packages/demo-bff
EXPOSE 3100
CMD ["node", "dist/main.js"]
