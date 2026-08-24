## Coding Rules
- Default to writing exactly ZERO comments.
- Never add "what" comments or restate obvious code logic.
- Do not reference the chat history, fixes, or prior iterations in the code.
- Only document "why" a non-obvious workaround or platform constraint exists.

# Package manager

**bun.** Never `npm`, `yarn`, or `pnpm` — the Nx guidance below uses `pnpm nx`
only as an example of prefixing with the workspace's package manager. Here that
is `bun nx`.

# Comments

Write fewer. Most code here has none, and that is the intended state.

- **Never restate the code.** If the comment and the line say the same thing,
  delete the comment.
- **One line, not a paragraph.** A comment that needs three lines is usually
  arguing with a reader who has not objected.
- **No JSDoc on internal helpers.** Reserve doc blocks for exported API that
  someone reads without opening the file.
- **Comment the constraint, not the intent.** The only comment worth keeping is
  one stating something the code cannot: why an obvious simplification does not
  compile, which of two orderings is load bearing, what a cast is standing in
  for. Say the consequence, so the next person does not have to discover it.
- **Do not explain a decision the diff already makes.** That belongs in the
  commit message.

The same restraint applies to code: prefer one function over two, and do not
introduce a helper that only wraps a single call.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->
