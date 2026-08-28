# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/admin-panel/package.json packages/admin-panel/package.json
COPY packages/shared/ddl-schema/package.json packages/shared/ddl-schema/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
# @tsh/ddl-schema is never built: packages/admin-panel/vite.config.ts aliases it straight to
# that package's TypeScript source, so a `dist` build here would be dead weight this image
# never reads. Configuration is read at runtime (see write-config-js.sh in the runtime
# stage below), so this stage declares no build argument and no VITE_* env var.
RUN pnpm --filter @tsh/admin-panel build

# Unprivileged nginx: already listens on 8080 and runs as a non-root user, matching the
# runtime stage's requirements without a hand-rolled USER/chown (see this task's Stop Rule
# for the official-nginx fallback if this tag cannot be pulled).
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# The base image's own /usr/share/nginx/html is root-owned (0755), so the entrypoint's
# non-root nginx user cannot overwrite config.js there at start-up unless that one file's
# ownership is fixed up as root during the build, then dropped back to the base image's
# non-root user. Everything else in the webroot stays root-owned and read-only to nginx.
USER root
COPY packages/admin-panel/nginx.conf /etc/nginx/conf.d/default.conf
# Installed under a name distinct from the base image's own /docker-entrypoint.sh, so that
# script still owns its path and its /docker-entrypoint.d/ hooks — including
# 30-tune-worker-processes.sh — still run. This entrypoint writes config.js, then chains to
# the base one (see write-config-js.sh) instead of replacing it.
COPY --chmod=755 packages/admin-panel/write-config-js.sh /write-config-js.sh
COPY --from=build /app/packages/admin-panel/dist /usr/share/nginx/html
RUN chown nginx:nginx /usr/share/nginx/html/config.js
USER nginx
EXPOSE 8080
ENTRYPOINT ["/write-config-js.sh"]
CMD ["nginx", "-g", "daemon off;"]
