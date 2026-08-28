# 0003. The admin panel is configured at runtime, not at build time

- **Status:** Superseded
- **Date:** 2026-08-28
- **Tags:** admin-panel, docker, configuration
- **Supersedes:** —
- **Superseded by:** [0004-admin-panel-served-by-the-engine.md](./0004-admin-panel-served-by-the-engine.md)

## Decision

The admin panel ships as its own image — `nginxinc/nginx-unprivileged:1.27-alpine`,
running as the non-root `nginx` user, serving nothing but the `vite build` output — and
its Compose service reads exactly like the engine's: a `build` block and an
`environment:` block of `${VAR:-default}` entries, **no `build.args`**. The container's
entrypoint writes the seven `VITE_*` values it finds in its process environment into
`/usr/share/nginx/html/config.js` as `window.__ENV__ = { ... }` before nginx starts;
`index.html` loads that script ahead of the app bundle, and `readRuntimeEnv()` merges
`window.__ENV__` over `import.meta.env`, dropping non-string and empty-string values so
an unset Compose variable falls through to the build-time value instead of shadowing it
with `""`. `pnpm dev` never populates `window.__ENV__`, so it is unaffected: build-time
`import.meta.env` is all that exists there.

The browser keeps calling the engine directly at `http://localhost:${ENGINE_PORT}`,
exactly as `pnpm dev` does today — no nginx reverse proxy, no same-origin `/v1` routing.
The engine's existing `ADMIN_PANEL_ORIGIN` CORS allowlist is what permits it.

## Context

An earlier draft passed the panel's `VITE_*` values as Docker build args, baking them
into the image at `docker build` time. That was reversed on the user's instruction:
"Please solve this the same way we do in engine if possible." `packages/engine/Dockerfile`
declares no `ARG` at all — every engine setting arrives at runtime through the Compose
`environment:` block — and reversing the panel to match gets a concrete, immediate
benefit: a `.env` edit takes effect on `docker compose restart admin-panel`, with no
image rebuild. A build-arg image cannot do that by construction, because Vite inlines
`import.meta.env.VITE_*` into the bundle at build time; the only way to change a value
afterwards is to rebuild.

The panel is a static single-page app, so nothing server-side can read an environment
variable per request the way the engine reads `process.env`. `window.__ENV__` written by
a start-up script is the standard way around that constraint without reintroducing a
build step, and it is what makes the panel's Compose service and its configuration story
match the engine's rather than needing a second, different mental model for one repository.

## Alternatives

| Option                                                         | Why not                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker build args baking `VITE_*` into the image               | The earlier draft. Vite inlines the values at build time, so the resulting image is tied to one environment's configuration and every configuration change — even just a different engine URL — needs a full image rebuild, not a restart. It also puts the panel's configuration story at odds with the engine's, which takes every setting at runtime. |
| Serving the panel from the engine's own image and process      | Couples two independently deployable artifacts — a Node API and a static SPA — into one image and one restart unit, and the plan's Goal explicitly keeps the engine's Dockerfile and Compose services untouched: the panel gets its own image.                                                                                                           |
| An nginx reverse proxy for `/v1` giving same-origin API access | Removes CORS from the picture, but makes the containerised panel behave differently from `pnpm dev`, which talks to the engine directly. Decision 2 in the plan's Task Details keeps the container and the dev server on the same code path rather than adding a proxy-only behaviour nothing exercises locally.                                         |
| Keeping `pnpm dev` as the only way to run the panel            | Fails the goal outright: `pnpm stack:up` is supposed to put a working UI in front of an operator without anyone running a dev server, and this alternative does not change that at all.                                                                                                                                                                  |

## Consequences

The panel's configuration now has two sources with a defined precedence —
`window.__ENV__` over `import.meta.env` — so a new `VITE_*` variable has to be added in
four places to actually reach the running app: `vite-env.d.ts`'s `ImportMetaEnv`
interface, the Compose `environment:` block, `write-config-js.sh`'s variable list, and
`.env.dist`. Missing one of the four does not fail loudly; the variable silently falls
back to whichever source still has it, or to `undefined`.

`config.js` must be served with `Cache-Control: no-store`, or a browser that already
cached it keeps a previous container's values across a restart — defeating the entire
point of reading configuration at start-up rather than at build time.

The entrypoint escapes every environment value it writes into a JavaScript double-quoted
string literal by hand, because the runtime stage has no Node and therefore no
`JSON.stringify`. That hand-rolled escaping is a small injection surface — a value
containing a quote, a backslash or a newline that is not escaped correctly breaks the
literal and takes down the whole panel — and it has to stay correct as the seven-variable
list evolves; `write-config-js.sh`'s comment records the exact approach and the
`node --check` verification this task ran against it.

The container publishes host port 5173, the port the panel has always used, so the
package's own Playwright suite — which also defaulted to 5173 — had to move its dev
server to 5174 to stop contending with the container for the port.
