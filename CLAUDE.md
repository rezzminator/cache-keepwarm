# cache-keepwarm

A Claude Code function-hooks plugin: while the main chat waits on tracked background work, it replays the last request invisibly before the prompt cache expires, admitted by a budget forecast against the rewrite it saves, with actual spend accounted. `README.md` is the behavioural spec.

## Layout

- `plugins/cache-keepwarm/`: everything that installs, and nothing else — the directory scans only this folder, so dev files never go in it; `tests/` there is the exception `claude plugin test` requires.
- `plugins/cache-keepwarm/hooks/cache-keepwarm.ts`: the adapter, the only file that touches `$`; at most 500 lines.
- `plugins/cache-keepwarm/src/`: every decision, pure, one concept per file, no cross-imports beyond types, at most 300 lines; `decision.ts` is the one fire decision and `budget.ts` the one producer of spend, allowance and ledger.
- `tests/`: one same-stem vitest file per `src/` file, `adapter.test.ts` over the stand-in `$` in `tests/stand-in.ts`; at most 300 lines each. `plugins/cache-keepwarm/tests/` holds the function-hook tests on the `claude-code/testing` kit.
- `types/claude-code.d.ts`: the plugin API (from `/plugin-types`), the truth for every hook's shape; grep it before using an event.
- `plugins/cache-keepwarm/.claude-plugin/plugin.json`: manifest and `userConfig`; the root `.claude-plugin/marketplace.json` makes the repo its own marketplace.
- `scripts/live-proof.sh` drives the live lanes; `scripts/release-check.sh` checks the release.
- `.github/workflows/`: `ci.yml` runs the gates and the release check, `release.yml` publishes on a `cache-keepwarm--v*` tag.
- `.claude/agents/gitter.md`: the repository's Git writer.
- `THIRD-PARTY-NOTICES`: the licences of the two credited predecessors.

## Commands

- `npm test`: vitest on `tests/`, then `claude plugin test plugins/cache-keepwarm`; `npm run test:unit` and `npm run test:hooks` run the two halves.
- `npm run typecheck`, `npm run validate:plugin` (`claude plugin validate --strict` on the root and on the plugin), `npm run check:structure` (the structure rules under § Rules that a script can check) and `npm run release:check` all pass before a commit.
- The hook tests and `validate:plugin` need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; a machine without `claude` on `PATH` reports the gate NOT RUN, never passed.
- `npm run live -- --lane {wait-return|ttl-1h|collision|stale}` or `--all` is `scripts/live-proof.sh`: a real Haiku (`claude-haiku-5-5`) chat per lane, plugin loaded through `CLAUDE_CODE_PLUGIN_DIRS` in the process environment. Run it after any change to the adapter or to a decision.
- A lane starts with a `need` prelude (exact Claude Code version, function hooks on, plugin loaded); a missing need prints `ERROR {need}` and exits 2, a lane not run reads `NOT RUN`, never a pass.
- Every live checker rejects an API or auth error first (synthetic model reply, fork `api-error`, debug-log API error), then checks model and usage; an invalid run reports `VOID`, never a measured failure.
- Every chat a lane starts is killed at the end, pass or fail; a failed kill prints `CLEANUP FAILED {session}` and exits 2.
- Publish-ready needs three clean serial `--all` sequences on the final tree. Fewer is a named gap in the report; a gate you did not watch run is never reported as run.

## Rules

- **Credentials stay in the seat:** a live lane runs on the invoking user's own Claude configuration. NEVER copy a credentials file and NEVER create an alternate `CLAUDE_CONFIG_DIR`; isolation is the lane's working directory and plugin directory.
- A new behaviour lands in `plugins/cache-keepwarm/src/` as a pure function with a test watched failing first; the adapter only wires it.
- `decision.ts` owns every fire, skip and stop, each with a stable reason code; the adapter holds no policy condition that duplicates it.
- Spend, allowance, protected rewrite and estimated net come from `budget.ts` only; the band, `/keepwarm`, the log and the closing line render those numbers. Costs are input-token equivalents; no USD without a verified engine price.
- A closing net saving is labelled an estimate; unknown usage is unknown, never zero.
- Wait timing comes from structured facts only; an unknown ETA is `unknown`, never inferred from task or command text.
- A label is display-only: it never enters the fork prompt, the log or a reason code.
- The 1h cache is not warmed (`WARM_1H = false`, status `not warming: 1h refresh unproven`) until a valid live run on the seat's own configuration shows a replay refreshing a 1h entry; an unproven path is documented unproven, not as a measured failure.
- Persistence restores only validated last-use and numeric ledger metadata for the same session id; never the `/keepwarm` override, a timer, an admission or a grant. A refused record or a failed store is shown, never silent.
- Every option is also a variable `CACHE_KEEPWARM_{OPTION}`, upper snake, listed in the README § Configuration table: variable > option (`/config`) > default; unset or blank is absent; booleans `1|0|true|false`, any case. A bad variable is named in the status and the option's default applies, never the configured option.
- A new option adds its variable to `plugins/cache-keepwarm/src/options.ts` and the adapter's `readOptionEnv`, its README row, its `userConfig` key and its row in `tests/options.test.ts`.
- `$` is passed only to functions declared at the top level of the hooks file and always spelled `$.noun.event(...)`, and `$.env` names are string literals: Claude Code checks this statically and otherwise loads the module with zero hooks. `npm run validate:plugin` catches it.
- One glossary in code, tests and docs: wait, waiting item, episode, warm, request, epoch, lease, send anchor. No "ping", "keepalive" or "job".
- A claim about Claude Code's behaviour in the README states what was measured; a claim not re-measured on a new release is labelled so.
- A version bump moves `plugins/cache-keepwarm/.claude-plugin/plugin.json`, the root `.claude-plugin/marketplace.json`, `package.json` and the README badge together; installed copies update only on a new version.
- Public repo: no machine-absolute path, personal data or private project name in a tracked file.

## Branches and releases

- `develop` is the default branch: every change lands there, by a commit or a pull request, and CI (`.github/workflows/ci.yml`) runs the gates on it.
- `main` is release-only. It moves only by merging the `develop → main` pull request, with a merge commit and never a squash, so both branches share one history. The marketplace installs the plugin from `main` (`git-subdir`, `ref: main`), so users only ever get a released version.
- A release, in order:
  1. On `develop`: bump the version in all four places, and move `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] — date`. `npm run release:check` passes.
  2. Open the `develop → main` pull request. Its `release` check requires the version to have moved past `main`'s.
  3. Merge once CI is green.
  4. On `main`: `claude plugin tag --push plugins/cache-keepwarm` creates and pushes `cache-keepwarm--vX.Y.Z`. `release.yml` then publishes the GitHub release from the CHANGELOG section.
- Semantic versioning: a fix is a patch; a new option or behaviour is a minor; a renamed or removed option or argument is a major, and its CHANGELOG entry says how to migrate.
- Publishing: code is pushed, and a release is cut, only when the owner asks in the current request; a green gate is never that ask.
- Git writes go through this repo's gitter, `.claude/agents/gitter.md`.
