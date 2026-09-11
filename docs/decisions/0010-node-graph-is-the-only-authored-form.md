# 0010. The node graph is the only authored form of a workflow

- **Status:** Accepted
- **Date:** 2026-09-10
- **Tags:** workflows, ddl-schema, authoring, migration
- **Supersedes:** 0009
- **Superseded by:** —

## Decision

A workflow document is written as a graph of typed nodes and in no other form. The DDL refuses a
document that declares a root `steps` list, with `UNKNOWN_PROPERTY` at `steps`. The step form
survives as the compiled intermediate every node type produces and the engine runs; it is
validated as before, but it is no longer something anyone writes.

What 0009 decided about the node layer stands and is restated here so this record can be read on
its own: a node graph compiles to the step form before anything validates it, node types are a
registry mirroring the field-type registry, and compilation is two-phase over a document-wide
contract. What changes is that the step form stops being an authored alternative.

Four things make the node form at least as expressive as the form it replaces:

- **`custom-step`** carries a hand-written step verbatim — status, data, connectors, scoring,
  raw transitions naming step names — and its config is validated against the step schema's own
  definitions. `convertStepsToNodeGraph` rewrites any step document into one of these per step,
  and compiles back to exactly the steps it was given.
- **`connector-call`** collects fields and calls connectors declared in full, the way a step
  declares them, while keeping ports (`success`, and `rejected` when a connector can refuse).
- **Every node may carry `scoring` rules**, attached to the step whose submit decides the node's
  outcome — the entry step, or the one the type names (`otp-verify` scores on the check).
  `terminal` and `risk-score` refuse them.
- **An edge arm may carry `webhook: { notify: false }`**, and **a connector binding carries the
  step form's whole failure policy** — `errorHandler`, `retry` and a `fallback` chain whose
  entries may add their own mapping and config beside what the node derives. `manual-review`'s
  `invalid` port is optional, since a hand-written review need not offer it.

A failure the step phase reports at `steps[k]…` is restated as `nodes[i]`, the node whose type
produced that step. Stored rows still in the step form are rewritten by migration `0020`, in
JavaScript so key order survives.

## Context

Two authored forms meant two documents for every example, two schemas an author had to know, and a
builder that had to render a document it could not draw. Every fixture shipped twice to show the
same flow both ways, and the engine's compile endpoint answered differently depending on which
form it was handed. Once `custom-step` existed, the step form bought nothing the node form could
not say — but as long as it was accepted, nothing forced a document toward the form a builder,
the palette and the port model are built for.

The gaps that kept the step form necessary were concrete: a mock connector on a collection step,
a transition's notification opt-out, a connector's fallback chain, and scoring rules on a step a
specialized node produced. Each had no node-level expression, so every fixture that used one had to
stay a step document or fall back to `custom-step` wholesale.

## Alternatives

| Option                                                                 | Why not                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep both forms                                                        | Two schemas, two example sets and a compile endpoint with two answers; the palette, the ports and every builder affordance apply to one of them only                                 |
| Nodes only, with `custom-step` wherever a specialized type falls short | Every typed example would still contain hand-written steps, so the specialized types would never be shown covering a whole flow, and the gaps would never close                      |
| Nodes only, restructuring examples to avoid the gaps                   | Drops the mechanism a fixture exists to exercise — a fallback chain, a notification opt-out — from the very document meant to demonstrate it                                         |
| A generic `connector` slot on `form`                                   | `form` is composable, and a fragment with connectors would lose them silently when merged into another node's step; a separate `connector-call` keeps the composable contract intact |
| Reading scoring rules and webhook opt-outs from node config per type   | Twenty types each deciding whether to accept them; a node-level property with one attachment rule in the compiler applies to every type at once, mounted ones included               |
| Documenting stored step-form rows as a manual clean-up                 | Boot re-validates every stored row, so one forgotten row takes the engine down; a data migration costs a few lines and the reverse direction is well defined for custom-step graphs  |

## Consequences

- **A document written as steps no longer loads.** The refusal names `steps`; `pnpm
workflow:compile <file> --from-steps` prints the graph to save in its place. Every checked-in
  document is already converted, and migration `0020` rewrites stored rows, so an existing
  deployment upgrades without touching data — but an engine image older than this change cannot
  boot against a database the new image has written, because `connector-call`, node scoring and
  the reshaped `notify` binding are unknown to it. Rolling back means rolling the rows back too.
- **`notify`'s config changed shape.** Its `payload` became `connector.fieldMapping` and its
  `config` moved onto the binding, so a fallback provider can carry its own. No checked-in document
  used the old shape.
- **Every fixture ships twice again, but as two node graphs**: `<name>.workflow.json` in
  `custom-step` nodes, `<name>-typed.workflow.json` in specialized nodes. Seven pairs compile to
  identical steps and a spec pins them; the other four differ in named ways (`manual-review` keeps a
  stray submit where it was, `otp-verify` adds the re-send path, the Sumsub and scoring twins
  collect through specialized nodes whose fields are shaped by the node). The e2e suites keep
  addressing the plain ids, whose compiled steps did not change.
- **Test documents are written as steps and loaded as `custom-step` graphs** through one helper
  per package, so the step-level rules stay stated in the form they are about.
- **Paths from the step phase name only a node.** Every authored member is validated against the
  step schema's definitions before compilation, so a step-schema failure after it can only come
  from a type's `compile` — a type defect, for which the node is the right address. Semantic
  failures still carry no path, as before.
- **The palette grows by one type, and slots grow a failure policy.** A builder reading
  `GET /v1/admin/node-types` sees `connector-call` with no slot to filter by, and every slot's
  binding schema now offers `errorHandler`, `retry` and `fallback`.

Reversing this is expensive: the step schema, the converter and `custom-step` make it possible to
accept a `steps` root again, but every fixture, spec and document would have to be rewritten a
second time, and migration `0020`'s reverse direction restores only graphs made of `custom-step`
nodes.
