# 0052. The MCP masks personal data by default, so none reaches the model

- **Status:** Accepted
- **Date:** 2026-11-01
- **Tags:** mcp, security, privacy, masking, audit
- **Supersedes:** —
- **Superseded by:** —

## Decision

Every value a tool returns is classified in the MCP and masked before it leaves, default deny: a
value no rule classifies is dropped. Fields are classified from the compiled definition of the workflow version (the engine's dry-run
compile of the stored document), and audit `metadata`, `before` and `after` pass only keys allowlisted per action family (from
`audit/audit.types.ts`), with `submittedData` masked by its field classes.

| Class          | Applies to                                                                             | Result                                                                                                |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pass`         | system fields, scores, enumerated values, booleans, names in `MCP_MASKING_PASS_FIELDS` | value in clear (allowlist defaults to `country,nationality`)                                          |
| `pseudonymise` | email, phone                                                                           | `email:<12 hex>` or `phone:<12 hex>`, HMAC-SHA256 of the normalised value, keyed by `MCP_MASKING_KEY` |
| `generalise`   | date of birth                                                                          | 10-year age band                                                                                      |
| `drop`         | names, addresses, free text, documents, anything unclassified                          | omitted                                                                                               |

The same email always yields the same pseudonym, so duplicate applicants stay countable. Only masked
rows are cached, in memory. The key is required, at least 32 bytes, and never logged. The MCP's
audit line records argument keys, never values.

## Context

An analyst's question must be answerable from an AI client without applicant personal data reaching
the model. The engine returns collected data through the CSV export (0044), which has no personal-data-free
variant, and the engine is not changed for this work (0050). Applicant free text
is also the main route for prompt injection into the model, and dropping it removes most of that
surface.

## Alternatives

| Option                                                  | Why not                                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mask in the engine (a personal-data-free export)        | An engine change, outside this work; listed as an engine follow-up                                                                                          |
| Detect personal data by pattern, pass the rest          | Anything the detector misses reaches the model; default deny fails closed                                                                                   |
| Drop email and phone too                                | Duplicate applicants and repeated contact details could no longer be counted                                                                                |
| Send everything and rely on a data-processing agreement | The agreement and data-residency position for Anthropic or OpenAI is a legal decision still required before non-synthetic use; masking does not wait for it |

## Consequences

**Masking is not access control.** It governs what reaches the model. The analyst's account can
still read every field in the admin panel and download the CSV export, and the MCP does not restrict
which onboardings, workflows or audit rows an analyst with the engine's admin role may query.

A field the classifier has no rule for is dropped until one exists, which errs toward silence.
Adding a pass-through field is a configuration change
(`MCP_MASKING_PASS_FIELDS`), not a code change.

Pseudonyms are stable for a given `MCP_MASKING_KEY`; rotating the key changes every token and breaks
comparison with earlier output. The legal position on sending even masked data to a model provider
remains open and gates any use beyond synthetic data.

Reversing this means removing the masker from the tool pipeline; every tool depends on it.
