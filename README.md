<div align="center">

# cache-keepwarm

**Keeps Claude Code prompt caches warm during background waits: invisible replays for the main chat, opt-in short real turns for waiting sub-agents, each under its own rewrite-saving budget.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Version](https://img.shields.io/badge/version-0.2.0-blue)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

</div>

> **Status.** Public at [rezzminator/cache-keepwarm](https://github.com/rezzminator/cache-keepwarm), with development on `develop`. Version 0.2.0 adds opt-in waiting sub-agent warming (`subagents`, default off). The 0.1.0 main-chat measurements are recorded below; they are not a claim that 0.2.0 has been published.

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [Why an invisible replay](#why-an-invisible-replay)
- [Commands](#commands)
- [The band](#the-band)
- [When it warms](#when-it-warms)
- [Status texts](#status-texts)
- [Configuration](#configuration)
- [TTL resolution](#ttl-resolution)
- [Budget and ledger](#budget-and-ledger)
- [Limits](#limits)
- [Development](#development)
- [Credits](#credits)

## What it does

Claude Code caches the prompt for 5 minutes or 1 hour. A chat that waits on a long background agent or command goes idle, the cache lapses, and the next request writes the whole context again.

When the main chat ends a turn with tracked work pending, cache-keepwarm arms one timer for 80% of the cache lifetime after the last request was sent. When it fires and the chat is still idle and still waiting, the plugin calls `$.model.fork`, which re-sends the main thread's last request unchanged, so the provider reads and thereby refreshes the cached prefix. The replay adds nothing to the transcript, starts no turn and fires no prompt, turn or step hook of another plugin (observed in one run). The fork itself is a hookable engine operation, so a plugin that hooks model calls can see it.

It waits on four kinds of tracked work: agents, commands, Monitors and workflows. The next main request (a completion notification, your prompt, anything) ends the episode before another warm can fire. With `subagents` enabled (off by default), sub-agents have independent episodes, timers and budgets: after an agent ends a turn with its own attributable background work pending, a short real message renews its cache. The plugin re-checks the native roster immediately before sending and addresses only `waiting` agents, never finished, idle, failed or killed agents. User typing and main-chat turns do not cancel an agent's episode. It is opt-in and off by default: a sub-agent warm can wake any spawning parent (the main chat or a nested agent) with an interim `K` task-notification, causing a real, separately charged parent model turn that the per-agent ledger does not count and that can exceed the savings.

## Install

Install the released version from the public repository (the marketplace pins `main`; unreleased development is on `develop`):

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
claude plugin marketplace add rezzminator/cache-keepwarm
claude plugin install cache-keepwarm@cache-keepwarm
```

In a chat, `/plugin install cache-keepwarm --marketplace rezzminator/cache-keepwarm` does it in one step.

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` also works in the `env` block of `settings.json`. The plugin is built against the plugin types of Claude Code 2.1.302 and needs a release with function hooks; function hooks are early access and may change between releases.

## Why an invisible replay

A visible prompt ("send a warm-up message") would be the literal reading of keeping a chat warm. This plugin replays the request instead, for these reasons:

- A visible warm adds two transcript rows each time and cache writes that compaction later carries.
- Other plugins plan a plugin-submitted prompt: an effort planner can change the next request's effort, a cache-keyed parameter.
- The plugin cannot drop its own stale queued prompt, because a plugin's own submit skips its calling hook.
- A visible reply can spend many output tokens on a small model; the replay's prompt is fixed text, `Cache keep-warm only. Reply exactly K. No tools.`, and carries no task label.

These reasons apply to the main chat. The fork API cannot target a sub-agent, so a waiting sub-agent instead receives one real message in its own transcript:

> Cache keep-warm: your prompt cache was about to expire and was kept alive because you are still waiting on {label} ({elapsed}). Nothing has changed. Reply exactly K and end your turn; do not call tools.

The label is sanitized to 40 characters (plus an ellipsis), with `your background work` when unknown. A foreign agent turn or notification ends that episode; only a locally admitted warm renews it. Other plugins can see this real turn and can affect its cache key.

Because main-chat replays add nothing to the conversation, the status line and the band say what is warmed and why.

## Commands

`/keepwarm` is answered by the plugin with no model turn and takes effect at once, for this chat only; nothing is written to a settings file.

| Form | Effect |
| --- | --- |
| `/keepwarm` | Print the state: on or off and whether that is the launch default or the override, the current wait, the latest decision, actual spend against the allowance, and live sub-agent count, labels, warms and spend |
| `/keepwarm status` | Same as no argument |
| `/keepwarm on` | Override a disabled launch default; warming waits for the next qualifying Stop |
| `/keepwarm off` | Cancel all main and sub-agent timers and end their episodes; an admitted replay still accounts its usage but cannot re-arm |

Any other argument prints the usage and changes nothing. A new session or `/clear` resets the override to the launch default (`enabled`).

## The band

One row above the prompt shows a cache-state dot, the reason or current wait, a toggle and the ledger. Its toggle runs the same operation as `/keepwarm on|off`. The row stays after a returned wait, showing the last outcome, and is skipped while a survey is shown. `band` set to `false` hides only the row; the status line, the command and the warming are unaffected.

After a returning wait, one closing toast gives the elapsed time, the actual cache-read percentage of the returning request and an explicitly estimated net saving. The last outcome stays in the band and in `/keepwarm`; the toast is never a model prompt or a transcript turn.

## When it warms

Every timer fire is a decision made by one pure function; each outcome (warm, skip, stop) carries a short reason code that is shown with the status and written to the log. It does not warm:

- while a main turn runs, or while you type: a draft edit invalidates the episode at once, and warming resumes only after the next qualifying main Stop;
- when the cache is cold, or within 15 seconds of expiry, a window too close for a request to land;
- when nothing tracked is pending, when everything pending is finished, killed or failed, or when the only tracked work is of a kind not known to wake the chat (such an item is shown, and refuses with `wake-unknown`);
- when work is known to return before the cache expires: known timing comes from structured facts only, and an unknown return time is shown as unknown, never guessed from a task description or a command's text;
- when the plugin's own wait window ends before the cache does;
- when every pending item has passed `maxWaitMinutes`;
- when the forecast saving is marginal, or the budget is spent (§ Budget and ledger);
- after a failure of the replay, with no retry.

The anchor for the timer is the last main request that read or wrote the cache; a response with no cache use invalidates earlier warmth instead of renewing it. The timer fires at 80% of the lifetime after that anchor; a candidate at or after the anchor plus the lifetime minus 15 seconds is refused as `expiry-safety`, and a fully expired cache as `cache-cold`.

## Status texts

The status line is one line, retexted once a minute while an episode is armed; a stop notice persists until the next main turn.

- Waiting: `cache-keepwarm · waiting on agent "Audit the release notes" +1 more · 9m · warms 2 · next in 3m`; an assumed lifetime appends `· TTL assumed 5m`; an elapsed time of 65 minutes reads `1h05m`.
- Not warming: `cache-keepwarm · not warming: context 19,999 tokens is under the 20,000 minimum`, `not warming: no main request seen since the plugin loaded`, `not warming: 1h refresh unproven`.
- Stopped: `cache-keepwarm · stopped:` followed by one reason: `agent "X" pending 180m with no result, liveness unknown` · `the next warm would cost more than the rewrite it saves (10 warms)` · `the cache had already lapsed (timer fired 4m late)` · `agent "X" was killed` · `warm failed (api-error 529)` · `timer failed ({message})` · `this Claude Code gives the Stop hook no background_tasks`.
- Log: `cache-keepwarm · log write failed ({message})` or `log write refused ({reason})`, shown once; warming continues. A refusal names `log directory moved`, `log directory is not a directory`, `log directory unresolved` or `log target is a link or not a regular file`.

Labels (an agent's description, a command line) are sanitized to 40 characters plus an ellipsis for display and sub-agent warm messages. They never enter the main fork prompt or metadata log. Sub-agent log rows carry `kind: "subagent"` and `agentId`, not message text.

## Configuration

Six options, set in the plugin's `/config` page or by variable:

| Variable | Option | Default | Meaning |
| --- | --- | --- | --- |
| `CACHE_KEEPWARM_ENABLED` | `enabled` | `true` | Warm at all; `/keepwarm` overrides it for one chat |
| `CACHE_KEEPWARM_MIN_CONTEXT` | `minContext` | `20000` | Smallest context in tokens worth warming |
| `CACHE_KEEPWARM_MAX_WAIT_MINUTES` | `maxWaitMinutes` | `180` | Minutes an item may stay pending, counted from its first sighting, before it stops justifying a warm |
| `CACHE_KEEPWARM_LOG_DIR` | `logDir` | empty | Directory for `{session id}.{instance}.jsonl`, a metadata-only decision log of at most 500 rows per Claude Code process; empty writes none |
| `CACHE_KEEPWARM_SUBAGENTS` | `subagents` | `false` | Opt in (`true` or `1`) to independent waiting sub-agent episodes; a warm may wake the spawning parent with `K` and cause a separately charged parent turn outside the ledger. Off leaves the main-chat path unchanged |
| `CACHE_KEEPWARM_BAND` | `band` | `true` | Show the row above the prompt |

Precedence is variable, then option, then default. A blank variable is absent; booleans read `1`, `0`, `true` or `false` in any case. A bad variable is named in the status and the option's default applies, never the configured option. The log never contains a label, command or description.

The log directory must be private to you. The plugin resolves it once and pins that resolution, refusing to write if it later moves, and it refuses a leaf that is a link or not a regular file. Claude Code offers a plugin no write that refuses to follow a link, so a directory that other users can write still leaves a gap between check and write. The `{instance}` is a random identifier per Claude Code process, so two processes on one session never share a log file.

Persistence keeps one snapshot per Claude Code process (`session:{session id}:{instance}`) of the last-use anchor and the numeric ledger, with its save time. A resumed session restores the newest valid snapshot for its own session id. Snapshots that are invalid, or older than seven days, are deleted when a session starts. A snapshot never restores the `/keepwarm` override, a timer, an admission or a grant. The plugin store is one JSON file shared by all processes; how concurrent writes from two processes interleave is unmeasured.

## TTL resolution

The cache lifetime is resolved per episode, first match wins:

1. `FORCE_PROMPT_CACHING_5M=1`: 5m.
2. `CLAUDE_CODE_PROMPT_CACHE_TTL` equal to `5m` or `1h`: that value.
3. The session's observed lifetime: a request sent 330,000 to 3,300,000 ms after the previous one that read at least 90% of the previous context means 1h; below 90% means 5m; outside that gap there is no evidence.
4. `ENABLE_PROMPT_CACHING_1H=1`: 1h.
5. Otherwise 5m, shown as `TTL assumed 5m`. An assumed 5m is never late, only more frequent.

Sub-agents resolve independently: `FORCE_PROMPT_CACHING_5M=1`, then `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (`5m|1h`), then `ENABLE_PROMPT_CACHING_1H=1`, then that agent's observed lifetime using the same 90%-read rule, otherwise assumed 5m. The main-chat TTL variable does not set a sub-agent's TTL.

A main-chat warm keeps that lifetime while it reads at least 90% of the context: the replay refreshed the entry the chat already had. A warm that reads less rewrote the entry (the prefix changed under the chat, or the entry was gone), and Claude Code writes a replay at its sub-agent lifetime, not the main chat's: `FORCE_PROMPT_CACHING_5M=1` gives 5m, then `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` equal to `5m` or `1h`, then `ENABLE_PROMPT_CACHING_1H=1` gives 1h, otherwise 5m. The next warm is timed on that copy's lifetime, and the log writes a `rewrite` row carrying `entryTtl`. Claude Code's `subagentPromptCacheTtl` setting is not read, so a copy that only the setting makes 1h is timed as 5m: early, never late. The order is read from the Claude Code 2.1.302 source; the rewrite path is unit-tested, not provoked live.

## Budget and ledger

One producer owns the arithmetic. Costs are input-token equivalents (read 0.1, cache write 1.25 at 5m and 2.0 at 1h, plain input 1, output 5), not dollars; USD appears only if the engine exposes a verified price.

- Saved by one avoided rewrite: `context × (write − 0.1)`.
- Spent by a warm, from the replay's usage: `read × 0.1 + creation × 2.0 + input × 1 + output × 5`.
- Forecast of the next warm: `context × 0.1 + tail × 2.0 + 64 + 256 × 5`, where `tail` is the last response's output tokens on the episode's first warm and 0 after.
- A warm is allowed while `spent + forecast ≤ saved` and `saved − spent − forecast ≥ 0.1 × forecast`, so a warm whose saving is marginal is declined.

Worked example, a 5m cache on Haiku with a 50,552-token context and the usage shape of a replay that read 49,745 tokens, wrote 807, took 25 plain input tokens and produced 3 output tokens:

- One rewrite saved: 58,134.8.
- First warm: forecast 8,013.2, actual spend 6,628.5.
- Later warms forecast 6,399.2; ten warms spend a total of 52,485.3.
- The eleventh would reach 58,884.5, above 58,134.8: refused with `the next warm would cost more than the rewrite it saves (10 warms)`.

Each sub-agent uses the same ledger arithmetic independently. Its actual warm-turn usage (including thinking/output) is summed once at `turn.complete`. Claude Code 2.1.302 skips this plugin's start and step hooks for the plugin's own native send, so a warm is charged and re-anchored only after the actual `turn.complete` and an exact own receipt in `session.messages` (a raw message or a measured coordinator envelope) are verified. The next forecast replaces the 256-output allowance with `max(256, previous warm output_tokens)`; it never assumes a three-token answer. A cold warm or unknown usage ends the episode rather than claiming cache protection.

The budget is an admission forecast plus actual accounting, not a hard realized-spend limit: the engine's fork is uncapped, so an admitted replay can cost more than forecast (a longer reply, a larger write), and the episode then stops at the next check. A wait that outlasts the budget still ends in a rewrite.

The band, `/keepwarm`, the log and the closing toast show the same ledger: actual spend, the allowance (write minus read saving), and `protecting`, the gross cost of the rewrite the warm may avoid. `protecting` is hypothetical, not a realized saving. The closing net is an estimate, not a measured counterfactual: it credits one avoided rewrite minus warm spend only for a same-prefix return after the original expiry with at least 90% cache read. A return before the original expiry, or a miss, closes at minus the spend; unknown usage closes as unknown, never zero.

## Limits

- No hang detection. Claude Code exposes no activity time for a task, so a pending item is "liveness unknown" once `maxWaitMinutes` passes; it is never declared hung.
- No cap on a replay. The engine's fork has no output cap or cancel, so the budget is a forecast before each replay plus actual accounting after; there is no hard realized-spend limit, and an admitted replay cannot be cancelled.
- Sub-agent warming reaches only idle loops held on attributable pending background work. A foreground tool call cannot be warmed. Ownership comes from that agent's successful background tool results or native child-parent links, not the session-wide Stop task list. Missing attribution refuses warming. The warm instruction is a real turn in the sub-agent's transcript only, and never appears in the main chat's transcript; a native send queues a message, not a guaranteed model response. A warm not settled within one minute stops that episode.
- Opting in accepts collateral parent cost. Each sub-agent warm can wake whichever parent spawned the agent, main chat or nested agent, and the native engine emits an interim `K` task-notification to that spawning parent, not always the main chat, for every agent warm, which can start a parent turn and add cost; the per-agent ledger does not account that collateral parent turn, which can exceed the savings. No suppressor ships: the producer exposes no per-warm token tying a task notice to an admission, native `session.receive` interception already failed live, and filtering `K` by text could swallow real nested child results. Every native delivery is preserved. The default stays off until exact correlation and a zero-parent-request native acceptance are proven. Sub-agent warming is not invisible and does not avoid waking the parent.
- No wait on the user. Only tracked background work warms the cache.
- 1h warming is measured on Claude Code 2.1.302 only. Two live `ttl-1h` runs held a wait of over 4,000 seconds on a 1h cache: one replay at 80% of the lifetime read all but two tokens of the context from cache, and the returning request read about 98.8% (§ Development). A release where the refresh is not re-measured keeps the claim labelled so; a failed rerun turns 1h warming off, and a 1h episode then shows `not warming: 1h refresh unproven`.
- A plugin reload rewrites the cached prefix. When a plugin reloads mid-wait (observed after an installed plugin was updated), Claude Code re-renders the environment block near the start of every request (measured on 2.1.302: 48,126 to 49,901 characters), so the cache is lost for the chat and the warm alike. The warm then pays a rewrite, the ledger accounts it, and the episode re-times on the copy's lifetime (§ TTL resolution).
- Unknown wake behaviour. Claude Code gives a task no expected return time and no flag saying whether it can wake the chat; the plugin treats the four known kinds as waking and refuses the rest.
- A shell or Monitor killed from the UI while the chat is idle may send no notification; its item is warmed until `maxWaitMinutes` or the budget ends.
- Whether Claude Code's idle compaction counts a replay as activity at 1h is untested.
- Replay spend is invisible to tools that read assistant rows only.
- Managed organizations: a Claude Code managed by an organization skips a user-installed plugin's `classic.Stop`, `session.compact` and `classic.PostModelSwitch` hooks unless the organization lists the plugin, so warming and episode ends do not run there.
- The live lanes are exercised on Linux only; macOS and Windows are untested.

## Development

```sh
npm ci
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
npm test               # vitest, then claude plugin test
npm run typecheck
npm run validate:plugin
npm run check:structure
npm run release:check
npm run live -- --lane wait-return --cwd <trusted-dir> --auto-effort-dir <path> --output <outside-repo-path>   # also subagent-wait, ttl-1h, collision, stale; or --all
```

`--lane subagent-wait` runs a warm/control pair: each real Haiku sub-agent owns a 540-second background shell. The checker requires warm turns and the notification return to read at least 90% from cache, no warm tool call, no main warm text, native admission/usage rows, and a subagents-off control returning below 20%. It leaves the seat's other installed plugins enabled.

One live `subagent-wait` run on Claude Code 2.1.302, on the invoking seat's configuration with its other enabled plugins (an effort controller and a loaded auto-effort among them), measured: two warm turns read 99.6469% and 99.6778% from cache, the return after nine minutes read 98.9920%, and the control with sub-agent warming off read 0%. Native usage-log rows matched both warm turns, no warm tool ran, and the main transcript held no warm instruction text. These are measurements of that run, not a guarantee.

The unit gates (decisions, and the function-hook tests on a stand-in and on the testing kit) are unit fidelity; there is no hermetic end-to-end tier. The live lanes boot a real Claude Code on the invoking user's own configuration with the plugin loaded through `CLAUDE_CODE_PLUGIN_DIRS` and Claude Code's prompt suggestion off (`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`: its request after each turn writes the conversation's cache, so a control lane would not go cold), never copy credentials, and judge transcript usage and log rows, never a model's statement. The checker voids a lane, never passes or fails it, on an API or auth error, a real compaction of the lane's main session mid-lane (a `precompute`, a sub-agent's own compaction, or one a plugin vetoed or that failed is recorded, never voided), or a main request that keeps fewer messages of its base request than the base sent: Claude Code rewrote the prefix mid-lane (§ Limits, plugin reload), so the lane proves nothing about the cache. A release needs three clean serial `--all` sequences and one clean `--lane ttl-1h` on the final tree; a voided lane does not count.

0.1.0 on Claude Code 2.1.302, Haiku, Linux:

| Sequence | Warm return read | Control return read | Collision | Stale |
| --- | --- | --- | --- | --- |
| `--all` 1 | 98.9% | 0.0% | pass | pass |
| `--all` 2 | 98.7% | 0.0% | pass | pass |
| `--all` 3 | 98.7% | 0.0% | pass | pass |

The `ttl-1h` lane held a 4,013-second wait on a 1h cache: one replay 2,880 seconds after the anchor read 56,148 of 56,150 tokens from cache, and the returning request read 98.7%. `CLAUDE.md` is the testing manual.

The live harness needs `node`, `npm`, `claude`, `python3`, `tmux`, the chat launcher `pfm`, the user's existing Claude configuration, a working directory with its own trust entry in Claude Code passed as `--cwd`, and the directory of the second plugin used for the comparison. The evidence directory is the `--output` argument or a temporary directory outside the repository. The band stays after a returned wait, so a capture checks that the waiting status cleared, not that every plugin name is gone.

## Credits

- [claude-cache-warm](https://github.com/FiredMosquito831/claude-cache-warm) (MIT): skip a warm once the cache has expired, a minimum context, supersede by newer activity.
- [cache-keepwarm by mupamuc](https://github.com/mupamuc/cache-keepwarm) (MIT): the row above the prompt with a toggle, the immediate `/keepwarm [on|off|status]` command, anchoring on a response that used the cache, the 15-second expiry safety, same-session restore.

This plugin differs from both by warming only while tracked work is pending, through main-chat invisible replays and waiting sub-agent turns, under independent budgets. Their licences are in `THIRD-PARTY-NOTICES`; this plugin is MIT licensed.
