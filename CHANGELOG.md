# Changelog

Every release of cache-keepwarm. Versions follow [semantic versioning](https://semver.org); each release is the `main` commit tagged `cache-keepwarm--v<version>`, with a GitHub release carrying the section below.

## [Unreleased]

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
- A `session.compact` `precompute` dispatch, which installs nothing, no longer cancels a pending warm or drops the send anchors; every other trigger still resets. The `compact` log row records the metadata-only `trigger` and `agentId`.
- The live harness voids a lane only on a real compaction of its own main session: a `precompute` or child-scoped (`agentId`) compaction is recorded in the evidence's `compactEvents` and never voids; a `compact` row without its trigger still voids.
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
