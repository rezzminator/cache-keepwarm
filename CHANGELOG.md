# Changelog

Every release of cache-keepwarm. Versions follow [semantic versioning](https://semver.org); each release is the `main` commit tagged `cache-keepwarm--v<version>`, with a GitHub release carrying the section below.

## [Unreleased]

## [0.1.0] — 2026-10-17

Initial local build; not published. The repository has no remote, and no live proof sequence has gated this tree yet.

### Added
- Warming of the main chat's prompt cache while it waits on a tracked agent, shell command, Monitor or workflow: one invisible `$.model.fork` replay before expiry that adds nothing to the transcript and starts no turn.
- Admission by one pure decision function: every fire, skip and stop carries a stable reason code. The chat is never warmed while a turn runs, while the user types, when the cache is cold or within 15 seconds of expiry, when nothing tracked can wake the chat, when the awaited work is known to return first, or when the forecast saving is marginal.
- One budget and ledger: a warm is admitted only while its forecast spend, with a 10% margin, stays under the rewrite it saves, and actual spend is accounted (the fork is uncapped, so an overrun is possible); actual spend, allowance, protected rewrite and an explicitly estimated net are shown on the band, in `/keepwarm` and in the log.
- `/keepwarm [on|off|status]`, answered by the plugin with no model turn and scoped to the chat; no argument is `status`.
- An optional row above the prompt (state dot, reason, wait, toggle, ledger), hidden for surveys and by the `band` option.
- Five options, each also a variable: `enabled` (`CACHE_KEEPWARM_ENABLED`), `minContext` (`CACHE_KEEPWARM_MIN_CONTEXT`), `maxWaitMinutes` (`CACHE_KEEPWARM_MAX_WAIT_MINUTES`), `logDir` (`CACHE_KEEPWARM_LOG_DIR`), `band` (`CACHE_KEEPWARM_BAND`).
- Same-session restore of the last-use anchor and the numeric ledger.
- Manual gates `npm test`, `npm run test:unit`, `npm run test:hooks`, `npm run typecheck`, `npm run validate:plugin`, `npm run check:structure`, `npm run release:check` and the live lanes `npm run live`.

### Known limits
- A 1h cache is not warmed: whether a replay refreshes a 1h entry is unproven, and the status reads `not warming: 1h refresh unproven`.
- No hang detection, no cap on a replay's own output, no sub-agent waits.
