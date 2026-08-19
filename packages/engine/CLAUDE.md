# Engine conventions — `packages/engine`

Scoped rules for `packages/engine/src/**/*.ts`. The root `CLAUDE.md` applies in full; this file adds
the engine-specific contracts and, where noted, narrows a global rule.

## Architecture

- Engine features use **vertical feature modules**: primary roles (controller, module, service,
  repository, and co-located specs) stay at the feature root; add a service only when business logic
  requires it.
- Supporting artifacts belong in intent-revealing subdirectories — **not** in per-role nested roots.
  The ones in use, with what each holds:

  | Directory    | Holds                                                         |
  | ------------ | ------------------------------------------------------------- |
  | `dto/`       | request and response shapes, `class-validator` decorated      |
  | `entity/`    | TypeORM entities                                              |
  | `errors/`    | both client-facing exceptions and internal errors (see below) |
  | `domain/`    | framework-free logic — no Nest, no HTTP                       |
  | `ports/`     | interfaces a pluggable implementation must satisfy            |
  | `adapters/`  | one implementation of a port per file                         |
  | `resolvers/` | logic that turns a reference into the thing it points at      |
  | `transport/` | wire-level concerns for a non-HTTP channel                    |

- Framework-independent domain logic must not depend on Nest decorators or HTTP/transport concerns.
- Keep types local to the owning module or class until actual reuse establishes a boundary; do not
  create shared type modules or interfaces preemptively.
- Keep these architecture rules generic and declarative; do not add procedural workflows or unrelated
  framework details.

## File names

The suffix states the role, and the file name is the kebab-case form of the class it exports:

`<feature>.controller.ts` · `<feature>.module.ts` · `<name>.service.ts` · `<name>.repository.ts` ·
`<name>.entity.ts` · `<name>.dto.ts` · `<name>.port.ts` · `<name>.connector.ts` · `<name>.resolver.ts` ·
`<name>.config.ts` · `<name>.exception.ts` · `<name>.error.ts` · co-located `*.spec.ts`

DTOs take a second qualifier when the plain form would be ambiguous: `create-onboarding.dto.ts`,
`list-admin-onboardings.query.dto.ts`, `onboarding-state.response.dto.ts`.

## Errors — two kinds, one directory

Both live in `<feature>/errors/`, and the suffix says which contract applies. Getting this wrong
either leaks an internal message to a client or hides a client-facing code from the API.

**`*.exception.ts` — client-facing.** Extends the semantically correct Nest HTTP exception and owns a
fixed `{ code, message }` payload. `code` is `SCREAMING_SNAKE_CASE` and is part of the public API:

```ts
export class OnboardingNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'ONBOARDING_NOT_FOUND',
      message: 'ONBOARDING_NOT_FOUND',
    });
  }
}
```

**`*.error.ts` — internal.** Extends plain `Error` with a descriptive message built from the context
that caused it. These signal a misconfiguration or a programming error, mostly at startup, and are
never part of a client contract:

```ts
export class ConnectorAdapterNotRegisteredError extends Error {
  constructor(type: string) {
    super(`Connector adapter not registered for type=${type}`);
  }
}
```

Further rules:

- There is no custom exception filter; rely on Nest's default HTTP exception handling.
- Construct and throw the class at the call site instead of repeating payload literals.
- Do not use a generic global error enum or map as the primary public error contract.
- Preserve the correct semantic status, distinguishing bad request, not found and conflict.
- A new exception's `code` and status go in the `docs/IMPLEMENTATION.md` §11 table in the same change.

## Repositories own queries, callers own transactions

Repositories are **plain classes** — no `@Injectable()` — listed in the module's `providers`, and
**every method takes an `EntityManager` as its first parameter**:

```ts
export class OnboardingsRepository {
  async findById(manager: EntityManager, id: string): Promise<OnboardingEntity | null> {
    return manager.getRepository(OnboardingEntity).findOne({ where: { id } });
  }
}
```

A repository never resolves its own connection, so the caller decides whether a call runs standalone
or inside `dataSource.transaction()`. This is what makes the global "no transactions by default" rule
enforceable: the transaction boundary is always visible in the calling service, never buried.

Keep raw SQL in the repository when the guarantee lives in the SQL — the webhook outbox
claim/finalize statements in `webhook/webhook.repository.ts` are the reference.

## Entities

- `@Entity({ name: 'snake_case_table' })`; every column that is not already snake_case gets an
  explicit `@Column({ name: 'snake_case' })` mapping a camelCase property.
- Declare column properties with `!` definite assignment.
- Type lifecycle columns with the domain contract from `@tsh/ddl-schema` (for example
  `status!: WorkflowStatus`), never a local string union — see the root file's domain-constants rule.
- Non-persisted, request-scoped state uses `#private` fields, so it cannot be mistaken for a column.

## Narrowing of global rules

- **Bespoke input types.** The global rule stands for service and class methods: pass existing domain
  objects. A named data shape is still correct for entity creation payloads assembled from several
  sources (`InitialOnboardingData`) and for DTOs, which are the wire contract.
- **Generic escape hatches.** `Record<string, unknown>` is accepted for an onboarding `context` and
  for raw workflow JSON, because those really are open-ended. Everywhere else the global rule holds.
