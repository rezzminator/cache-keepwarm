#!/usr/bin/env python3
import argparse
import json
import os
import stat
from datetime import datetime
from pathlib import Path

LIMIT = 64 * 1024 * 1024

def open_evidence(path):
    """Walk parents by descriptor: never follow links or open a blocking leaf."""
    parts = Path(os.path.abspath(path)).parts
    parent = os.open(parts[0], os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_size > LIMIT:
        os.close(fd)
        raise ValueError('ERROR evidence file must be regular and bounded')
    return fd, info

def read_text(path):
    fd, _ = open_evidence(path)
    with os.fdopen(fd, 'rb') as stream:
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError('ERROR evidence file exceeds byte bound')
    return data.decode('utf-8')

class Journal:
    """Consume complete appended JSONL records once; retain a partial last line."""
    def __init__(self, path):
        self.path, self.offset, self.identity, self.pending, self.records = path, 0, None, b'', []

    def poll(self):
        fd, info = open_evidence(self.path)
        with os.fdopen(fd, 'rb') as stream:
            identity = (info.st_dev, info.st_ino)
            if self.identity is not None and (identity != self.identity or info.st_size < self.offset):
                raise ValueError('ERROR evidence file replaced or truncated')
            self.identity = identity
            stream.seek(self.offset)
            data = stream.read(LIMIT - self.offset + 1)
        self.offset += len(data)
        if self.offset > LIMIT:
            raise ValueError('ERROR evidence file exceeds byte bound')
        lines = (self.pending + data).split(b'\n')
        self.pending = lines.pop()
        self.records.extend(json.loads(line) for line in lines if line.strip())
        return self.records

def timestamp(record):
    # The plugin log stamps `at`, transcripts `timestamp`, auto-effort `ts`.
    value = next((record[k] for k in ('at', 'timestamp', 'ts') if k in record), None)
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
    raise ValueError('NOT RUN: evidence timestamp missing')

def validity(lane, require_debug=True):
    # API/auth errors are rejected before missing evidence or any cache assertion.
    if any(r.get('message', {}).get('model') == '<synthetic>' or r.get('isApiErrorMessage') for r in lane.get('transcript', [])):
        raise ValueError('VOID API/auth error: synthetic/error model response')
    if '[ERROR] API' in lane.get('debug', ''):
        raise ValueError('VOID API/auth error in debug log')
    if any(r.get('reason') == 'api-error' or r.get('event') == 'fork.api-error' or r.get('event') == 'fork' and r.get('reason') == 'fork-failed' for r in lane.get('log', [])):
        raise ValueError('VOID API/auth or failed fork')
    if require_debug and not isinstance(lane.get('debug'), str):
        raise ValueError('NOT RUN: debug validity evidence missing')

def prefix_kept(lane):
    """Each main-thread request record re-sends `keep` of its base request's messages and appends `tail`. One keeping
    fewer than its base sent means Claude Code rewrote the conversation's prefix mid-lane (measured: a plugin reload
    re-rendered the environment message), which drops the cache for the warm and the chat alike: the lane is VOID."""
    requests = [r for r in lane.get('transcript', []) if r.get('type') == 'api-request' and r.get('querySource') == 'repl_main_thread']
    if any(not isinstance(r.get('keep'), int) or not isinstance(r.get('tail'), list) for r in requests):
        raise ValueError('NOT RUN: main-thread request record malformed')
    sent = {r.get('id'): r['keep'] + len(r['tail']) for r in requests}
    extended = [r for r in requests if r.get('base') in sent]
    if not extended:
        raise ValueError('NOT RUN: main-thread request records missing')
    for r in extended:
        if r['keep'] < sent[r['base']]:
            raise ValueError('VOID prefix rewritten mid-lane: request ' + str(r.get('id')) + ' kept ' + str(r['keep']) + ' of ' + str(sent[r['base']]) + ' messages')

def reply_text(record):
    """The reply's own text blocks: a tool call's input (an Agent prompt quoting the instructions) is never a reply."""
    content = record.get('message', {}).get('content', [])
    if isinstance(content, str):
        return content
    return '\n'.join(b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text')

def reply_window(lane):
    """The unique WAITING -> RETURNED window, its quiet-window proof and the return's cache-read ratio."""
    records = lane['transcript']
    replies = [(i, r) for i, r in enumerate(records) if r.get('type') == 'assistant' and 'RETURNED' in reply_text(r)]
    waits = [(i, r) for i, r in enumerate(records) if r.get('type') == 'assistant' and 'WAITING' in reply_text(r)]
    if len(replies) != 1 or len(waits) != 1:
        raise ValueError('NOT RUN: unique WAITING/return response missing')
    end, reply = replies[0]
    start, waiting = waits[0]
    # One API response can be written as several records (a thinking block, then the text); they share message.id.
    reply_id = reply.get('message', {}).get('id')
    between = [r for r in records[start + 1:end] if r.get('type') in ('user', 'assistant') and not (reply_id and r.get('type') == 'assistant' and r.get('message', {}).get('id') == reply_id)]
    if start >= end or len(between) != 1 or between[0].get('type') != 'user' or '<task-notification' not in json.dumps(between[0].get('message', {}).get('content', [])):
        raise ValueError('FAIL transcript quiet window: extra main traffic or missing notification')
    message = reply['message']
    if message.get('model') != 'claude-haiku-5-5':
        raise ValueError('FAIL wrong model: ' + str(message.get('model')))
    usage = message.get('usage', {})
    counts = [usage.get(k) for k in ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')]
    if any(not isinstance(n, (int, float)) or not 0 <= n < float('inf') for n in counts) or sum(counts) <= 0:
        raise ValueError('FAIL return usage absent or invalid')
    ratio = usage['cache_read_input_tokens'] / sum(counts)
    lane['returnEvidence'] = {'path': lane.get('transcriptPath'), 'line': end + 1, 'usage': usage, 'ratio': ratio}
    return (timestamp(waiting), timestamp(reply)), ratio

def check(evidence):
    lanes = evidence.get('lanes', [])
    for lane in lanes:
        validity(lane, require_debug=False)
    for lane in lanes:
        if lane.get('trustBlocked'):
            raise ValueError('BLOCKED folder trust: no consent was synthesized')
        if not any(r.get('event') == 'LOADED' for r in lane.get('log', [])):
            raise ValueError('ERROR need plugin load marker')
        validity(lane)
        prefix_kept(lane)
    if len(lanes) != 2:
        raise ValueError('NOT RUN: warm/control pair incomplete')
    ratios, windows = [], []
    for lane in lanes:
        window, ratio = reply_window(lane)
        windows.append(window)
        ratios.append(ratio)
        if not isinstance(lane.get('effort'), list):
            raise ValueError('NOT RUN: auto-effort evidence missing')
        effort_quiet(lane['effort'], windows[-1])
    if ratios[0] < .9 or ratios[1] >= .9:
        raise ValueError('FAIL cache separation: ' + str(ratios))
    warm = lanes[0]
    forks = [r for r in warm['log'] if r.get('event') == 'fork']
    admits = [r for r in warm['log'] if r.get('event') == 'admit']
    anchors = [r['anchorAt'] for r in warm['log'] if r.get('event') == 'step' and isinstance(r.get('anchorAt'), (int, float)) and r['anchorAt'] <= windows[0][0]]
    if len(forks) != 3 or len(admits) != 3 or not anchors:
        raise ValueError('FAIL prescribed fork count/anchor absent')
    for row, delta in zip(admits, (240000, 480000, 720000)):
        if abs(timestamp(row) - max(anchors) - delta) > 5000:
            raise ValueError('FAIL warm admission timing')
    for row in forks:
        u = row.get('usage', {})
        if u.get('cache_read_input_tokens', 0) < .9 * row.get('context', float('inf')) or u.get('output_tokens', 1000) > 256:
            raise ValueError('FAIL fork usage')
    if any(r.get('event') == 'compact' for lane in lanes for r in lane['log']):
        raise ValueError('FAIL unexpected compaction')
    if not isinstance(warm.get('waitingCapture'), str) or 'cache-keepwarm · waiting on' not in warm['waitingCapture']:
        raise ValueError('FAIL waiting status capture absent')
    if not isinstance(warm.get('returnedCapture'), str) or not warm['returnedCapture'].strip():
        raise ValueError('NOT RUN: returned capture missing')
    if 'cache-keepwarm · waiting on' in warm['returnedCapture']:
        raise ValueError('FAIL waiting status survived return')
    return {'verdict': 'PASS cache separation', 'ratios': ratios, 'lanes': lanes}

def effort_quiet(rows, window):
    """No auto-effort step of any turn but the WAITING turn inside the wait: a request's step row is written just after its
    response, so the WAITING turn's own row can land a few milliseconds past the WAITING timestamp."""
    closing = [r for r in rows if r.get('event') == 'turn' and timestamp(r) >= window[0] - 1000]
    waiting_turn = closing[0].get('turnId') if closing else None
    if any(r.get('event') == 'step' and window[0] < timestamp(r) < window[1] and (waiting_turn is None or r.get('turnId') != waiting_turn) for r in rows):
        raise ValueError('FAIL auto-effort ran during invisible wait')

def check_1h(lane, warm1h):
    """One 1h-TTL lane: with warm1h, one refresh at 80% carries a >1h wait; without, a refusal and no warm."""
    validity(lane, require_debug=False)
    if lane.get('trustBlocked'):
        raise ValueError('BLOCKED folder trust: no consent was synthesized')
    if not any(r.get('event') == 'LOADED' for r in lane.get('log', [])):
        raise ValueError('ERROR need plugin load marker')
    validity(lane)
    prefix_kept(lane)
    # The first step can precede the TTL hand-off (5m, assumed); every decision, admission and fork must see 1h from the env.
    anchored = [r for r in lane['log'] if r.get('event') == 'step' and isinstance(r.get('anchorAt'), (int, float))]
    judged = [r for r in lane['log'] if r.get('event') in ('decision', 'admit', 'fork')]
    if not any(r.get('event') == 'decision' for r in judged) or any(r.get('ttl') != '1h' or r.get('ttlSource') != 'env' for r in judged):
        raise ValueError('ERROR need 1h rows from the env source: ' + str(sorted({(r.get('event'), r.get('ttl'), r.get('ttlSource')) for r in judged})))
    window, ratio = reply_window(lane)
    gap = window[1] - window[0]
    if not isinstance(lane.get('effort'), list):
        raise ValueError('NOT RUN: auto-effort evidence missing')
    effort_quiet(lane['effort'], window)
    forks = [r for r in lane['log'] if r.get('event') == 'fork']
    admits = [r for r in lane['log'] if r.get('event') == 'admit']
    if not warm1h:
        if forks or admits:
            raise ValueError('FAIL 1h refusal admitted a warm')
        if not any(r.get('event') == 'decision' and r.get('reason') == '1h-unproven' for r in judged):
            raise ValueError('FAIL 1h refusal reason absent')
        if gap <= 300000 or ratio < .9:
            raise ValueError('FAIL 1h TTL not in effect: gap ' + str(gap) + ' ms, read ratio ' + str(ratio))
        return {'verdict': 'PASS ttl-1h refusal', 'ratio': ratio, 'gapMs': gap}
    if gap <= 3600000:
        raise ValueError('NOT RUN: main gap does not outlast 1h: ' + str(gap) + ' ms')
    anchors = [r['anchorAt'] for r in anchored if r['anchorAt'] <= window[0]]
    if len(forks) != 1 or len(admits) != 1 or not anchors:
        raise ValueError('FAIL prescribed 1h fork count/anchor absent')
    if abs(timestamp(admits[0]) - max(anchors) - 2880000) > 5000:
        raise ValueError('FAIL 1h admission timing')
    u = forks[0].get('usage', {})
    if u.get('cache_read_input_tokens', 0) < .9 * forks[0].get('context', float('inf')) or u.get('output_tokens', 1000) > 256:
        raise ValueError('FAIL fork usage')
    if ratio < .9:
        raise ValueError('FAIL 1h refresh did not hold: read ratio ' + str(ratio))
    if any(r.get('event') == 'compact' for r in lane['log']):
        raise ValueError('FAIL unexpected compaction')
    return {'verdict': 'PASS ttl-1h refresh', 'ratio': ratio, 'gapMs': gap}

def cache_ratio(record):
    message = record.get('message', {})
    if message.get('model') != 'claude-haiku-5-5':
        raise ValueError('FAIL wrong sub-agent model')
    usage = message.get('usage', {})
    counts = [usage.get(k) for k in ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')]
    if any(not isinstance(n, (int, float)) or not 0 <= n < float('inf') for n in counts) or sum(counts) <= 0:
        raise ValueError('NOT RUN: sub-agent usage missing or invalid')
    return usage['cache_read_input_tokens'] / sum(counts)

def parent_requests(lane, warms):
    # Count actual parent API usages, not model statements or synthetic answers.
    rows, agent = lane['transcript'], lane['agentId']
    def notice(row, result):
        text = reply_text(row)
        return row.get('type') == 'user' and '<task-id>' + agent + '</task-id>' in text and '<result>' + result + '</result>' in text and row.get('origin', {}).get('kind') == 'task-notification'
    def requests_after(index):
        end = next((j for j in range(index + 1, len(rows)) if rows[j].get('type') == 'user'), len(rows))
        return len({r.get('requestId') or r.get('message', {}).get('id') for r in rows[index + 1:end] if r.get('type') == 'assistant' and any(type(v) in (int, float) and v > 0 for v in r.get('message', {}).get('usage', {}).values())})
    notes = [i for i, row in enumerate(rows) if notice(row, 'K')]
    if len(notes) != warms:
        raise ValueError('NOT RUN: parent warm notification evidence incomplete')
    returned = [i for i, row in enumerate(rows) if notice(row, 'SUBAGENT_RETURNED')]
    if len(returned) != 1 or not requests_after(returned[0]):
        raise ValueError('FAIL real child notification did not produce a normal parent request')
    counts = [requests_after(i) for i in notes]
    return {'parentWarmRequests': counts, 'parentReturnRequests': requests_after(returned[0]), 'zeroCollateral': all(n == 0 for n in counts)}

def check_subagents(evidence):
    lanes = evidence.get('lanes', [])
    if len(lanes) != 2:
        raise ValueError('NOT RUN: sub-agent warm/control pair incomplete')
    results = []
    for warm, lane in zip((True, False), lanes):
        validity(lane)
        prefix_kept(lane)
        records = lane.get('subagent', [])
        validity({**lane, 'transcript': records})
        if not any(r.get('event') == 'LOADED' for r in lane.get('log', [])) or not records or not lane.get('agentId') or not isinstance(lane.get('effort'), list):
            raise ValueError('NOT RUN: sub-agent load/ownership/effort evidence missing')
        if any('Cache keep-warm:' in reply_text(r) for r in lane['transcript']):
            raise ValueError('FAIL warm text appeared in main transcript')
        calls = [b for r in records for b in r.get('message', {}).get('content', []) if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == 'Bash' and b.get('input', {}).get('run_in_background') is True]
        owned = [r.get('toolUseResult', {}).get('backgroundTaskId') for r in records if isinstance(r.get('toolUseResult'), dict) and any(b.get('tool_use_id') == c.get('id') for b in r.get('message', {}).get('content', []) if isinstance(b, dict) for c in calls)]
        owned = [i for i in owned if isinstance(i, str)]
        waiting = [r for r in records if r.get('type') == 'assistant' and 'SUBAGENT_WAITING' in reply_text(r)]
        returns = [r for r in records if r.get('type') == 'assistant' and 'SUBAGENT_RETURNED' in reply_text(r)]
        notifications = [i for i, r in enumerate(records) if r.get('type') == 'user' and '<task-notification' in reply_text(r) and any('<task-id>' + task + '</task-id>' in reply_text(r) for task in owned)]
        if not owned or len(waiting) != 1 or len(returns) != 1 or len(notifications) != 1:
            raise ValueError('NOT RUN: unique owned background task/wait/notification/return absent')
        if timestamp(returns[0]) - timestamp(waiting[0]) <= 300000 or records.index(returns[0]) <= notifications[0]:
            raise ValueError('NOT RUN: sub-agent wait did not outlast 5m or return preceded notification')
        warm_users = [i for i, r in enumerate(records) if r.get('type') == 'user' and 'Cache keep-warm:' in reply_text(r)]
        admits = [r for r in lane['log'] if r.get('kind') == 'subagent' and r.get('agentId') == lane['agentId'] and r.get('event') == 'admit' and r.get('reason') == 'eligible']
        warm_rows = [r for r in lane['log'] if r.get('kind') == 'subagent' and r.get('agentId') == lane['agentId'] and r.get('event') == 'warm']
        if warm and (not warm_users or len(admits) != len(warm_users) or len(warm_rows) != len(warm_users)):
            raise ValueError('FAIL sub-agent native send/usage evidence absent')
        if not warm and (warm_users or admits or warm_rows):
            raise ValueError('FAIL subagents off still warmed')
        warm_ratios, spent = [], 0
        keys = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        for count, (i, admit, row) in enumerate(zip(warm_users, admits, warm_rows), 1):
            if not timestamp(waiting[0]) < timestamp(admit) < timestamp(returns[0]) or abs(timestamp(records[i]) - timestamp(admit)) > 10000:
                raise ValueError('FAIL sub-agent send outside waiting interval')
            end = next((j for j in range(i + 1, len(records)) if records[j].get('type') == 'user'), len(records))
            replies = [r for r in records[i + 1:end] if r.get('type') == 'assistant']
            if not replies or any(b.get('type') == 'tool_use' for r in replies for b in r.get('message', {}).get('content', []) if isinstance(b, dict)):
                raise ValueError('FAIL warm turn absent or called a tool')
            seen, total = set(), dict.fromkeys(keys, 0)
            for reply in replies:
                key = reply.get('requestId') or reply.get('message', {}).get('id')
                if key not in seen:
                    seen.add(key)
                    usage = reply.get('message', {}).get('usage', {})
                    if any(type(usage.get(k)) not in (int, float) or not 0 <= usage[k] < float('inf') for k in keys):
                        raise ValueError('NOT RUN: warm transcript output/usage missing or invalid')
                    for k in keys:
                        total[k] += usage[k]
                    ratio = cache_ratio(reply)
                    if ratio < .9:
                        raise ValueError('FAIL sub-agent warm cache read: ' + str(ratio))
                    warm_ratios.append(ratio)
            if any(type(row.get('usage', {}).get(k)) not in (int, float) or row['usage'][k] != total[k] for k in keys):
                raise ValueError('FAIL native warm usage differs from transcript')
            spent += total['input_tokens'] + total['output_tokens'] * 5 + total['cache_read_input_tokens'] * .1 + total['cache_creation_input_tokens'] * 2
            ledger = row.get('ledger', {})
            if any(type(v) not in (int, float) or abs(v - spent) > 1e-5 for v in (row.get('spent'), ledger.get('spent'))) or row.get('warms') != count or ledger.get('warms') != count:
                raise ValueError('FAIL native warm charge/ledger differs from transcript')
        ratio = cache_ratio(returns[0])
        if warm and ratio < .9 or not warm and ratio >= .2:
            raise ValueError('FAIL sub-agent return cache separation: ' + str(ratio))
        results.append({'path': lane.get('subagentPath'), 'agentId': lane['agentId'], 'warms': len(warm_users), 'warmRatios': warm_ratios, 'returnRatio': ratio, **parent_requests(lane, len(warm_users))})
    return {'verdict': 'PASS subagent-wait cache separation', 'lanes': results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('evidence', type=Path)
    args = parser.parse_args()
    try:
        evidence = json.loads(read_text(args.evidence))
        result = check_subagents(evidence) if evidence.get('mode') == 'subagent-wait' else check(evidence)
    except (ValueError, OSError) as error:
        print(str(error))
        return 2
    print(json.dumps(result, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
