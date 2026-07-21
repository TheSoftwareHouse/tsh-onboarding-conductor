# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/admin-panel/package.json packages/admin-panel/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/ddl-schema/package.json packages/shared/ddl-schema/package.json
COPY packages/shared/openapi/package.json packages/shared/openapi/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_ADMIN_PANEL_ENGINE_BASE_URL=http://localhost:3000
ENV VITE_ADMIN_PANEL_ENGINE_BASE_URL=$VITE_ADMIN_PANEL_ENGINE_BASE_URL
COPY packages/admin-panel ./packages/admin-panel
RUN pnpm --filter @tsh/admin-panel build

FROM base AS runtime
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/packages/admin-panel
EXPOSE 5174
CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "5174", "--strictPort"]
