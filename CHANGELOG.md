# Changelog

Every release of cache-keepwarm. Versions follow [semantic versioning](https://semver.org); each release is the `main` commit tagged `cache-keepwarm--v<version>`, with a GitHub release carrying the section below.

## [Unreleased]

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
