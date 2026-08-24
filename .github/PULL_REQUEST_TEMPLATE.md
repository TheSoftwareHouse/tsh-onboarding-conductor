## What and why

<!-- What this changes, and the problem it solves. Link the issue: Closes #123 -->

## How it was verified

<!-- The commands you ran and what you saw. If it changes runtime behaviour, say what you exercised
     locally beyond the test suite. -->

## Checklist

- [ ] `pnpm format:fix`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] `pnpm test:e2e` passes, or is not affected by this change
- [ ] Tests cover the change (a fix includes the test that would have caught the bug)
- [ ] `docs/IMPLEMENTATION.md` updated if this adds, changes or removes a feature
- [ ] `.env.dist` updated, with an explanatory comment, if this adds configuration
- [ ] `pnpm changeset` added for a user-facing change
- [ ] Title is in Conventional Commit form (it becomes the squashed commit message)
