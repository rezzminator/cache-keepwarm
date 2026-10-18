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
- `npm run live` is `scripts/live-proof.sh`: a real Haiku (`claude-haiku-5-5`) chat per lane, plugin loaded through `CLAUDE_CODE_PLUGIN_DIRS` in the process environment. Invocation: `npm run live -- --lane wait-return --cwd <trusted-dir> --auto-effort-dir <path> --output <outside-repo-path>`; `ttl-1h`, `collision`, `stale` and `--all` (wait-return, collision, stale) are the other modes. Run it after any change to the adapter or to a decision.
- The live harness needs `node`, `npm`, `claude`, `python3`, `tmux`, the chat launcher `pfm`, the seat's existing configuration, a `--cwd` with its own exact trust entry in the seat's configuration, and the directory of the second plugin the comparison loads (`--auto-effort-dir`). Claude Code does not inherit trust into subdirectories or nested repositories, so the repository checkout itself is usually untrusted. A directory Claude Code has not yet trusted stops at its native folder-trust prompt before the plugin loads: that run is NOT RUN, and the harness never bypasses the consent.
- A lane stays below the seat's auto-compact window: a real compaction of the lane's main session mid-lane is VOID, since a compacted lane proves nothing about the cache. `compactions()` in `scripts/live-check.py` records a `precompute` compact row (Claude Code's dispatch that installs nothing) or a child-scoped one (`agentId`) in the evidence's `compactEvents` without voiding; a compact row without its `trigger` voids. Its launch prompt stays under 131,072 bytes, the single-argument limit, since the launcher passes it as one argv element.
- A prefix rewritten mid-lane is VOID too: `prefix_kept()` in `scripts/live-check.py` reads the lane transcript's main-thread api-request records, each re-sending `keep` of its base request's messages and appending `tail`; one keeping fewer than its base sent reads `VOID prefix rewritten mid-lane: request {id} kept {k} of {n} messages`, and missing or malformed records read `NOT RUN: main-thread request records missing` or `NOT RUN: main-thread request record malformed`.
- A plugin reloading mid-wait (an installed plugin's update) makes Claude Code re-render the environment block in `messages[1]`, measured; no plugin, setting or seat change runs on the machine while a lane runs, and a voided lane does not count toward the publish bar.
- The evidence directory is the `--output` argument or a temporary directory outside the repository; no run output is written in the repository.
- The band stays after a returned wait by design, so a capture checks that the waiting status cleared, never that every `cache-keepwarm` string is gone.
- A lane starts with a `need` prelude (exact Claude Code version, function hooks on, plugin loaded); a missing need prints `ERROR {need}` and exits 2, a lane not run reads `NOT RUN`, never a pass.
- Every live checker rejects an API or auth error first (synthetic model reply, fork `api-error`, debug-log API error), then checks model and usage; an invalid run reports `VOID`, never a measured failure.
- Every chat a lane starts is killed at the end, pass or fail; a failed kill prints `CLEANUP FAILED {session}` and exits 2.
- A run stopped by SIGTERM, SIGHUP or SIGINT still kills its chats: `stop_on_signals()` in `scripts/live-proof.py` turns the signal into `Stopped`, each lane's finally runs its cleanup (a signal during a cleanup waits for it), no later lane starts, and the run prints `STOPPED live: signal {n} in {mode}; later lanes not run` and exits 128+n.
- SIGKILL cannot be caught and leaves the lane chats running on the seat; find them with `pfm chat ls --all | grep kw-`, since plain `pfm chat ls` lists only the current directory's repository and lanes run in `--cwd`.
- Publish-ready needs three clean serial `--all` sequences (wait-return, collision, stale, all at 5m) plus one clean `--lane ttl-1h` (about 70 minutes, never part of `--all`), all on the final tree. Fewer is a named gap in the report; a gate you did not watch run is never reported as run.

## Rules

- **Credentials stay in the seat:** a live lane runs on the invoking user's own Claude configuration. NEVER copy a credentials file and NEVER create an alternate `CLAUDE_CONFIG_DIR`; isolation is the lane's working directory and plugin directory.
- A new behaviour lands in `plugins/cache-keepwarm/src/` as a pure function with a test watched failing first; the adapter only wires it.
- `decision.ts` owns every fire, skip and stop, each with a stable reason code; the adapter holds no policy condition that duplicates it.
- Spend, allowance, protected rewrite and estimated net come from `budget.ts` only; the band, `/keepwarm`, the log and the closing line render those numbers. Costs are input-token equivalents; no USD without a verified engine price.
- A closing net saving is labelled an estimate; unknown usage is unknown, never zero.
- Wait timing comes from structured facts only; an unknown ETA is `unknown`, never inferred from task or command text.
- A label is display-only: it never enters the fork prompt, the log or a reason code.
- The 1h cache is warmed (`WARM_1H = true` in `plugins/cache-keepwarm/src/schedule.ts`): a live `--lane ttl-1h` run on Claude Code 2.1.302 measured one replay at 80% of the 1h lifetime refreshing the entry — a 4,017 s main-chat wait, one fork at +2,879 s, a return reading 98.9% of its context from cache.
- On a Claude Code release where the 1h refresh has not been re-measured, the claim stays labelled "measured on 2.1.302"; a failed rerun sets `WARM_1H = false` and the status reads `not warming: 1h refresh unproven`.
- A warm's own cache write takes the sub-agent lifetime, since Claude Code sends a `$.model.fork` replay as a non-main query source: `FORCE_PROMPT_CACHING_5M=1` → 5m, else `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (`5m|1h`), else `ENABLE_PROMPT_CACHING_1H=1` → 1h, else 5m (`warmWriteTtl` in `plugins/cache-keepwarm/src/ttl.ts`, read from the Claude Code 2.1.302 source).
- A warm reading at least 90% of the context refreshed the entry at its own lifetime; one reading less rewrote it (`entryAfterWarm`): the send anchor carries `entryTtl`, the next fire and the decision use `anchor.entryTtl` before the episode's resolved TTL, and the adapter logs a `rewrite` row. The rewrite path is unit-proven only, not provoked live.
- Persistence restores only validated last-use and numeric ledger metadata for the same session id; never the `/keepwarm` override, a timer, an admission or a grant. A refused record or a failed store is shown, never silent.
- Every option is also a variable `CACHE_KEEPWARM_{OPTION}`, upper snake, listed in the README § Configuration table: variable > option (`/config`) > default; unset or blank is absent; booleans `1|0|true|false`, any case. A bad variable is named in the status and the option's default applies, never the configured option.
- A new option adds its variable to `plugins/cache-keepwarm/src/options.ts` and the adapter's `readOptionEnv`, its README row, its `userConfig` key and its row in `tests/options.test.ts`.
- Claude Code's TTL variables (`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` and the rest) are Claude Code's own, read by the plugin and never plugin options, so the `CACHE_KEEPWARM_{OPTION}` rule leaves them out. Claude Code's `subagentPromptCacheTtl` setting is not read: a copy only that setting makes 1h is timed as 5m, early, never late.
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
