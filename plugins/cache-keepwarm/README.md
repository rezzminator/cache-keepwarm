# cache-keepwarm

Keeps Claude Code prompt caches warm while work runs in the background, admitted only while the forecast spend stays under the rewrite it saves. Two independent paths, each with its own state, timer and budget:

- Main chat: while it waits on a background agent, shell command, Monitor or workflow, one invisible replay of the last request before the cache expires.
- Waiting sub-agents (0.2.0, opt-in, off by default): a short real warm turn sent to the agent itself. A warm can wake any spawning parent, main or nested, with an interim `K` task-notification and cause a real, separately charged parent turn that the per-agent ledger does not count and that can exceed the savings.

```text
/keepwarm            state: on or off and why, the current wait, spend against the allowance
/keepwarm on | off   this chat only; off cancels every armed warm, main and sub-agent; on waits for the next qualifying Stop
/keepwarm status     same as no argument
```

| Variable | Option | Default | Meaning |
| --- | --- | --- | --- |
| `CACHE_KEEPWARM_ENABLED` | `enabled` | `true` | Warm at all; `/keepwarm` overrides it for one chat |
| `CACHE_KEEPWARM_MIN_CONTEXT` | `minContext` | `20000` | Smallest context in tokens worth warming |
| `CACHE_KEEPWARM_MAX_WAIT_MINUTES` | `maxWaitMinutes` | `180` | Minutes an item may stay pending before it stops justifying a warm |
| `CACHE_KEEPWARM_LOG_DIR` | `logDir` | empty | Directory for a metadata-only decision log; empty writes none |
| `CACHE_KEEPWARM_SUBAGENTS` | `subagents` | `false` | Opt in (`true` or `1`) to warm waiting sub-agents, accepting possible collateral parent turns outside the ledger; the main path is unchanged either way |
| `CACHE_KEEPWARM_BAND` | `band` | `true` | Show the row above the prompt; hiding it does not stop warming |

A variable beats the option, the option beats the default; a blank variable is absent, booleans read `1`, `0`, `true` or `false` in any case, and a bad variable is named in the status while the default applies.

## Sub-agent limits

- A warm needs a fresh `agent.list` showing the agent waiting plus locally attributed pending background tool ids or the native `parentId`; an unowned waiting agent is refused. A foreground tool call cannot be warmed.
- The warm instruction appears only in the agent's own transcript, never in the main chat's.
- The native engine nevertheless sends an interim `K` task-notification to the spawning parent, main chat or nested agent, for each agent warm. That can start a real parent model turn, separately charged and outside the per-agent ledger, which can exceed the savings; this is why the option defaults off. No suppressor ships: the producer exposes no per-warm token tying a notice to an admission, `session.receive` interception failed live, and text filtering could swallow real child results. Every native delivery is preserved. Sub-agent warming is not invisible to the parent.
- Main typing and turns do not cancel agent warms.
- Measured, not guaranteed: one live run on native Claude Code 2.1.302 read 99.6469% and 99.6778% of two warm turns from cache, 98.9920% on the return after nine minutes, and 0% in the control with sub-agent warming off.

## Install

The repository is public: <https://github.com/rezzminator/cache-keepwarm>. Development is on `develop`; the marketplace ref stays `main` until a release, so 0.2.0 is not yet published and the command below installs the latest released version: `/plugin install cache-keepwarm --marketplace rezzminator/cache-keepwarm`.

It requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. A Claude Code managed by an organization skips the plugin's `classic.Stop`, `session.compact` and `classic.PostModelSwitch` hooks unless the organization lists the plugin. The root README of the repository is the full documentation, including TTL resolution, the budget ledger and every limit: <https://github.com/rezzminator/cache-keepwarm>.
