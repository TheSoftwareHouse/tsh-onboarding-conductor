---
paths:
  - 'packages/**/*.{ts,tsx}'
---

# Constants

## Domain values

- Domain values used in more than one place — event types, statuses, state
  identifiers — are declared once as a named enum, const or type contract. Do not
  repeat magic strings across the codebase.
- SQL migrations, external wire contracts, and tests asserting raw payloads are the
  only places a domain value may appear as a literal. Even in tests, prefer the
  constant when it does not hurt readability.
- Extend the canonical contract rather than duplicating it alongside.

## Numeric literals

- Numeric literals carry their meaning in a named constant, so arithmetic reads as
  units — `MILLISECONDS_PER_MINUTE`, `MINUTES_PER_DAY`, `DAYS_IN_WEEK` — each derived
  from the next rather than restated. This holds for a literal used once: a lone
  `60_000` is a magic number wherever it sits.
- Numbers that already read as themselves stay bare: `0`, `1` and `-1` as identity,
  emptiness or a not-found index, and array indices.
