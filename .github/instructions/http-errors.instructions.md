---
name: HTTP Error Conventions
description: Generic HTTP error contract conventions for TypeScript files in the engine package.
applyTo: packages/engine/src/**/*.ts
---

- There is no custom exception filter; rely on Nest's default HTTP exception handling.
- Define stable client-facing application errors as small, feature-local classes under `<feature>/errors/`, extending the appropriate Nest HTTP exception subclass.
- Each error class owns its fixed `{ code, message }` contract and should be constructed and thrown at call sites instead of repeating payload literals, except for the E3 `InvalidStepDataProblemException` under `onboardings/errors/`.
- `InvalidStepDataProblemException` may extend `BadRequestException`, own the fixed RFC 7807 body `{ type, title, status: 400, code: "INVALID_STEP_DATA", fieldErrors }`, and be thrown at the controller call site. An onboarding route-scoped interceptor may set `application/problem+json`; Nest's default exception handler remains responsible for serialization.
- Do not use a generic global error enum or map as the primary public error contract.
- Preserve the correct semantic HTTP status, distinguishing bad request, not found, and conflict errors.
