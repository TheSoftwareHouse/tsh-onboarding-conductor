# Built-in workflows

Production-grade workflows shipped inside the engine image and loaded in every
environment, including production.

**This directory is currently empty.** The engine ships no production workflows
yet. Loading tolerates that: `BUILTIN_WORKFLOWS_DIR` is the only source allowed
to be absent or hold nothing, because an operator running purely on their own
mounted workflows is a supported setup.

A workflow belongs here only if it is something we are prepared to run against
real applicants — real connectors, real endpoints, complete failure branches.
Anything that exists to demonstrate or exercise the engine belongs in
[`../fixtures/`](../fixtures/) instead.

Adding the first file here needs no configuration change; it is picked up on
the next start.
