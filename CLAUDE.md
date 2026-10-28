# cache-keepwarm

A Claude Code function-hooks plugin: while the main chat or a waiting sub-agent waits on tracked background work, it sends a visible keep-warm poke before the prompt cache expires, at most `maxPokes` per unchanged wait, admitted by a budget forecast against the rewrite it saves, with actual spend accounted. `README.md` is the behavioural spec.

## Layout

- `plugins/cache-keepwarm/`: everything that installs, and nothing else — the directory scans only this folder, so dev files never go in it; `tests/` there is the exception `claude plugin test` requires.
- `plugins/cache-keepwarm/hooks/cache-keepwarm.ts`: the adapter, the only file that touches `$`; at most 500 lines.
- `plugins/cache-keepwarm/src/`: every decision, pure, one concept per file, no cross-imports beyond types, at most 300 lines; `decision.ts` is the one fire decision and `budget.ts` the one producer of spend, allowance and ledger.
- `tests/`: one same-stem vitest file per `src/` file, `adapter.test.ts` (main chat) and `adapter-subagents.test.ts` over the stand-in `$` in `tests/stand-in.ts`, `live-checker.test.ts` and `live-poke.test.ts` over the shared evidence fixtures in `tests/live-fixtures.ts`; at most 300 lines each. `plugins/cache-keepwarm/tests/` holds the function-hook tests on the `claude-code/testing` kit.
- `types/claude-code.d.ts`: the plugin API (from `/plugin-types`), the truth for every hook's shape; grep it before using an event.
- `plugins/cache-keepwarm/.claude-plugin/plugin.json`: manifest and `userConfig`; the root `.claude-plugin/marketplace.json` makes the repo its own marketplace.
- `scripts/live-proof.sh` drives the live lanes; `scripts/release-check.sh` checks the release.
- `.github/workflows/release.yml`: on a pull request to `main` its `check` and `release` jobs run `make gate` and `make release`; merging that pull request runs `publish`, which tags `cache-keepwarm--vX.Y.Z` and publishes the GitHub release.
- `.claude/agents/gitter.md`: the repository's Git writer.
- `THIRD-PARTY-NOTICES`: the licences of the two credited predecessors.

## Commands

- `npm test`: vitest on `tests/`, then `claude plugin test plugins/cache-keepwarm`; `npm run test:unit` and `npm run test:hooks` run the two halves.
- `npm run typecheck`, `npm run validate:plugin` (`claude plugin validate --strict` on the root and on the plugin), `npm run check:structure` (the structure rules under § Rules that a script can check) and `npm run release:check` all pass before a commit.
- `make release-check` runs every check `release.yml` runs on a pull request to `main` (`make gate`, then `make release`: the version moved past `origin/main`'s, as last fetched, and a non-empty CHANGELOG section), on Node 24 through `mise` as in CI.
- The hook tests and `validate:plugin` need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; a machine without `claude` on `PATH` reports the gate NOT RUN, never passed.
- `npm run live` is `scripts/live-proof.sh`: a real Haiku (`claude-haiku-5-5`) chat per lane, plugin loaded through `CLAUDE_CODE_PLUGIN_DIRS` in the process environment. Invocation: `npm run live -- --lane wait-return --cwd <trusted-dir> --auto-effort-dir <path> --output <outside-repo-path>`; `cap`, `subagent-wait`, `ttl-1h`, `collision`, `stale` and `--all` (wait-return, cap, collision, stale) are the other modes; a lane's own overrides (`CACHE_KEEPWARM_MAX_POKES=2` for `cap`, `CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT=0` with the main gate closed for `subagent-wait`) reach only its chat. Run it after any change to the adapter or to a decision.
- The live harness needs `node`, `npm`, `claude`, `python3`, `tmux`, the seat's existing configuration, a `--cwd` with its own exact trust entry in the seat's configuration, and the directory of the second plugin the comparison loads (`--auto-effort-dir`). Claude Code does not inherit trust into subdirectories or nested repositories, so the repository checkout itself is usually untrusted. A directory Claude Code has not yet trusted stops at its native folder-trust prompt before the plugin loads: that run is NOT RUN, and the harness never bypasses the consent.
- A lane stays below the seat's auto-compact window: a real compaction of the lane's main session mid-lane is VOID, since a compacted lane proves nothing about the cache. `compactions()` in `scripts/live-check.py` records a `precompute` compact row (Claude Code's dispatch that installs nothing) a child-scoped one (`agentId`), or one whose `outcome` is `skipped` (a plugin's veto, such as sub-agent-compact's) or `failed`, in the evidence's `compactEvents` without voiding; a compact row without its `trigger` or `outcome` voids. Its launch prompt stays under 131,072 bytes, the single-argument limit, since the launch passes it to `claude` as one argv element.
- A prefix rewritten mid-lane is VOID too: `prefix_kept()` in `scripts/live-check.py` reads the lane transcript's main-thread api-request records, each re-sending `keep` of its base request's messages and appending `tail`; one keeping fewer than its base sent reads `VOID prefix rewritten mid-lane: request {id} kept {k} of {n} messages`, and missing or malformed records read `NOT RUN: main-thread request records missing` or `NOT RUN: main-thread request record malformed`.
- A plugin reloading mid-wait (an installed plugin's update) makes Claude Code re-render the environment block in `messages[1]`, measured; no plugin, setting or seat change runs on the machine while a lane runs, and a voided lane does not count toward the publish bar.
- The evidence directory is the `--output` argument or a temporary directory outside the repository; no run output is written in the repository.
- A returned-wait capture checks that the `cache-keepwarm · waiting on` status cleared, never that every `cache-keepwarm` string is gone: a toast carries the same prefix.
- A lane starts with a `need` prelude (exact Claude Code version, function hooks on, plugin loaded); a missing need prints `ERROR {need}` and exits 2, a lane not run reads `NOT RUN`, never a pass.
- Every live checker rejects an API or auth error first (synthetic or error-flagged model reply, debug-log API error), then checks model and usage; an invalid run reports `VOID`, never a measured failure.
- A poke turn (its `Keep-warm poke` prompt up to the next prompt) is the plugin's own traffic: `poke_turns()` in `scripts/live-check.py` takes it out of the quiet window, its auto-effort steps are allowed, and its text is checked exactly, header, one bullet per tracked id and footer.
- Every chat a lane starts is killed at the end, pass or fail; a failed kill prints `CLEANUP FAILED {session}` and exits 2.
- A run stopped by SIGTERM, SIGHUP or SIGINT still kills its chats: `stop_on_signals()` in `scripts/live-proof.py` turns the signal into `Stopped`, each lane's finally runs its cleanup (a signal during a cleanup waits for it), no later lane starts, and the run prints `STOPPED live: signal {n} in {mode}; later lanes not run` and exits 128+n.
- SIGKILL cannot be caught and leaves the lane chats running on the seat, each in its own tmux server on the socket `kw-{lane}-{id}`: list them with `ls "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)" | grep '^kw-'`, then stop each with `tmux -L {socket} kill-server`.
- Publish-ready needs three clean serial `--all` sequences (wait-return, cap, collision, stale, all at 5m) plus one clean `--lane ttl-1h` (about 70 minutes, never part of `--all`), all on the final tree. Fewer is a named gap in the report; a gate you did not watch run is never reported as run.

## Rules

- **Credentials stay in the seat:** a live lane runs on the invoking user's own Claude configuration. NEVER copy a credentials file and NEVER create an alternate `CLAUDE_CONFIG_DIR`; isolation is the lane's working directory and plugin directory.
- A new behaviour lands in `plugins/cache-keepwarm/src/` as a pure function with a test watched failing first; the adapter only wires it.
- `decision.ts` owns every fire, skip and stop, each with a stable reason code; the adapter holds no policy condition that duplicates it.
- Spend, allowance, protected rewrite and estimated net come from `budget.ts` only; the session state JSON, `/keepwarm`, the log and the closing line render those numbers. Costs are input-token equivalents; no USD without a verified engine price.
- A closing net saving is labelled an estimate; unknown usage is unknown, never zero.
- Wait timing comes from structured facts only; an unknown ETA is `unknown`, never inferred from task or command text.
- A label enters the poke text only sanitized (`sanitizeLabel`), and never the log or a reason code.
- The 1h cache is admitted (`WARM_1H = true` in `plugins/cache-keepwarm/src/schedule.ts`): a live `--lane ttl-1h` run on Claude Code 2.1.302 measured one request at 80% of the 1h lifetime refreshing the entry over a 4,017 s main-chat wait; a 1h wait carried by a poke is not yet live-measured.
- On a Claude Code release where the 1h refresh has not been re-measured, the claim stays labelled "measured on 2.1.302"; a failed rerun sets `WARM_1H = false` and the status reads `not warming: 1h refresh unproven`.
- A poke is a real request of its thread, so it re-anchors at that thread's own lifetime; the main chat's poke goes through `$.prompt.submit` and its turn is the poke's from `turn.start` to `turn.complete`, which charges its usage once.
- A poke counter is keyed per thread by the sorted set of pending ids (`plugins/cache-keepwarm/src/pokes.ts`); a poke and its reply never reset it, real activity always does.
- Persistence restores only validated last-use and numeric ledger metadata for the same session id; never the `/keepwarm` override, a timer, an admission or a grant. A refused record or a failed store is shown, never silent.
- Every option is also a variable `CACHE_KEEPWARM_{OPTION}`, upper snake, listed in the README § Configuration table: variable > option (`/config`) > default; unset or blank is absent; booleans `1|0|true|false`, any case. A bad variable is named in the status and the option's default applies, never the configured option.
- A new option adds its variable to `plugins/cache-keepwarm/src/options.ts` and the adapter's `readOptionEnv`, its README row, its `userConfig` key and its row in `tests/options.test.ts`.
- Claude Code's TTL variables (`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` and the rest) are Claude Code's own, read by the plugin and never plugin options, so the `CACHE_KEEPWARM_{OPTION}` rule leaves them out. Claude Code's `subagentPromptCacheTtl` setting is not read: a copy only that setting makes 1h is timed as 5m, early, never late.
- `$` is passed only to functions declared at the top level of the hooks file and always spelled `$.noun.event(...)`, and `$.env` names are string literals: Claude Code checks this statically and otherwise loads the module with zero hooks. `npm run validate:plugin` catches it.
- One glossary in code, tests and docs: wait, waiting item, episode, poke, request, epoch, send anchor, poke limit. No "ping", "keepalive" or "job".
- A claim about Claude Code's behaviour in the README states what was measured; a claim not re-measured on a new release is labelled so.
- A version bump moves `plugins/cache-keepwarm/.claude-plugin/plugin.json`, the root `.claude-plugin/marketplace.json`, `package.json` and the README badge together; installed copies update only on a new version.
- Public repo: no machine-absolute path, personal data or private project name in a tracked file.

## Branches and releases

- `develop` is the default branch: every change lands there, by a commit or a pull request. No CI runs on a push to any branch: `.github/workflows/release.yml` runs only on a pull request to `main`. `develop` is protected by the ruleset `develop keeps its history`: never force-push or delete it.
- `main` is release-only (ruleset `main is release-only`). It moves only by merging the `develop → main` pull request, with a merge commit and never a squash, so both branches share one history, and only after `check` and `release` pass: never a direct push, never an admin override. The marketplace installs the plugin from `main` (`git-subdir`, `ref: main`), so users only ever get a released version.
- A release, in order:
  1. On `develop`: bump the version in all four places, and move `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] — date`. Every merge into `main` publishes, so a pre-release suffix (`-dev.N`, `-alpha`) becomes the real release version here.
  2. `git fetch origin main`, then `make release-check` passes.
  3. Open the `develop → main` pull request. Its `check` and `release` checks run the same make targets; `release` requires the version to have moved past `main`'s.
  4. Merge once the checks are green. The merge is the release: `release.yml`'s `publish` job tags the merge commit `cache-keepwarm--vX.Y.Z` and publishes the GitHub release from the CHANGELOG section. A tag is never pushed by hand.
- Semantic versioning: a fix is a patch; a new option or behaviour is a minor; a renamed or removed option or argument is a major, and its CHANGELOG entry says how to migrate.
- Publishing: code is pushed, and a release is cut, only when the owner asks in the current request; a green gate is never that ask.
- Git writes go through this repo's gitter, `.claude/agents/gitter.md`.
