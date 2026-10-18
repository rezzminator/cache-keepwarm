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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('evidence', type=Path)
    args = parser.parse_args()
    try:
        result = check(json.loads(read_text(args.evidence)))
    except (ValueError, OSError) as error:
        print(str(error))
        return 2
    print(json.dumps(result, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
