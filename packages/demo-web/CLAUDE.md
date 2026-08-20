# @tsh/demo-web

Skeleton only — a Playwright config and one placeholder spec, no app (see
`docs/IMPLEMENTATION.md`'s package table, repo root).

`e2e/smoke.spec.ts` renders static placeholder markup with `page.setContent(...)` and
asserts against it — it does not load `baseURL` or exercise any real page. Its job is
to prove the Playwright/CI wiring for this workspace works, not to test a demo-web
app. Do not read a passing run of it as evidence the app exists.
