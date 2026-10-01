# deep-agents-ui

Next 15, React 19, `@langchain/langgraph-sdk`. Package manager is yarn (`packageManager` in package.json). Do not add or update `package-lock.json`. Node >= 22 (see `.nvmrc`).

`MIGRATION_ANALYSIS.md` is a historical note. It is not a rule.

## Commands

- `yarn check` — typecheck, lint, format, unit tests. This is the definition of done.
- `yarn test:related src/app/hooks/useChat.ts` — tests affected by those files.
- `yarn test:coverage` — unit tests plus the coverage thresholds in `vitest.config.ts`.
- `yarn e2e` — Playwright smokes against a fake LangGraph server. No real deployment.

Do not report a task done unless `yarn check` is green. Set `AGENT_CHECK=0` only when the user explicitly says to skip the agent hook.

## Tests

- A bugfix starts with a failing test that reproduces the bug. Then fix it.
- New logic in hooks goes in `src/app/hooks/chat/*` or `src/app/utils/*`, with a colocated `*.test.ts`. Keep the hook as wiring.
- Mock `@langchain/langgraph-sdk`. No network in unit tests.
- No snapshot tests. Do not test shadcn/radix primitives in `src/components/ui`.
- Do not delete, skip, or loosen a test to make the run green. If a test is wrong, say so and change it in the same diff with a reason.

## Fragile areas

Cover any change here with a test:

- `useChat` — streaming, stop-silence, run timer, uploads (`uploads/<name>`, no `image_url` blocks), recursion limit
- Ask forms — `buildTurnUiContext` renders each UI tool call once per turn. The iframe bridge (`mcp-ui-send-message`) sends a human message; it does not call `command.resume`
- `useThreads` / `threadOwner` — route by `metadata.graph_id`, never by an assistant UUID
- URL state (`nuqs`) — `assistantId` and `threadId` stay in sync with the thread owner
