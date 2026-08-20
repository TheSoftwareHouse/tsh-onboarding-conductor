---
paths:
  - 'packages/engine/src/**/*.ts'
---

# Engine error contracts

There is no custom exception filter; Nest's default HTTP exception handling applies.
Errors are two-tier, and the filename says which tier a class belongs to.

- `<feature>/errors/*.exception.ts` — client-facing. Extends the Nest HTTP exception
  subclass carrying the correct semantic status (`NotFoundException`,
  `ConflictException`, `BadRequestException`, `GoneException`,
  `UnauthorizedException`, `InternalServerErrorException`).
- `<feature>/errors/*.error.ts` — internal domain errors. Extends plain `Error` and
  sets `this.name`. These are not thrown across the HTTP boundary unmapped.

Each exception owns a fixed `{ code, message }` payload in its own constructor, so
call sites throw the class instead of repeating the literal:

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

Do not introduce a global error enum or map as the public error contract.
