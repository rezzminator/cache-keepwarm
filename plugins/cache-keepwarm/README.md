# cache-keepwarm

Keeps Claude Code prompt caches warm while work runs in the background, with a visible poke shortly before the cache expires, admitted only while the forecast spend stays under the rewrite it saves. Two independent paths, each with its own state, timer, budget and poke count:

- Main chat: while it waits on a background agent, shell command, Monitor or workflow, a real prompt submitted into the chat. It shows in the transcript and runs one real turn at the chat's model and effort, thinking included.
- Waiting sub-agents (on by default): the same message sent to the agent itself. Claude Code then hands the spawning parent, main chat or nested agent, an interim task-notification, which starts one real parent turn per sub-agent poke; the budget forecast counts that turn.

Each poke lists every pending item by kind, real task id, label and elapsed time, and asks the model to stop anything stale or started by accident, else to reply `waiting`:

```text
Keep-warm poke 1/4: your prompt cache was about to expire, so this message keeps it warm while you wait on:
- agent `a1b2c3`: run the migration tests, pending 4m
If any of these is stale or was started by accident, stop it now. Otherwise reply `waiting` and end your turn.
```

At most `maxPokes` pokes go to one thread while its pending items stay the same and nothing else happens; a user prompt, a real turn, an item finishing or a new one appearing starts a fresh count. A reached cap reads `poke limit reached 4/4` in the status, `/keepwarm` and the log.

```text
/keepwarm            state: on or off and why, the current wait, pokes and spend against the allowance
/keepwarm on | off   this chat only; off cancels every armed poke, main and sub-agent; on waits for the next qualifying Stop
/keepwarm status     same as no argument
```

| Variable | Option | Default | Meaning |
| --- | --- | --- | --- |
| `CACHE_KEEPWARM_ENABLED` | `enabled` | `true` | Poke at all; `/keepwarm` overrides it for one chat |
| `CACHE_KEEPWARM_MIN_CONTEXT` | `minContext` | `20000` | Smallest main-chat context in tokens worth a poke |
| `CACHE_KEEPWARM_MAX_POKES` | `maxPokes` | `4` | Pokes per thread on one unchanged wait; an integer of at least 1 |
| `CACHE_KEEPWARM_LOG_DIR` | `logDir` | empty | Directory for a metadata-only decision log; empty writes none |
| `CACHE_KEEPWARM_SUBAGENTS` | `subagents` | `true` | Poke waiting sub-agents, each poke also waking the parent for one turn; the main path is unchanged either way |
| `CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT` | `subagentMinContext` | `100000` | Smallest sub-agent context in tokens worth a poke and its parent wake |
| `CACHE_KEEPWARM_BAND` | `band` | `true` | Show the row above the prompt; hiding it does not stop the pokes |

A variable beats the option, the option beats the default; a blank variable is absent, booleans read `1`, `0`, `true` or `false` in any case, and a bad variable is named in the status while the default applies.

## Cost and limits

- A poke is a real turn: the forecast is the previous poke's actual cost on that thread, never less than a floor of the context read, the unwritten tail and the poke written, and a 1,000-token reply. A sub-agent poke adds the parent wake: the parent's last known context × 0.1 + (150 + 1000) × 2 + 1000 × 5 input-token equivalents. Actual usage is charged once, from the poke turn's own usage.
- A main-chat poke is never sent while a turn runs or the user is typing.
- A sub-agent poke needs a fresh `agent.list` showing the agent waiting, re-checked right before the send, plus locally attributed pending background tool ids or the native `parentId`; an unowned, finished, failed or killed agent is never poked, and a foreground tool call cannot be.
- The parent wake is accepted, not suppressed: every native task-notification is delivered as Claude Code sends it.
- Poke counts live in memory per thread and end with the episode; a restarted process starts over.

## Install

The repository is public: <https://github.com/rezzminator/cache-keepwarm>. Development is on `develop`; the marketplace ref stays `main` until a release, so 0.3.0 is not yet published and the command below installs the latest released version: `/plugin install cache-keepwarm --marketplace rezzminator/cache-keepwarm`.

It requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. A Claude Code managed by an organization skips the plugin's `classic.Stop`, `session.compact` and `classic.PostModelSwitch` hooks unless the organization lists the plugin. The root README of the repository is the full documentation, including TTL resolution, the budget ledger and every limit: <https://github.com/rezzminator/cache-keepwarm>.
