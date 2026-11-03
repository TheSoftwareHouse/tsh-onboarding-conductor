# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/admin-panel/package.json packages/admin-panel/package.json
COPY packages/demo-bff/package.json packages/demo-bff/package.json
COPY packages/demo-web/package.json packages/demo-web/package.json
COPY packages/docs/package.json packages/docs/package.json
COPY packages/onboarding-seeder/package.json packages/onboarding-seeder/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/ddl-schema/package.json packages/shared/ddl-schema/package.json
COPY packages/shared/openapi/package.json packages/shared/openapi/package.json
COPY packages/skill-evals/package.json packages/skill-evals/package.json
# Every workspace package.json is copied because `--frozen-lockfile` validates the lockfile against
# the whole workspace and fails on a missing importer, but only this service's dependencies are
# installed.
RUN pnpm install --frozen-lockfile --filter @tsh/mcp...

FROM deps AS build
COPY packages/mcp ./packages/mcp
# The generated engine types the server imports (`@tsh/openapi`, type-only, erased at build); the
# `deps` stage copied only this package's manifest.
COPY packages/shared/openapi/src ./packages/shared/openapi/src
RUN pnpm --filter @tsh/mcp build

FROM node:24-alpine AS runtime
# No NODE_ENV default: whatever runs the image must name it, and a container started without it
# refuses to boot rather than silently getting production's rules.
RUN apk add --no-cache curl
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app /app
RUN chown -R app:app /app
USER app
WORKDIR /app/packages/mcp
EXPOSE 3100
CMD ["node", "dist/main.js"]
