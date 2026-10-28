<div align="center">

# cache-keepwarm

**Keeps Claude Code prompt caches warm during background waits with visible pokes, for the main chat and waiting sub-agents, capped per wait and each under its own rewrite-saving budget.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Version](https://img.shields.io/badge/version-0.5.0-blue)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

</div>

> **Status.** Public at [rezzminator/cache-keepwarm](https://github.com/rezzminator/cache-keepwarm), with development on `develop`. Version 0.5.0 keeps waits warm with visible pokes, at most `maxPokes` per unchanged wait, and pokes waiting sub-agents by default. Its live measurements are recorded below; they are not a claim that 0.5.0 has been published.

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [The poke](#the-poke)
- [Commands](#commands)
- [Session state JSON](#session-state-json)
- [When it pokes](#when-it-pokes)
- [Status texts](#status-texts)
- [Configuration](#configuration)
- [TTL resolution](#ttl-resolution)
- [Budget and ledger](#budget-and-ledger)
- [Limits](#limits)
- [Development](#development)
- [Credits](#credits)

## What it does

Claude Code caches the prompt for 5 minutes or 1 hour. A chat that waits on a long background agent or command goes idle, the cache lapses, and the next request writes the whole context again.

When the main chat ends a turn with tracked work pending, cache-keepwarm arms one timer for 80% of the cache lifetime after the last request was sent. When it fires and the chat is still idle and still waiting, the plugin submits a poke into the chat through `$.prompt.submit`: a real prompt, shown in the transcript, which the model answers in one real turn at the chat's model and effort, thinking included. That request reads the cached prefix and so refreshes it. The poke turn re-anchors the timer, and the wait goes on.

It waits on four kinds of tracked work: agents, commands, Monitors and workflows. At most `maxPokes` pokes (default 4) go to one wait while its pending items stay the same and nothing else happens; real activity (your prompt, a real turn, an item finishing, a new item) starts a fresh count, so a chat that lives for days gets fresh pokes for each later wait. A completion notification or your prompt ends the episode before another poke can fire.

Waiting sub-agents (`subagents`, on by default) have independent episodes, timers, budgets and poke counts: after an agent ends a turn with its own attributable background work pending, the same poke goes to the agent itself. The plugin re-checks the native roster immediately before sending and addresses only `waiting` agents, never finished, idle, failed or killed agents. User typing and main-chat turns do not cancel an agent's episode. Each sub-agent poke makes Claude Code hand the spawning parent (the main chat or a nested agent) an interim task-notification, which starts one real parent turn per poke; the budget forecast counts that parent wake, and the plugin never filters it.

## Install

Install the released version from Professor's marketplace (unreleased development is on `develop`):

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
claude plugin marketplace add rezzminator/professor
claude plugin install cache-keepwarm@professor
```

In a chat, `/plugin install cache-keepwarm --marketplace rezzminator/professor` does it in one step.

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` also works in the `env` block of `settings.json`. The plugin is built against the plugin types of Claude Code 2.1.302 and needs a release with function hooks; function hooks are early access and may change between releases.

## The poke

The main chat and sub-agents get the same message, one bullet per pending item:

```text
Keep-warm poke 2/4: your prompt cache was about to expire, so this message keeps it warm while you wait on:
- agent `a1b2c3d4`: Audit the release notes, pending 8m
- command `b5e6f7a8`: npm run build, pending 3m
If any of these is stale or was started by accident, stop it now. Otherwise reply `waiting` and end your turn.
```

The kind is `agent`, `command`, `Monitor` or `workflow`; the id is the real task id Claude Code reports, so the model can stop that item. The label is sanitized to 40 characters (plus an ellipsis), with `your background work` when unknown; the elapsed time counts from the item's first sighting.

A poke is a real turn, so it costs what a turn costs at the chat's effort, and other plugins see it: it passes through their prompt and turn hooks with `origin` `{ kind: 'plugin', name: 'cache-keepwarm' }`, and an effort planner can change the poke turn's effort. The poke and its own reply are not activity: they neither end the wait nor reset its count.

## Commands

`/keepwarm` is answered by the plugin with no model turn and takes effect at once, for this chat only; nothing is written to a settings file.

| Form | Effect |
| --- | --- |
| `/keepwarm` | Print the state: on or off and whether that is the launch default or the override, the current wait, the latest decision (a reached cap as `poke limit reached 4/4`), actual spend against the allowance, and live sub-agent count, labels, pokes and spend |
| `/keepwarm status` | Same as no argument |
| `/keepwarm on` | Override a disabled launch default; poking waits for the next qualifying Stop |
| `/keepwarm off` | Cancel all main and sub-agent timers and end their episodes; a poke already submitted still accounts its usage but cannot re-arm |

Any other argument prints the usage and changes nothing. A new session or `/clear` resets the override to the launch default (`enabled`).

## Session state JSON

External status-line readers get one metadata-only file per **main session**, never a sub-agent view:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/cache-keepwarm/sessions/{sessionId}.json
```

`CACHE_KEEPWARM_STATE_DIR` overrides the sessions directory itself (an absolute path, not a parent). Blank is absent. This transport variable is not a `/config` option. Node.js 20+ must be on Claude Code's `PATH` for the file writer. A same-directory, exclusive temporary file (mode `0600`) is renamed atomically over the destination; new directories use `0700`. Writers serialize changes within the process, skip unchanged projections, and publish on main status changes and `/keepwarm on|off`. Files contain no task labels, command text, messages, or sub-agent views.

### v1 fields

| Field | Contract |
| --- | --- |
| `v` | Schema version, exactly `1` |
| `sessionId` | Main Claude session id; filename is `{sessionId}.json` |
| `pid` | Claude Code process PID, not the temporary writer PID |
| `updatedAt` | Epoch milliseconds when this projection is published |
| `enabled` | Effective launch default or session override, boolean |
| `source` | `launch` or `session` |
| `state` | `warming`, `on`, `stopped`, or `off` as below |
| `reason` | Stable `ReasonCode` as below; disabled always reports `off` |
| `pokes` | `{count,max}` for the main wait, or `null` if unavailable |
| `nextAt` | Scheduled future main poke, epoch milliseconds; `null` without a future due time |
| `protectingTokensEq` | Gross hypothetical rewrite cost from the current budget ledger; number or `null`, never a realized saving |

### State mapping

- `warming`: `eligible` or `in-flight`, only while the main view has waiting items. Without waiting items these reasons map to `on`.
- `stopped`: `poke-limit`, `budget`, `poke-failed`, `timer-failed`, `stale`, `ended`.
- `off`: `off`, or any view with `enabled: false` (its reason is normalized to `off`).
- `on`: `agent-not-waiting`, `busy`, `typing`, `inventory-unknown`, `nothing-pending`, `usage-unknown`, `usage-invalid`, `small`, `1h-unproven`, `cache-cold`, `expiry-safety`, `wake-unknown`, `cannot-wake`, `imminent`, `marginal`, `resumed`, `idle`.

`on` means enabled, not currently warming; it does not promise a warm cache. `nextAt` is `null` unless the state is `warming` with a future timer. Session end deletes the file, and any temporary a killed writer left for the session, including before `/clear` or resume changes the id; the replacement session publishes its own view. Abrupt termination can leave a file: readers must check the Claude PID's liveness, not expire by age (a quiet `on` session is legitimate). A reused PID passes a liveness check alone: a reader also requires the process to have started before `updatedAt`. Resuming the same session in two processes shares one filename; the last atomic writer wins.

A write or deletion failure logs the full destination path and error through the plugin's debug log and never throws into chat. The next changed view retries. `/keepwarm status` remains the direct in-chat inspection path. After a returning wait, the closing toast gives elapsed time, actual cache-read percentage and explicitly estimated net saving; the last outcome stays in `/keepwarm`.

## When it pokes

Every timer fire is a decision made by one pure function; each outcome (poke, skip, stop) carries a short reason code that is shown with the status and written to the log. It does not poke:

- while a main turn runs, or while you type: a draft edit invalidates the episode at once, and warming resumes only after the next qualifying main Stop;
- when the cache is cold, or within 15 seconds of expiry, a window too close for a request to land;
- when nothing tracked is pending, when everything pending is finished, killed or failed, or when the only tracked work is of a kind not known to wake the chat (such an item is shown, and refuses with `wake-unknown`);
- when work is known to return before the cache expires: known timing comes from structured facts only, and an unknown return time is shown as unknown, never guessed from a task description or a command's text;
- once this wait has had `maxPokes` pokes with its pending items unchanged and nothing else happening (`poke-limit`);
- when the forecast saving is marginal, or the budget is spent (§ Budget and ledger);
- after a poke failed (Claude Code dropped or refused it, or its turn failed), with no retry.

The anchor for the timer is the last main request that read or wrote the cache; a response with no cache use invalidates earlier warmth instead of renewing it. The timer fires at 80% of the lifetime after that anchor; a candidate at or after the anchor plus the lifetime minus 15 seconds is refused as `expiry-safety`, and a fully expired cache as `cache-cold`.

## Status texts

The status line is one line, retexted once a minute while an episode is armed; a stop notice persists until the next main turn.

- Waiting: `cache-keepwarm · waiting on agent "Audit the release notes" +1 more · 9m · pokes 2/4 · next in 3m`; an assumed lifetime appends `· TTL assumed 5m`; an elapsed time of 65 minutes reads `1h05m`.
- Not warming: `cache-keepwarm · not warming: context 19,999 tokens is under the 20,000 minimum`, `not warming: no main request seen since the plugin loaded`, `not warming: 1h refresh unproven`.
- Stopped: `cache-keepwarm · stopped:` followed by one reason: `poke limit reached 4/4` · `the next warm would cost more than the rewrite it saves (3 warms)` · `the cache had already lapsed (timer fired 4m late)` · `agent "X" was killed` · `poke failed (dropped: {reason})` · `timer failed ({message})` · `this Claude Code gives the Stop hook no background_tasks`.
- Log: `cache-keepwarm · plugin log {directory} failed: {message}; dropped {n} row(s)` or `plugin log off: no PLUGIN_LOG_DIR and no HOME; dropped {n} row(s)`, shown once per failing streak and re-armed by the next successful write; warming continues. Only an error reaches the screen; a lost warning or info row is not shown.

Labels (an agent's description, a command line) are sanitized to 40 characters plus an ellipsis for display and the poke text. They never enter the metadata log. Sub-agent log rows carry `kind: "subagent"` and `agentId`, not message text.

## Configuration

Six options, set in the plugin's `/config` page or by variable:

| Variable | Option | Default | Meaning |
| --- | --- | --- | --- |
| `CACHE_KEEPWARM_ENABLED` | `enabled` | `true` | Poke at all; `/keepwarm` overrides it for one chat |
| `CACHE_KEEPWARM_MIN_CONTEXT` | `minContext` | `20000` | Smallest main-chat context in tokens worth a poke |
| `CACHE_KEEPWARM_MAX_POKES` | `maxPokes` | `4` | Pokes per thread (the main chat, or one sub-agent) while its sorted set of pending ids is unchanged and nothing else happens; an integer of at least 1 |
| `CACHE_KEEPWARM_SUBAGENTS` | `subagents` | `true` | Poke waiting sub-agents in independent episodes; each poke also wakes the spawning parent for one real turn, which the forecast counts. Off leaves the main-chat path unchanged |
| `CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT` | `subagentMinContext` | `100000` | Smallest sub-agent context in tokens worth a poke and its parent wake |
| `CACHE_KEEPWARM_STATUS` | `status` | `true` | Show the waiting and stopped status text under the prompt; off paints only problems (bad options, a failed log write), for a status line that renders the session-state JSON instead. `/keepwarm status` and the JSON are unaffected |

Precedence is variable, then option, then default. A blank variable is absent; booleans read `1`, `0`, `true` or `false` in any case; `maxPokes` reads a whole number of at least 1. A bad variable or option is named in the status and the default applies, never the configured option. The log never contains a label, command or description.

The decision log is on by default and has no option or plugin variable: it writes under `$PLUGIN_LOG_DIR/cache-keepwarm` when `PLUGIN_LOG_DIR` is set, else `~/.local/state/cache-keepwarm/logs`, and is off, said once, when neither resolves. It appends one JSON row per decision to `errors.jsonl` (a failed poke, timer, inventory or store write), `warnings.jsonl` or `info.jsonl` (every other decision), the directory `0700` and the files `0600`, written through `$.process.run` because Claude Code's file write replaces a whole file. A row's keys are `ts`, `plugin`, `level`, `event`, `msg`, `where`, `session` and `detail`, at most 4096 bytes; `detail` is the metadata row the plugin used to write (event, epoch, items, ttl, context, spent, reason, pokes, usage, ledger, session ledger). A level file past 20 MiB moves to `{file}.1` and a `log-capped` row goes to `warnings.jsonl`. The screen shows an error and one line per failing streak; every other row stays in its file. A directory that other users can write still leaves a gap between check and write.

Persistence keeps one snapshot per Claude Code process (`session:{session id}:{instance}`) of the last-use anchor and the numeric ledger, with its save time. A resumed session restores the newest valid snapshot for its own session id. Snapshots that are invalid, or older than seven days, are deleted when a session starts. A snapshot never restores the `/keepwarm` override, a timer, an admission or a grant. The plugin store is one JSON file shared by all processes; how concurrent writes from two processes interleave is unmeasured.

## TTL resolution

The cache lifetime is resolved per episode, first match wins:

1. `FORCE_PROMPT_CACHING_5M=1`: 5m.
2. `CLAUDE_CODE_PROMPT_CACHE_TTL` equal to `5m` or `1h`: that value.
3. The session's observed lifetime: a request sent 330,000 to 3,300,000 ms after the previous one that read at least 90% of the previous context means 1h; below 90% means 5m; outside that gap there is no evidence.
4. `ENABLE_PROMPT_CACHING_1H=1`: 1h.
5. Otherwise 5m, shown as `TTL assumed 5m`. An assumed 5m is never late, only more frequent.

Sub-agents resolve independently: `FORCE_PROMPT_CACHING_5M=1`, then `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (`5m|1h`), then `ENABLE_PROMPT_CACHING_1H=1`, then that agent's observed lifetime using the same 90%-read rule, otherwise assumed 5m. The main-chat TTL variable does not set a sub-agent's TTL.

A poke is an ordinary request of the thread it goes to, so it refreshes that thread's entry at that thread's own lifetime.

## Budget and ledger

One producer owns the arithmetic. Costs are input-token equivalents (read 0.1, cache write 1.25 at 5m and 2.0 at 1h, plain input 1, output 5), not dollars; USD appears only if the engine exposes a verified price.

- Saved by one avoided rewrite: `context × (write − 0.1)`.
- Spent by a poke, from its own turn's usage: `read × 0.1 + creation × 2.0 + input × 1 + output × 5`, charged once at `turn.complete`, thinking and every request of the turn included.
- Forecast of the next poke: the actual spend of this thread's previous poke, never under a floor of `context × 0.1 + (tail + 150) × 2.0 + 1000 × 5` (the context read, the last response's `tail` and the poke written, a 1,000-token reply).
- A sub-agent poke adds its parent wake to the forecast and, once sent, to the spend: `parent context × 0.1 + (150 + 1000) × 2.0 + 1000 × 5`, the parent's last known context standing in for it.
- A poke is allowed while `spent + forecast ≤ saved` and `saved − spent − forecast ≥ 0.1 × forecast`, so a poke whose saving is marginal is declined.

Worked example, a 5m cache on Haiku with a 50,552-token context, a 3-token tail and pokes whose turns read 49,745 tokens, wrote 807, took 25 plain input tokens and produced 3 output tokens:

- One rewrite saved: 58,134.8.
- Every poke: forecast 10,361.2 (the floor, above the 6,628.5 a poke spent), actual spend 6,628.5.
- The default cap of 4 ends the wait first; on budget alone the ninth would reach 63,389.2, above 58,134.8, and is refused.
- The same wait in a sub-agent whose parent holds 50,552 tokens adds 12,355.2 per poke for the parent wake.

Each sub-agent uses the same ledger arithmetic independently. Claude Code 2.1.302 skips this plugin's start and step hooks for the plugin's own native send, so a sub-agent poke is charged and re-anchored only after the actual `turn.complete` and an exact own receipt in `session.messages` (a raw message or a measured coordinator envelope) are verified. A cold poke or unknown usage ends the episode rather than claiming cache protection.

The budget is an admission forecast plus actual accounting, not a hard realized-spend limit: a poke is a real turn, so an admitted poke can cost more than forecast (a longer reply, more thinking, a tool call), and the episode then stops at the next check. A wait that outlasts the budget or the cap still ends in a rewrite.

`/keepwarm`, the log and the closing toast show the same ledger: actual spend, the allowance (write minus read saving), and `protecting`, the gross cost of the rewrite the pokes may avoid. `protecting` is hypothetical, not a realized saving. The closing net is an estimate, not a measured counterfactual: it credits one avoided rewrite minus poke spend only for a same-prefix return after the original expiry with at least 90% cache read. A return before the original expiry, or a miss, closes at minus the spend; unknown usage closes as unknown, never zero.

## Limits

- No hang detection. Claude Code exposes no activity time for a task, so a pending item is never declared hung; each poke lists it with its elapsed time and asks the model to stop it if it is stale, and the cap bounds an unchanged wait.
- A poke is visible and real. It adds a prompt and a reply to the transcript, which compaction later carries, and costs a real turn at the chat's effort; the forecast learns from the previous poke, but an admitted poke has no output cap.
- Sub-agent poking reaches only idle loops held on attributable pending background work. A foreground tool call cannot be poked. Ownership comes from that agent's successful background tool results or native child-parent links, not the session-wide Stop task list. Missing attribution refuses the poke. A native send queues a message, not a guaranteed model response; a poke not settled within one minute stops that episode.
- The parent wake is accepted. Each sub-agent poke makes Claude Code send the spawning parent, main chat or nested agent, an interim task-notification, which starts one real parent turn; the forecast counts it, and every native delivery is preserved. The parent sees every sub-agent poke. The 100,000-token `subagentMinContext` keeps it to agents whose rewrite outweighs that turn.
- No wait on the user. Only tracked background work is kept warm.
- 1h: the decision admits a 1h cache (`WARM_1H`). A request at 80% of the 1h lifetime refreshing the entry was measured on Claude Code 2.1.302 (a 4,017-second wait held by one such request); a 1h wait carried by a poke is not yet live-measured. A failed `ttl-1h` rerun turns 1h poking off, and a 1h episode then shows `not warming: 1h refresh unproven`.
- A plugin reload rewrites the cached prefix. When a plugin reloads mid-wait (observed after an installed plugin was updated), Claude Code re-renders the environment block near the start of every request (measured on 2.1.302: 48,126 to 49,901 characters), so the cache is lost for the chat and the poke alike; the poke then pays the rewrite, and the ledger accounts it.
- Unknown wake behaviour. Claude Code gives a task no expected return time and no flag saying whether it can wake the chat; the plugin treats the four known kinds as waking and refuses the rest.
- A shell or Monitor killed from the UI while the chat is idle may send no notification; its item is listed in each poke, where the model can see it, until the cap or the budget ends the wait.
- Poke counts live in memory per thread: a restarted Claude Code process starts every count over, as its background work died with it.
- Managed organizations: a Claude Code managed by an organization skips a user-installed plugin's `classic.Stop`, `session.compact` and `classic.PostModelSwitch` hooks unless the organization lists the plugin, so poking and episode ends do not run there.
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
npm run live -- --lane state --cwd <trusted-dir> --output <outside-repo-path> # one short chat: v1 write, then /keepwarm off
npm run live -- --lane wait-return --cwd <trusted-dir> --auto-effort-dir <path> --output <outside-repo-path>   # also cap, subagent-wait, ttl-1h, collision, stale; or --all
```

`--lane state` launches exactly one short real chat with prompt suggestions disabled, reads the v1 file, checks the live Claude PID, sends `/keepwarm off`, and proves an atomic v1 replacement with `enabled: false`, `source: session`, `state: off`, and `reason: off`. It uses only this plugin directory, needs no comparison plugin, and records both snapshots outside the repository. It does not run a cache experiment or another lane.

`--lane wait-return` runs a warm/control pair over a 755-second background agent: the checker requires every poke in the main transcript with its exact text and the real task id of the awaited agent, each admitted four minutes after the main request before it, each poke request and the return reading at least 90% from cache, no five-minute gap between main requests, and a control with warming off returning below 90%. `--lane cap` runs one lane with `CACHE_KEEPWARM_MAX_POKES=2` over a 900-second wait: exactly two pokes, a `poke-limit` decision and `poke limit reached 2/2` in the status, and no poke after it. `--lane subagent-wait` runs a warm/control pair: each real Haiku sub-agent owns a 420-second background shell, with `CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT=0` so a small lane qualifies and the main chat's gate closed; the checker requires each poke to name the owned task, poke turns and the return to read at least 90% from cache, native admission and usage rows, and a subagents-off control returning below 20%, and records the parent wakes it observes. Lane overrides reach only the lane's own chat. The lanes leave the seat's other installed plugins enabled.

One run of each lane on Claude Code 2.1.302, measured on 2026-10-19 (one run's measurements, not a release sequence): `wait-return` sent three visible pokes, 1/4 to 3/4, each naming the awaited agent's real task id, each poke request reading 99.3% to 99.5% from cache (about 55,000 tokens read, 286 to 383 written; the first poke's turn produced 102 output tokens with thinking, the next two 5); the return read 98.8% from cache, and the control with warming off returned at 0.0%. `cap` with `CACHE_KEEPWARM_MAX_POKES=2` sent exactly pokes 1/2 and 2/2, recorded the `poke-limit` stop and sent nothing more over the rest of a 905-second wait, so its return read 0.0%. `subagent-wait` sent the waiting sub-agent one visible poke naming its own background shell; the poke read 99.6% and the sub-agent's return 99.0% from cache, against 0.0% for the subagents-off control, and the poke woke the main chat once (one interim task-notification, one real parent turn), as § Limits states.

The unit gates (decisions, and the function-hook tests on a stand-in and on the testing kit) are unit fidelity; there is no hermetic end-to-end tier. The live lanes boot a real Claude Code on the invoking user's own configuration with the plugin loaded through `CLAUDE_CODE_PLUGIN_DIRS` and Claude Code's prompt suggestion off (`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`: its request after each turn writes the conversation's cache, so a control lane would not go cold), never copy credentials, and judge transcript usage and log rows, never a model's statement. The checker voids a lane, never passes or fails it, on an API or auth error, a real compaction of the lane's main session mid-lane (a `precompute`, a sub-agent's own compaction, or one a plugin vetoed or that failed is recorded, never voided), or a main request that keeps fewer messages of its base request than the base sent: Claude Code rewrote the prefix mid-lane (§ Limits, plugin reload), so the lane proves nothing about the cache. A release needs three clean serial `--all` sequences and one clean `--lane ttl-1h` on the final tree; a voided lane does not count.

`CLAUDE.md` is the testing manual.

The live harness needs `node`, `npm`, `claude`, `python3`, `tmux`, the chat launcher `pfm`, the user's existing Claude configuration, a working directory with its own trust entry in Claude Code passed as `--cwd`, and the directory of the second plugin used for the comparison. The evidence directory is the `--output` argument or a temporary directory outside the repository. A capture checks that the waiting status cleared.

## Credits

- [claude-cache-warm](https://github.com/FiredMosquito831/claude-cache-warm) (MIT): skip a warm once the cache has expired, a minimum context, supersede by newer activity.
- [cache-keepwarm by mupamuc](https://github.com/mupamuc/cache-keepwarm) (MIT): the immediate `/keepwarm [on|off|status]` command, anchoring on a response that used the cache, the 15-second expiry safety, same-session restore.

This plugin differs from both by keeping caches warm only while tracked work is pending, through visible pokes to the main chat and waiting sub-agents, capped per wait and under independent budgets. Their licences are in `THIRD-PARTY-NOTICES`; this plugin is MIT licensed.
