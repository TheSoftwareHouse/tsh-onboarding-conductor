---
paths:
  - 'packages/**/*.{ts,tsx}'
---

# Code design

**Naming.** Use a simple operation prefix plus a descriptive noun — `parseFilters`,
`mapWorkflow`, `processOnboarding`, `findAdapter`. Avoid over-specific names like
`normalizeAdminOnboardingFilters` or `resolveAdapterByType`. Use `find<Noun>` for an
optional lookup that may return `undefined`, and `get<Noun>` for a required lookup
that returns the value or throws.

**Responsibility.** Encapsulate behaviour in clearly named classes that fully own one
responsibility. Do not add a method that only delegates to one other method, and
avoid excessive private-method decomposition — keep a larger method when its flow
stays coherent.

**Parameters.** Pass existing domain or application objects; the receiving method
extracts what it needs. Do not invent a bespoke input type per method.

```ts
// Avoid
workflow.evaluate({ data, onboardingId, workflowVersion });

// Prefer
workflow.evaluate(data, onboarding);
```

**Types.** Prefer concrete, named types for responses, payloads and metadata whenever
the shape is knowable. Avoid `any`, `unknown` and `Record<string, unknown>` where a
real contract can be expressed; keep them only at genuinely dynamic boundaries such
as externally supplied JSON. Do not create named types that add no structure.
`packages/engine/tsconfig.json` currently relaxes `strictNullChecks`,
`noImplicitAny` and `strictBindCallApply` — write code as if strict mode were fully
on regardless.

**Persistence.** Use ordinary repository methods for independent writes. Reach for a
transaction only when several writes must succeed or fail together.

**Proportion.** Follow KISS: the simplest design that satisfies the requirement. Use
the Strategy pattern for genuinely composable, user-extensible variation (such as
per-field-type validation), not for every conditional.

**Control flow.** Do not declare a `let` result only to assign it inside a `try` and
read it after the `catch`. Restructure so the success and failure paths stay explicit.
