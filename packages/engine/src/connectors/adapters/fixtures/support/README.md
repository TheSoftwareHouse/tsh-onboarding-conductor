# Fixture Support

Shared internals of the fixture connectors, not connectors themselves: no
`ConnectorAdapter` implementation lives here and nothing in this directory is
registered in [`../../connectors.module.ts`](../../../connectors.module.ts).

| File                         | Holds                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `otp-challenge.store.ts`     | Issued codes, their lifetime and the attempt budget of a verification.       |
| `provider-callback.store.ts` | What a fixture remembers when the engine parks a step, plus callback bodies. |
