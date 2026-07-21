# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/demo-bff/package.json packages/demo-bff/package.json
COPY packages/demo-web/package.json packages/demo-web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/ddl-schema/package.json packages/shared/ddl-schema/package.json
COPY packages/shared/openapi/package.json packages/shared/openapi/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
RUN pnpm --filter @tsh/ddl-schema build && pnpm --filter @tsh/engine build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache curl
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app /app
RUN chown -R app:app /app
USER app
WORKDIR /app/packages/engine
EXPOSE 3000
CMD ["node", "dist/engine/src/main.js"]
