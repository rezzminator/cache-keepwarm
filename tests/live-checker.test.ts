import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
const script = fileURLToPath(new URL('../scripts/live-check.py', import.meta.url));
test.each([
  [{ lanes: [{ transcript: [{ message: { model: '<synthetic>' } }], trustBlocked: true }] }, 'VOID API/auth'],
  [{ lanes: [{ debug: '[ERROR] API authentication failed' }] }, 'VOID API/auth'],
  [{ lanes: [{ log: [{ event: 'fork.api-error' }] }] }, 'VOID API/auth'],
  [{ lanes: [{ trustBlocked: true }] }, 'BLOCKED folder trust'],
  [{ lanes: [{}] }, 'ERROR need plugin load marker'],
])('live validity is not cache absence %#', (input, text) => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-keepwarm-check-'));
  try {
    const path = join(dir, 'evidence.json'); writeFileSync(path, JSON.stringify(input));
    const result = spawnSync('python3', ['-I', script, path], { encoding: 'utf8' });
    expect(result.status).toBe(2); expect(result.stdout).toContain(text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Claude Code's own main-thread request records: each re-sends `keep` of its base's messages and appends `tail`.
const requests = () => [{ type: 'api-request', querySource: 'repl_main_thread', id: 'r1', keep: 0, tail: ['a', 'b'] },
  { type: 'api-request', querySource: 'repl_main_thread', id: 'r2', base: 'r1', keep: 2, tail: ['c', 'd'] },
  { type: 'api-request', querySource: 'repl_main_thread', id: 'r3', base: 'r2', keep: 4, tail: ['e'] }];
function pair() {
  const at = 1000000;
  const usage = (read: number) => ({ input_tokens: 1000, output_tokens: 3, cache_read_input_tokens: read, cache_creation_input_tokens: 49000 - read });
  const message = (text: string, type = 'assistant', read = 49000) => ({ type, timestamp: new Date(at + (text === 'WAITING' ? 1000 : 756000)).toISOString(), message: { model: 'claude-haiku-5-5', content: [{ type: 'text', text }], usage: usage(read) } });
  const lane = (warm: boolean) => ({ transcriptPath: 'transcript.jsonl', debug: '', effort: [], waitingCapture: 'cache-keepwarm · waiting on agent', returnedCapture: 'finished',
    transcript: [message('WAITING'), message('<task-notification>LONG_PROBE_DONE</task-notification>', 'user'), message('RETURNED', 'assistant', warm ? 49000 : 20000), ...requests()],
    log: [{ event: 'LOADED', at, epoch: 0 }, { event: 'step', at, anchorAt: at, epoch: 1 }, ...(warm ? [240000, 480000, 720000].flatMap(delta => [{ event: 'admit', at: at + delta, epoch: 2 }, { event: 'fork', at: at + delta, epoch: 2, context: 50000, usage: usage(49000) }]) : [])] });
  return { lanes: [lane(true), lane(false)] };
}
function checkPair(input: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'cache-keepwarm-pair-'));
  try { const path = join(dir, 'pair.json'); writeFileSync(path, JSON.stringify(input)); return spawnSync('python3', ['-I', script, path], { encoding: 'utf8' }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
test('independent complete evidence is accepted', () => expect(checkPair(pair()).status).toBe(0));
test.each(['wrong-time', 'missing-fork', 'extra-turn', 'effort-step', 'missing-capture', 'missing-debug'])('mechanism evidence rejects %s', problem => {
  const input: any = pair(), warm = input.lanes[0];
  if (problem === 'wrong-time') warm.log.find((r: any) => r.event === 'admit').at += 10000;
  if (problem === 'missing-fork') warm.log = warm.log.filter((r: any) => r.at !== 1240000);
  if (problem === 'extra-turn') warm.transcript.splice(1, 0, { type: 'assistant', message: { content: [{ text: 'extra request' }] } });
  if (problem === 'effort-step') warm.effort = [{ event: 'turn', ts: 1001010, turnId: 'w' }, { event: 'step', ts: 1100000, turnId: 'x' }];
  if (problem === 'missing-capture') delete warm.returnedCapture;
  if (problem === 'missing-debug') delete warm.debug;
  expect(checkPair(input).status).toBe(2);
});
const runner = fileURLToPath(new URL('../scripts/live-proof.py', import.meta.url));
function python(body: string) {
  return spawnSync('python3', ['-I', '-B', '-c', `import importlib.util,sys,json,subprocess,tempfile,pathlib,types
spec=importlib.util.spec_from_file_location('runner',sys.argv[1]); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
${body}`, runner], { encoding: 'utf8', timeout: 5000 });
}
test('collision checker rejects a stale post-cancel admission', () => {
  const result = python(`before={'transcript':[{'type':'assistant','at':0,'message':{'content':'WAITING'}},{'type':'assistant','at':201000,'message':{'content':'PONG'}}], 'debug':'', 'log':[{'event':'LOADED'}, {'event':'cancel','at':200000,'epoch':2}, {'event':'admit','at':440000,'epoch':3}]}
during={'transcript':[], 'debug':'', 'log':[{'event':'LOADED'},{'event':'admit','at':239000,'epoch':3},{'event':'cancel','at':240000,'epoch':4},{'event':'admit','at':242000,'epoch':3},{'event':'fork','at':242500,'epoch':3}]}
try: m.special([before,during],'collision')
except (ValueError,RuntimeError): sys.exit(0)
sys.exit(1)`);
  expect(result.status, result.stderr).toBe(0);
});
test('special checker rejects native error-flagged replies before outcome checks', () => {
  const result = python(`item={'transcript':[{'isApiErrorMessage':True}], 'debug':'','log':[{'event':'LOADED'}]}
try: m.special([item,item],'stale')
except (ValueError,RuntimeError) as e:
 print(e);sys.exit(0 if 'VOID' in str(e) else 1)
sys.exit(1)`);
  expect(result.status, result.stderr).toBe(0);
});
test('cleanup attempts socket verification even if native kill times out', () => {
  const result = python(`seen=[]
def run(args,**kwargs):
 seen.append(args[0])
 if args[0]=='pfm': raise subprocess.TimeoutExpired(args,30)
 return types.SimpleNamespace(returncode=1,stdout='',stderr='')
m.run=run;m.marked_pids=lambda marker: []
result=m.cleanup('owned','marker','owned-socket')
assert 'tmux' in seen and result['nativeSocketClosed'] and result['errors'],result`);
  expect(result.status, result.stderr).toBe(0);
});
test.each(['fifo', 'symlink', 'oversized'])('evidence reader refuses %s without blocking', kind => {
  const result = python(`import os
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'input'
 if sys.argv[2]=='fifo': os.mkfifo(p)
 elif sys.argv[2]=='symlink':\n  target=pathlib.Path(d)/'target';target.write_text('{}\\n');p.symlink_to(target)
 else:
  with p.open('wb') as f: f.write(b' '*(70*1024*1024))
 try: m.rows(p)
 except (ValueError,OSError,RuntimeError): sys.exit(0)
 sys.exit(1)`.replaceAll('sys.argv[2]', JSON.stringify(kind)));
  expect(result.status, result.stderr).toBe(0);
});
test('all runs the three 5m sequences and leaves ttl-1h to its own lane', () => {
  const result = python(`with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);plugin=root/'plugin';(plugin/'.claude-plugin').mkdir(parents=True);(plugin/'.claude-plugin/plugin.json').write_text('{}')
 seen=[]
 m.run=lambda *a,**k: types.SimpleNamespace(returncode=0,stdout='2.1.302',stderr='')
 def lane(args,output,mode,**kwargs):
  output.mkdir(parents=True,exist_ok=True);seen.append(mode);return {}
 m.lane=lane;m.special=lambda *a: 'PASS mock safety';m.shutil.which=lambda tool: tool
 sys.argv=['runner','--all','--auto-effort-dir',str(plugin),'--output',str(root/'out')]
 result=m.main()
 assert seen==['warm','control','input','delivery','lease','killed'] and result==0,(seen,result)`);
  expect(result.status, result.stderr).toBe(0);
});

test('late API failure becomes VOID during polling rather than a return timeout', () => {
  const result = python(`with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);cwd=root/'work';project=root/'.claude/projects'/m.re.sub(r'[^a-zA-Z0-9]','-',str(cwd));project.mkdir(parents=True)
 debug=root/'.claude/debug';debug.mkdir();(debug/'thread.txt').write_text('')
 m.os.environ={};m.Path.home=classmethod(lambda cls: root);m.marked_pids=lambda marker: []\n clock=[0]\n def now(): clock[0]+=100;return clock[0]\n m.time.monotonic=now;m.time.sleep=lambda seconds: None
 def run(args,**kwargs):
  if args[:3]==['pfm','chat','new']:
   (project/'thread.jsonl').write_text('{}\\n');return types.SimpleNamespace(returncode=0,stdout='cc\tname\towned-socket',stderr='')
  return types.SimpleNamespace(returncode=1 if args[0]=='tmux' else 0,stdout='',stderr='')
 m.run=run
 class Journal:
  def __init__(self,path): self.n=0
  def poll(self):
   self.n+=1;return [{'type':'assistant','message':{'content':'WAITING'}}]+([{'isApiErrorMessage':True}] if self.n>1 else [])
 m.checker.Journal=Journal
 try: m.lane(types.SimpleNamespace(cwd=cwd,auto_effort_dir=root/'plugin'),root/'out','warm')
 except (ValueError,RuntimeError) as e:
  print(e);sys.exit(0 if 'VOID API/auth' in str(e) else 1)
 sys.exit(1)`);
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

function oneHour(warm: boolean) {
  const at = 1000000, gap = warm ? 4001000 : 421000;
  const usage = (read: number) => ({ input_tokens: 1000, output_tokens: 3, cache_read_input_tokens: read, cache_creation_input_tokens: 49000 - read });
  const message = (text: string, offset: number, type = 'assistant') => ({ type, timestamp: new Date(at + offset).toISOString(), message: { model: 'claude-haiku-5-5', content: [{ type: 'text', text }], usage: usage(49000) } });
  return { transcriptPath: 'transcript.jsonl', debug: '', effort: [],
    transcript: [message('WAITING', 0), message('<task-notification>LONG_PROBE_DONE</task-notification>', gap - 1000, 'user'), message('RETURNED', gap), ...requests()],
    log: [{ event: 'LOADED', at, epoch: 0, ttl: '5m', ttlSource: 'assumed' }, { event: 'step', at: at - 500, anchorAt: at - 500, epoch: 1, ttl: '5m', ttlSource: 'assumed' },
      { event: 'step', at, anchorAt: at, epoch: 1, ttl: '1h', ttlSource: 'env' }, { event: 'decision', at, epoch: 1, ttl: '1h', ttlSource: 'env', reason: warm ? 'eligible' : '1h-unproven' },
      ...(warm ? [{ event: 'admit', at: at + 2880000, epoch: 1, ttl: '1h', ttlSource: 'env' }, { event: 'fork', at: at + 2880000, epoch: 1, ttl: '1h', ttlSource: 'env', context: 50000, usage: usage(49000) }] : [])] };
}
function check1h(lane: unknown, warm: boolean) {
  return python(`lane=json.loads(sys.argv[2])
try: print(json.dumps(m.checker.check_1h(lane, ${warm ? 'True' : 'False'})))
except ValueError as e: print(e);sys.exit(2)`.replace('sys.argv[2]', JSON.stringify(JSON.stringify(lane))));
}
test.each([true, false])('1h evidence is accepted (warm1h %s)', warm => {
  const result = check1h(oneHour(warm), warm);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain(warm ? 'PASS ttl-1h refresh' : 'PASS ttl-1h refusal');
});
test.each([
  ['5m-ttl', true, 'ERROR need 1h rows'], ['assumed-source', true, 'ERROR need 1h rows'], ['short-gap', true, 'NOT RUN: main gap'],
  ['two-forks', true, 'FAIL prescribed 1h fork'], ['late-admit', true, 'FAIL 1h admission timing'], ['cold-return', true, 'FAIL 1h refresh did not hold'],
  ['refusal-fork', false, 'FAIL 1h refusal admitted'], ['refusal-reason', false, 'FAIL 1h refusal reason'], ['refusal-cold', false, 'FAIL 1h TTL not in effect'],
] as const)('1h evidence rejects %s', (problem, warm, text) => {
  const lane: any = oneHour(warm), step = lane.log[3], reply = lane.transcript[2];
  if (problem === '5m-ttl') step.ttl = '5m';
  if (problem === 'assumed-source') step.ttlSource = 'assumed';
  if (problem === 'short-gap') reply.timestamp = new Date(1000000 + 3500000).toISOString();
  if (problem === 'two-forks') lane.log.push({ ...lane.log[5], at: 1000000 + 3000000 });
  if (problem === 'late-admit') lane.log[4].at += 10000;
  if (problem === 'cold-return' || problem === 'refusal-cold') reply.message.usage = { input_tokens: 1000, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 49000 };
  if (problem === 'refusal-fork') lane.log.push({ event: 'fork', at: 1200000, epoch: 1, ttl: '1h', ttlSource: 'env' });
  if (problem === 'refusal-reason') step.reason = 'eligible';
  const result = check1h(lane, warm);
  expect(result.status, result.stdout + result.stderr).toBe(2);
  expect(result.stdout).toContain(text);
});
test.each(['pair', '1h'])('a request keeping fewer messages than its base sent voids the lane before any cache verdict (%s)', kind => {
  const rewrite = (lane: any) => { lane.transcript.find((r: any) => r.id === 'r3').keep = 1; lane.log.find((r: any) => r.event === 'fork').usage.cache_read_input_tokens = 34000; };
  const input: any = kind === 'pair' ? pair() : oneHour(true);
  rewrite(kind === 'pair' ? input.lanes[0] : input);
  const result = kind === 'pair' ? checkPair(input) : check1h(input, true);
  expect(result.status, result.stdout + result.stderr).toBe(2);
  expect(result.stdout).toContain('VOID prefix rewritten mid-lane: request r3 kept 1 of 4 messages');
});
test('a lane without main-thread request records is not run, never clean', () => {
  const input: any = pair();
  input.lanes[1].transcript = input.lanes[1].transcript.filter((r: any) => r.type !== 'api-request');
  expect(checkPair(input).stdout).toContain('NOT RUN: main-thread request records missing');
});
test('cleanup treats a never-launched chat as gone once processes and socket are verified', () => {
  const result = python(`def run(args,**kwargs):
 if args[0]=='pfm': return types.SimpleNamespace(returncode=1,stdout='owned\\tnot-found\\n',stderr='pfm chat: no chat named "owned"\\n')
 return types.SimpleNamespace(returncode=1,stdout='',stderr='')
m.run=run;m.marked_pids=lambda marker: []
result=m.cleanup('owned','marker',None)
assert result['nativeSocketClosed'] and result['errors']==[] and result['ownedProcessesRemaining']==[],result`);
  expect(result.status, result.stderr).toBe(0);
});
test('launch prompt stays under the single-argument limit', () => {
  const result = python(`text=m.launch_text(4000)
assert len(text.encode()) < m.ARG_LIMIT < 131072, len(text.encode())
assert 'STEPS' not in text and 'run_in_background true' not in text, text[:600]`);
  expect(result.status, result.stderr).toBe(0);
});
test('lane logs follow the real file names: plugin {session}.{instance}, auto-effort effort.{session}', () => {
  const result = python(`with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d)
 (root/'s1.i1.jsonl').write_text('{"event":"LOADED"}\\n');(root/'effort.s1.jsonl').write_text('{"event":"step"}\\n');(root/'effort.s1.2.jsonl').write_text('{"event":"step","n":2}\\n')
 assert [p.name for p in m.plugin_logs(root)]==['s1.i1.jsonl'],m.plugin_logs(root)
 assert m.effort_rows(root)==[{'event':'step'},{'event':'step','n':2}],m.effort_rows(root)
 assert m.debug_text(root)==('',False)
 for p in root.glob('effort.*'): p.unlink()
 try: m.effort_rows(root)
 except RuntimeError as e: assert 'need auto-effort log' in str(e);sys.exit(0)
 sys.exit(1)`);
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
test.each([[755, [590, 165]], [4000, [590, 590, 590, 590, 590, 590, 460]], [420, [420]], [1180, [590, 590]]])('probe for %ss sleeps in foreground chunks under the Bash ceiling', (seconds, chunks) => {
  const result = python(`steps=m.probe_steps(${seconds})
found=[int(n) for n in m.re.findall(r'time.sleep\\((\\d+)\\)', steps)]
assert found==${JSON.stringify(chunks)} and steps.count('LONG_PROBE_DONE')==1 and steps.endswith('LONG_PROBE_DONE")'+chr(39)+chr(96)),(found,steps)`);
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
test('owned socket is read from the launch line on either stream', () => {
  const result = python(`launched=types.SimpleNamespace(stdout='WAITING\\n',stderr='cc\\tkw-x\\tcc-1-2-3\\tnamed\\tlisted\\nattach: tmux -L cc-1-2-3\\n')
assert m.owned_socket(launched.stdout+'\\n'+launched.stderr)=='cc-1-2-3'
assert m.owned_socket('WAITING\\n') is None`);
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
test.each([[{ at: 5 }, 5], [{ ts: 7 }, 7], [{ timestamp: '1970-01-01T00:00:01Z' }, 1000], [{ ts: '1970-01-01T00:00:02Z' }, 2000]])('timestamp reads every evidence stamp %#', (record, expected) => {
  const result = python(`print(m.checker.timestamp(json.loads(sys.argv[2])))`.replace('sys.argv[2]', JSON.stringify(JSON.stringify(record))));
  expect(result.status, result.stderr).toBe(0); expect(Number(result.stdout.trim())).toBe(expected);
});
test('the WAITING turn\'s own late step row is not wait-time effort work', () => {
  const input: any = pair();
  input.lanes[0].effort = [{ event: 'step', ts: 1001005, turnId: 'w' }, { event: 'turn', ts: 1001010, turnId: 'w' }];
  expect(checkPair(input).status).toBe(0);
});
test.each([[true, 0], [false, 2]])('a reply split into thinking and text records is one response (same id %s)', (same, status) => {
  const input: any = pair(), control = input.lanes[1], reply = control.transcript[2];
  reply.message.id = 'msg_a';
  control.transcript.splice(2, 0, { ...reply, message: { ...reply.message, id: same ? 'msg_a' : 'msg_b', content: [{ type: 'thinking', thinking: '' }] } });
  expect(checkPair(input).status).toBe(status);
});
test('a tool call quoting the reply words is not a reply', () => {
  const input: any = pair(), warm = input.lanes[0];
  warm.transcript.splice(0, 0, { type: 'assistant', timestamp: new Date(1000500).toISOString(), message: { model: 'claude-haiku-5-5', content: [{ type: 'tool_use', name: 'Agent', input: { prompt: 'reply WAITING, then RETURNED' } }] } });
  expect(checkPair(input).status, checkPair(input).stdout).toBe(0);
  const result = python(`r={'type':'assistant','message':{'content':[{'type':'tool_use','input':{'prompt':'reply RETURNED'}}]}}
assert 'RETURNED' not in m.content(r) and m.content({'message':{'content':'PONG'}})=='PONG'`);
  expect(result.status, result.stderr).toBe(0);
});
test('a stop signal mid-lane runs the lane cleanup and starts no later lane', () => {
  const result = python(`import os,signal,time
tmp=pathlib.Path(tempfile.mkdtemp()); (tmp/'ae/.claude-plugin').mkdir(parents=True); (tmp/'ae/.claude-plugin/plugin.json').write_text('{}')
m.shutil.which=lambda tool:'/bin/true'
m.run=lambda cmd,**k: subprocess.CompletedProcess(cmd,0,'2.1.302 (Claude Code)','')
calls=[]
def lane(args,directory,mode,**k):
 calls.append(mode)
 try:
  os.kill(os.getpid(),signal.SIGTERM); time.sleep(3)
 finally: print('CLEANED '+mode,flush=True)
 return {}
m.lane=lane
sys.argv=['live-proof','--all','--cwd',str(tmp),'--output',str(tmp/'out'),'--auto-effort-dir',str(tmp/'ae')]
print('RESULT',json.dumps({'calls':calls,'code':m.main()}))`);
  expect(result.stdout).toContain('CLEANED warm');
  expect(result.stdout).toContain('STOPPED live: signal 15');
  expect(result.stdout).toContain('RESULT {"calls": ["warm"], "code": 143}');
});
test('a stop signal during a cleanup waits for the cleanup to finish', () => {
  const result = python(`import os,signal
m.stop_on_signals()
def run(cmd,**k):
 if cmd[:3]==['pfm','chat','kill']: os.kill(os.getpid(),signal.SIGTERM)
 return subprocess.CompletedProcess(cmd,0,'','')
m.run=run; m.marked_pids=lambda marker: []
r=m.cleanup('kw-x','marker',None)
print(json.dumps({'signal':m.STOP['signal'],'closed':r['nativeSocketClosed'],'errors':r['errors']}))`);
  expect(result.stdout.trim(), result.stderr).toBe('{"signal": 15, "closed": true, "errors": []}');
});
