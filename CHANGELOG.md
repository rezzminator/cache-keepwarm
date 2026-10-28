# Changelog

Every release of cache-keepwarm. Versions follow [semantic versioning](https://semver.org); each release is the `main` commit tagged `cache-keepwarm--v<version>`, with a GitHub release carrying the section below.

## [Unreleased]

### Changed

- Installs as `cache-keepwarm@professor` from the professor marketplace; the repo's own marketplace file is gone.
- The decision log follows the plugin log contract: it writes `errors.jsonl`, `warnings.jsonl` and `info.jsonl` under `$PLUGIN_LOG_DIR/cache-keepwarm` when `PLUGIN_LOG_DIR` is set, else `~/.local/state/cache-keepwarm/logs`, in rows of `ts`, `plugin`, `level`, `event`, `msg`, `where`, `session` and `detail` (the old row is the `detail`), directory `0700`, files `0600`, at most 4096 bytes a row, a level file past 20 MiB moved to `.1` with a `log-capped` row. It is on by default and appends, where the old log rewrote one `{session id}.{instance}.jsonl` of at most 500 rows.
- The screen shows only errors and one line per failing streak (the log is off or failing), re-armed by the next successful write. A sub-agent poke that did not settle is a warning row, no longer a toast.

### Removed

- The `logDir` option, `CACHE_KEEPWARM_LOG_DIR` and the `logDir` `userConfig` key: a plugin-specific location must not override `PLUGIN_LOG_DIR`. To migrate, set `PLUGIN_LOG_DIR` to the directory that held the logs; they now sit in its `cache-keepwarm` subdirectory.
- The log directory pinning and the link/leaf refusals (`log directory moved`, `log target is a link or not a regular file`): the append script creates the directory `0700` and appends to its own level files.

## [0.5.0] — 2026-10-27

### Added

- `status` option (`CACHE_KEEPWARM_STATUS`, default `true`): off, the plugin paints no waiting or stopped status text under the prompt, only problems (bad options, a failed log write), for a status line that renders the session-state JSON instead. `/keepwarm status` and the session-state JSON are unaffected.

### Fixed

- A sub-agent's own compaction no longer cancels the main chat's warm. Every compaction reset the main chat's anchors and pending poke, so a long-running sub-agent that compacted mid-wait left the main chat unwarmed until its next turn ended, and its cache went cold. A compaction carrying an `agentId` now resets only that sub-agent's anchor; the main chat's own compaction resets as before.

## [0.4.1] — 2026-10-19

### Fixed

- A resumed chat no longer paints `cache-keepwarm: resumed: fresh tracked Stop required` in the status line: `resumed` is a resting state like `idle`, so it paints nothing. `/keepwarm status` and the session-state JSON still report `resumed`.

## [0.4.0] — 2026-10-19

### Added

- Atomic v1 main-session JSON for external status-line readers, under the XDG state sessions directory or `CACHE_KEEPWARM_STATE_DIR`. The public README specifies all fields, reason mappings, Claude PID liveness and session-end cleanup. Writer failures log the path and full error without interrupting chat.
- A single-chat live `state` lane proving the v1 write and `/keepwarm off` replacement, with prompt suggestions disabled.

### Removed

- The in-chat band, its Box/Text/Button renderer, `band` option and `CACHE_KEEPWARM_BAND`. Migration: delete the option or variable; use the external session-state JSON and `/keepwarm on|off|status` instead. Pokes, the existing status text and command remain.

## [0.3.0] — 2026-10-19

### Changed

- The main chat is kept warm by a visible poke: a real prompt submitted into the chat through `$.prompt.submit`, shown in the transcript and answered by one real turn at the chat's model and effort. It replaces the invisible `$.model.fork` replay, which is removed with its rewrite accounting (`entryAfterWarm`, `entryTtl`, the `rewrite` log row) and its sub-agent-lifetime timing. It is still never sent while a turn runs or the user is typing.
- One poke message for the main chat and sub-agents: `Keep-warm poke {n}/{N}`, one bullet per pending item with its kind, real task id, sanitized label and elapsed time, asking the model to stop anything stale or started by accident, else to reply `waiting`. The sub-agent "no tool call" instruction is gone: a poked model may stop the work.
- The budget forecast of a poke is the thread's previous poke's actual cost, floored at the context read, the unwritten tail and the poke written and a 1,000-token reply; a sub-agent poke adds its parent wake (parent context × 0.1 + (150 + 1000) × 2 + 1000 × 5). Actual usage is charged once, from the poke turn's own usage.
- `subagents` defaults to `true`. Each sub-agent poke makes Claude Code hand the spawning parent an interim task-notification, one real parent turn per poke; the forecast counts it and no notification is filtered.
- Log rows: the main chat's charged poke is a `poke` row (was `fork`), and every row carries its wait's `pokes` count and cap.

### Added

- `maxPokes` (default 4, an integer of at least 1) and `CACHE_KEEPWARM_MAX_POKES`: the most pokes one thread, the main chat or one sub-agent, gets while its sorted set of pending ids is unchanged and nothing else happens. A user prompt, a real turn, an item finishing or a new item appearing starts a fresh count; a poke and its own reply do not. A reached cap reads `poke limit reached {n}/{N}` in the status, `/keepwarm` and the log (`poke-limit`), and a later different wait gets its own pokes. Counts are in memory per thread.
- `subagentMinContext` (default 100000) and `CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT`: the smallest sub-agent context worth a poke and its parent wake; `minContext` (20000) stays the main chat's.
- A live `cap` lane (`--lane cap`, part of `--all`): a cap of 2 over a wait long enough for 3 pokes.

### Removed

- `maxWaitMinutes` and `CACHE_KEEPWARM_MAX_WAIT_MINUTES`, with the lease reason codes: the poke cap supersedes them. Migration: delete the option or variable; set `maxPokes` to bound a long wait instead (at the 4-minute cadence, 4 pokes cover about 20 minutes of one unchanged wait).
- The `lease` lane of the live `stale` mode, which only proved the removed lease; `stale` keeps its killed-work lane.

## [0.2.0] — 2026-10-18

### Added

- Opt-in (off by default) independent waiting sub-agent episodes, timers and rewrite-saving budgets. Short real warm turns address only native `waiting` agents with attributable pending background work; foreground tools remain unreachable. Main-chat invisible replay behaviour is unchanged.
- `subagents` (default false; enable with `subagents: true` or `CACHE_KEEPWARM_SUBAGENTS=1`) and `CACHE_KEEPWARM_SUBAGENTS`, independent sub-agent TTL resolution, actual warm-turn usage accounting including thinking/output, and an observed-output forecast.
- Sub-agent count, labels, warms and spend in `/keepwarm` and the band; metadata-only `agentId` and `kind: subagent` log rows. `/keepwarm off` cancels every episode.
- A transcript/usage/log-judged `subagent-wait` warm/control live lane (`--lane subagent-wait`). One run on Claude Code 2.1.302 measured warm-turn cache reads of 99.6469% and 99.6778%, a nine-minute return at 98.9920% and a subagents-off control at 0%; a measurement, not a guarantee.
- Warm accounting verifies `turn.complete` and an exact own receipt in `session.messages` before charging or re-anchoring, because Claude Code 2.1.302 skips this plugin's start and step for its native send. The forecast of the next warm's output is `max(256, previous warm actual output)`.

### Known limits

- Sub-agent warming is opt-in because a warm can wake any spawning parent (main or nested) with a `K` notice and cause a separately charged parent turn outside the per-agent ledger, which can exceed the savings. No suppressor ships and every native delivery is preserved.
- Each sub-agent warm makes the native engine emit an interim `K` task-notification to the spawning parent (main chat or nested agent), which can start a parent turn and add cost outside the per-agent ledger. Suppression through `session.receive` was disproved live and removed; ordinary task notices are preserved. The warm instruction itself appears only in the agent's transcript.
- Sub-agent TTL priority: `FORCE_PROMPT_CACHING_5M=1`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H=1`, the observed 90%-read rule, then assumed 5m; the main TTL is separate.

### Fixed

- Empty-wait status prints `no current wait` once, not twice.
- A `session.compact` `precompute` dispatch, which installs nothing, no longer cancels a pending warm or drops the send anchors; every other trigger still resets. The `compact` log row is written once the compaction answers and records the metadata-only `trigger`, `agentId` and `outcome` (`installed`, `skipped` when a plugin vetoes it, `failed`).
- The live harness voids a lane only on a real compaction of its own main session: a `precompute`, child-scoped (`agentId`), vetoed (`outcome: skipped`) or failed compaction is recorded in the evidence's `compactEvents` and never voids; a `compact` row without its trigger or outcome still voids. Live lanes launch with `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`: Claude Code's prompt-suggestion request writes the conversation's cache after each turn and kept a control lane warm through a 12-minute wait.
- README public repository status and install guidance.

## [0.1.0] — 2026-10-17

Initial release candidate; not published. Live-gated on Claude Code 2.1.302: three clean `--all` sequences and one clean `ttl-1h` lane.

### Added

- Warming of the main chat's prompt cache while it waits on a tracked agent, shell command, Monitor or workflow: one invisible `$.model.fork` replay before expiry that adds nothing to the transcript and starts no turn. A 5m and a 1h cache are both warmed.
- A warm that reads under 90% of the context is accounted as a rewrite: its copy is timed on the lifetime Claude Code writes a replay at (the sub-agent lifetime), and the log records a `rewrite` row with `entryTtl`.
- Admission by one pure decision function: every fire, skip and stop carries a stable reason code. The chat is never warmed while a turn runs, while the user types, when the cache is cold or within 15 seconds of expiry, when nothing tracked can wake the chat, when the awaited work is known to return first, or when the forecast saving is marginal.
- One budget and ledger: a warm is admitted only while its forecast spend, with a 10% margin, stays under the rewrite it saves, and actual spend is accounted (the fork is uncapped, so an overrun is possible); actual spend, allowance, protected rewrite and an explicitly estimated net are shown on the band, in `/keepwarm` and in the log.
- `/keepwarm [on|off|status]`, answered by the plugin with no model turn and scoped to the chat; no argument is `status`.
- An optional row above the prompt (state dot, reason, wait, toggle, ledger), hidden for surveys and by the `band` option.
- Five options, each also a variable: `enabled` (`CACHE_KEEPWARM_ENABLED`), `minContext` (`CACHE_KEEPWARM_MIN_CONTEXT`), `maxWaitMinutes` (`CACHE_KEEPWARM_MAX_WAIT_MINUTES`), `logDir` (`CACHE_KEEPWARM_LOG_DIR`), `band` (`CACHE_KEEPWARM_BAND`).
- Same-session restore of the last-use anchor and the numeric ledger.
- Manual gates `npm test`, `npm run test:unit`, `npm run test:hooks`, `npm run typecheck`, `npm run validate:plugin`, `npm run check:structure`, `npm run release:check` and the live lanes `npm run live`.

### Known limits

- Managed organizations skip the user-installed `classic.Stop`, `session.compact` and `classic.PostModelSwitch` hooks unless the organization lists the plugin.
- The live lanes ran on Linux only; macOS and Windows are untested.
- 1h warming is measured on Claude Code 2.1.302 only.
- A plugin reload mid-wait makes Claude Code re-render the environment block, so the cached prefix is lost for the chat and the warm alike.
- The rewrite path is unit-tested, not provoked live.
- No hang detection, no cap on a replay's own output, no sub-agent waits.
