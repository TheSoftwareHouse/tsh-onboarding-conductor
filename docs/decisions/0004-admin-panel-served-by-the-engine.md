# 0004. The admin panel ships in the engine's image and is served by the engine

- **Status:** Accepted
- **Date:** 2026-08-28
- **Tags:** admin-panel, engine, docker, configuration
- **Supersedes:** [0003-admin-panel-runtime-configuration.md](./0003-admin-panel-runtime-configuration.md)
- **Superseded by:** —

## Decision

There is one image. `packages/engine/Dockerfile`'s `build` stage runs `vite build`
alongside the engine's own build, and the runtime stage carries `packages/admin-panel/dist` with
everything else; `packages/admin-panel/Dockerfile`, `nginx.conf` and `write-config-js.sh` are
deleted, and Compose has no `admin-panel` service. The engine serves
the panel from its own origin and its own port: `ENGINE_PORT` publishes the API under `/v1`
and the panel at every other path.

`serveAdminPanel()` (`packages/engine/src/admin-panel/admin-panel-static.ts`) registers three
Express handlers ahead of Nest's router — `/config.js`, the static build, and an SPA fallback
to `index.html`. When there is no build to serve, which is the normal case for
`pnpm start:dev` and for the engine's own test runs, all three are skipped.

Decision 0003's runtime-configuration mechanism is kept in full and only changes hands.
`window.__ENV__` still overrides `import.meta.env`, `readRuntimeEnv()` is untouched, and the
seven `VITE_*` keys are still read from the container's environment at start-up — the engine
now renders them into `/config.js` from `ConfigService`, where `write-config-js.sh` used to
write them into a file before nginx started. `VITE_ENGINE_API_BASE_URL` gains a same-origin
default of `/`, because the panel is now served by the engine it calls.

## Context

Decision 0003 rejected this exact option, on the grounds that it "couples two independently
deployable artifacts" and that its plan's Goal kept the engine's Dockerfile and Compose
services untouched. That second reason was a constraint of that task, not a property of the
system, and it is what is being revisited here: the engine and the panel are released
together, versioned together and operated by the same team, so the independence being
protected was never exercised.

What the split cost was concrete. Two images and two Compose services had to be kept in step
over a shared port, a shared origin and a shared `VITE_*` list; the panel's `VITE_*` values had
to be escaped into a JavaScript object literal by hand in POSIX `sh`, because the nginx runtime
stage has no Node and therefore no `JSON.stringify` — 80 lines of shell whose failure mode 0003
recorded as "takes down the whole panel"; and the panel's absolute `VITE_ENGINE_API_BASE_URL`
had to be corrected by hand whenever `ENGINE_PORT` moved.

Serving the panel from the engine is cheap here specifically because every engine route is
namespaced under `/v1`. Nothing is mounted at the root, so the panel can own it with a
catch-all fallback and shadow no API route. The engine already runs on
`@nestjs/platform-express`, so serving static files needs no new dependency and no new base
image.

## Alternatives

| Option                                                             | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keeping decision 0003's separate nginx image                       | The status quo being replaced. Its costs are set out in Context; none of the independence it bought is exercised by how this project is built or released.                                                                                                                                                                                                                                                                                                                                                                       |
| Keeping the separate image but adding an nginx `/v1` reverse proxy | Solves the absolute-base-URL problem and nothing else. It keeps both images, both services and the hand-rolled shell escaping, and adds a proxy configuration that `pnpm dev` does not exercise — the same objection 0003 itself raised against a proxy.                                                                                                                                                                                                                                                                         |
| A separate panel build stage copying only `dist/` across           | Tried first, on the assumption that it would keep React, Vite and the panel's toolchain out of the runtime image. Measurement showed it excluded nothing: the engine's `build` stage copies the whole `packages/` tree and its `pnpm` invocations install the entire workspace, so those packages were already in the image before this decision — 1011 entries under `node_modules/.pnpm`, panel dependencies included, both before and after. The separate stage only bought a second full `pnpm install`, so it was reverted. |
| Writing `config.js` to disk at start-up, as the shell script did   | Would work — the engine image has Node, so the escaping problem disappears either way — but it writes to the image filesystem at boot for no gain. Rendering the script per request is stateless, needs no writable path, and cannot serve a copy left behind by a previous configuration.                                                                                                                                                                                                                                       |

## Consequences

Adding the panel to the image cost about 900 kB — the size of `dist/` — and left it at 1.37 GB.
That is not because the panel is cheap but because the image was already carrying its
dependencies: the runtime stage copies the build stage's whole `/app`, `node_modules` included,
so that it can also run jest for the Compose MailHog suite. Pruning that `node_modules` is worth
doing and is a separate change; this decision neither improves nor worsens it.

The panel and the engine now version, deploy, restart and scale as one unit. Putting the panel
on a CDN or scaling it separately is no longer possible without reversing this decision. A
`MODE=worker-only` container carries a static bundle it never serves, which is harmless — it
already carries the whole API — but it is real coupling, not just a packaging detail.

Every engine route must stay under `/v1`. A controller mounted outside that prefix will be
answered with `index.html` and a 200 rather than reaching its handler, and the failure will
look like a routing bug rather than a namespacing one. `isApiRequest()` is the single place
that encodes the prefix.

An unknown non-API path now answers 200 with the SPA shell instead of 404. This is the same
behaviour the panel's `try_files $uri $uri/ /index.html` provided and the same trade every SPA
fallback makes, but it applies to the engine's origin now, not to a separate one.

A new `VITE_*` variable still has to be added in four places, and the fourth has moved: the
`ImportMetaEnv` interface in `vite-env.d.ts`, the engine's Compose `environment:` block,
`ADMIN_PANEL_RUNTIME_CONFIG_KEYS` in `admin-panel-runtime-config.ts`, and `.env.dist`. Missing
one still fails silently, falling back to whichever source still has the value.

`ADMIN_PANEL_ORIGIN` and the engine's CORS allowlist stay, and are now only exercised by
`pnpm dev`, where Vite serves the panel on port 5173 as a separate origin. From the image the
panel is same-origin and CORS never enters the picture — so a CORS regression will not be
caught by running the stack, only by running the dev server against it.

The host port the panel used to publish, 5173, is no longer taken by a container, so the
package's Playwright suite could move back to it. It stays on 5174: nothing forces the move
back, and changing it again would only churn the configuration 0003 settled.
