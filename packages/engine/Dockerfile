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
# Every workspace package.json is copied because `--frozen-lockfile` validates the lockfile against
# the whole workspace and fails on a missing importer, but only the packages this image builds are
# installed. `@tsh/docs` alone brings Docusaurus, React and its browser toolchain - a few hundred
# megabytes of dependencies that nothing here builds or serves, carried into the runtime stage by
# `COPY --from=build /app /app` and into every pull of the image.
RUN pnpm install --frozen-lockfile \
  --filter @tsh/engine... \
  --filter @tsh/admin-panel... \
  --filter @tsh/ddl-schema...

FROM deps AS build
COPY packages ./packages
# Built-in and fixture email templates and workflows are resolved relative to
# the repository root at runtime, so they must ship inside the image.
COPY email-templates ./email-templates
COPY workflows ./workflows
# The admin panel is built here too and served by the engine at runtime, so the two halves ship as
# one image and one container. @tsh/ddl-schema is built for the engine, which imports it from
# `dist`; the panel needs no build of it, because packages/admin-panel/vite.config.ts aliases the
# package straight to its TypeScript source. The panel bakes in no configuration either — no build
# argument, no VITE_* env var — because the engine renders its `/config.js` from its own
# environment at request time.
RUN pnpm --filter @tsh/ddl-schema build \
  && pnpm --filter @tsh/engine build \
  && pnpm --filter @tsh/admin-panel build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache curl
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
# Carries packages/admin-panel/dist along with the engine's own build; that is the path
# src/admin-panel/admin-panel-static.ts serves the panel from.
COPY --from=build /app /app
RUN chown -R app:app /app
USER app
WORKDIR /app/packages/engine
EXPOSE 3000
CMD ["node", "dist/main.js"]
