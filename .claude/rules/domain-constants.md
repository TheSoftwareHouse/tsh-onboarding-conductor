---
paths:
  - 'packages/**/*.ts'
---

# Domain constants

- Domain values used in more than one place — event types, statuses, state
  identifiers — are declared once as a named enum, const or type contract. Do not
  repeat magic strings across the codebase.
- SQL migrations, external wire contracts, and tests asserting raw payloads are the
  only places literal values are acceptable. Even in tests, prefer the constant when
  it does not hurt readability.
- Extend the canonical contract rather than duplicating it alongside.
