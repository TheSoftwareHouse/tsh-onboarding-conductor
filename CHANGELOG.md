# Changelog

One product version covers the whole monorepo. Every pull request merged into `main` bumps it and
adds an entry here, generated from the squash-merge commit subject (the PR title). See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning).

## 0.0.1 — 2026-10-13

### Highlights

This is the first versioned release. It contains everything merged up to #97.

- **Documentation site.** A Docusaurus 3 package skinned with the TSH design system, with start-here
  guides, an API reference generated from the engine's OpenAPI document and a gallery of the workflow
  fixtures generated from the workflow files. `pnpm docs:dev` runs it locally; it deploys to Vercel
  from `packages/docs`.
- **OpenAPI document.** The engine's HTTP contract is published as an OpenAPI 3.1 document generated
  from its route and DTO decorators. The document is committed at
  `packages/shared/openapi/engine.openapi.json`, regenerated with `pnpm openapi:generate`, served by
  a running engine at `GET /v1/openapi.json`, and `pnpm test` fails when the committed file no longer
  matches the code. Provider-callback refusals that were inline `BadRequestException` payloads are now
  exception classes with the same codes.

### Features

- update typescript ([#6](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/6))
- **engine:** implement onboarding feature with workflow registry ([#5](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/5))
- implement onboarding sync workflow with dynamic submission and validation ([#7](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/7))
- implement get admin onboardings endpoint ([#13](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/13))
- extended step data validation ([#9](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/9))
- allow to load all workflows from directory ([#15](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/15))
- implement connector execution for onboarding workflows ([#12](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/12))
- manual review flow ([#23](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/23))
- client webhook notifications ([#18](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/18))
- implement admin panel onboardings ([#20](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/20))
- add otp verification support ([#19](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/19))
- add codnitional validations and transitions ([#28](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/28))
- add support for async connectors ([#29](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/29))
- audit logs implementation ([#25](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/25))
- added a queue and fixed validation errors ([#31](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/31))
- webhook audit implementation ([#30](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/30))
- twilio connector ([#32](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/32))
- http connector ([#35](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/35))
- add sendgrid connector ([#36](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/36))
- mailhog connector ([#33](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/33))
- refactor validators ([#37](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/37))
- added /state endpoint to get current step schema for bff ([#41](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/41))
- allow hmac verification for conenctors ([#40](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/40))
- admin to enginge workflow statuses aligned, already implemented features collected into an implementation spec md ([#45](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/45))
- add azure sso for admin panel ([#39](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/39))
- visualize audit log in admin panel ([#44](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/44))
- email templates should be extracted from workflows directory and allow mounting ([#46](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/46))
- rename smpt conenctor and divide conenctors into groups ([#47](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/47))
- move workflows to database ([#49](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/49))
- allows to mock production conenctors in e2e tests ([#50](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/50))
- claude setup ([#53](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/53))
- onboarding details & audit log filter improvements & persisting filters ([#51](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/51))
- add readme ([#54](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/54))
- connector setup via admin panel ([#56](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/56))
- include admin panel in docker image ([#59](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/59))
- sumsub implementation ([#58](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/58))
- connector fallback ([#62](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/62))
- eu banking built-in workflow config ([#61](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/61))
- onboarding scoring feature ([#64](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/64))
- add specialized workflow node types ([#66](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/66))
- renamed nodes to steps ([#70](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/70))
- adjust admin panel styles & onboarding list page to new design ([#68](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/68))
- create audit logs for error responses ([#67](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/67))
- t&c feature ([#69](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/69))
- migrate logs page to new design ([#71](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/71))
- return connector scope in response ([#82](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/82))
- adjust connectors page to new design ([#81](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/81))
- redesign onboarding details page and move engine reads and writes into src/api query factories ([#83](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/83))
- agentic skills for workflow creation and api integration ([#65](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/65))
- data encryption feature ([#80](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/80))
- signin redesign ([#86](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/86))
- add toast messages ([#87](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/87))
- add workflows list ([#88](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/88))
- add workflow details page ([#89](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/89))
- add links between workflow & onboarding ([#90](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/90))
- add workflow creating via admin panel ([#95](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/95))

### Fixes

- change admin url
- refactor connectors to be more generic ([#26](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/26))
- suppress not configured webhook audit logs ([#34](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/34))
- root e2e test runner errors ([#38](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/38))
- change ci setting to not duplicate jobs
- added mailhog compose profile ([#85](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/85))

### Other changes

- **copilot:** add copilot instructions as project constitution
- bump Node.js version to 24 across configuration files ([#2](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/2))
- update pnpm version to 11.x in README and package.json ([#3](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/3))
- update nestjs dependencies to v11 ([#4](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/4))
- bump pnpm version to 11.15.1 ([#21](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/21))
- make compose ports configurable ([#22](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/22))
- Feat/upload file step ([#14](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/14))
- let CI create .env from the sample instead of a test config helper ([#42](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/42))
- replace minio with garage as the local object store ([#73](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/73))
- Feat/engine openapi spec ([#72](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/72))
- setup admin-panel folder structure rules ([#75](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/75))
- cleanup search params & filtering logic in admin panel ([#76](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/76))
- orm database relations ([#74](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/74))
- extract mutation to mutations factory & cleanup api errors ([#97](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/97))
- Feat/veriff kyc connector ([#92](https://github.com/TheSoftwareHouse/tsh-onboarding-conductor/pull/92))
