# cache-keepwarm

Keeps the main Claude Code chat's prompt cache warm while it waits on a background agent, shell command, Monitor or workflow: one invisible replay of the last request before the cache expires, admitted only while its forecast spend stays under the rewrite it saves.

```text
/keepwarm            state: on or off and why, the current wait, spend against the allowance
/keepwarm on | off   this chat only; off cancels the armed warm, on waits for the next qualifying Stop
/keepwarm status     same as no argument
```

| Variable | Option | Default | Meaning |
| --- | --- | --- | --- |
| `CACHE_KEEPWARM_ENABLED` | `enabled` | `true` | Warm at all; `/keepwarm` overrides it for one chat |
| `CACHE_KEEPWARM_MIN_CONTEXT` | `minContext` | `20000` | Smallest context in tokens worth warming |
| `CACHE_KEEPWARM_MAX_WAIT_MINUTES` | `maxWaitMinutes` | `180` | Minutes an item may stay pending before it stops justifying a warm |
| `CACHE_KEEPWARM_LOG_DIR` | `logDir` | empty | Directory for a metadata-only decision log; empty writes none |
| `CACHE_KEEPWARM_BAND` | `band` | `true` | Show the row above the prompt; hiding it does not stop warming |

A variable beats the option, the option beats the default; a blank variable is absent, booleans read `1`, `0`, `true` or `false` in any case, and a bad variable is named in the status while the default applies.

Install, once the repository is published (its remote does not exist yet): `/plugin install cache-keepwarm --marketplace rezzminator/cache-keepwarm`.

It requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. A Claude Code managed by an organization skips the plugin's `classic.Stop`, `session.compact` and `classic.PostModelSwitch` hooks unless the organization lists the plugin. The root README of the repository is the full documentation: <https://github.com/rezzminator/cache-keepwarm> (the remote does not exist yet).
