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
# Every workspace package.json is copied because `--frozen-lockfile` validates the lockfile
# against the whole workspace, but only the web app's own dependencies are installed.
RUN pnpm install --frozen-lockfile --filter @tsh/demo-web...

FROM deps AS build
COPY packages/demo-web ./packages/demo-web
# No VITE_* value is baked in: the BFF origin is written into /config.js at container start.
RUN pnpm --filter @tsh/demo-web build

FROM nginx:1.27-alpine AS runtime
COPY packages/demo-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY packages/demo-web/docker-entrypoint.sh /docker-entrypoint.d/40-render-config.sh
COPY --from=build /app/packages/demo-web/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-render-config.sh
EXPOSE 80
