import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runner } from './live-fixtures.ts';
const tmux = spawnSync('tmux', ['-V']).status === 0;
// Real tmux, a stand-in claude: the lane's own server hands claude the lane env and the prompt as one argument, and
// cleanup leaves no marked process and no server behind.
test.skipIf(!tmux)('a lane chat launched through real tmux gets its env and prompt, and cleanup ends it', () => {
  const result = spawnSync('python3', ['-I', '-B', '-c', `import importlib.util,sys,os,json,pathlib,secrets,subprocess,tempfile,time
spec=importlib.util.spec_from_file_location('runner',sys.argv[1]); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
marker=secrets.token_hex(10);socket='kw-test-'+marker[:8]
try:
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);bin=root/'bin';bin.mkdir();out=root/'argv.json';prompt=root/'prompt.txt'
  (bin/'claude').write_text('#!/usr/bin/env python3\\nimport json,os,sys,time\\nopen(os.environ["KW_TEST_OUT"],"w").write(json.dumps(sys.argv[1:]))\\ntime.sleep(600)\\n');(bin/'claude').chmod(0o755)
  text='line one "quoted" $HOME \\'single\\'\\nline two';prompt.write_text(text)
  env=dict(os.environ,PATH=str(bin)+os.pathsep+os.environ['PATH'],KW_TEST_OUT=str(out),CACHE_KEEPWARM_LIVE_RUN=marker)
  launched=m.start_chat(socket,root,prompt,env)
  assert launched.returncode==0,launched.stderr
  deadline=time.monotonic()+15
  while not out.exists() and time.monotonic()<deadline: time.sleep(.1)
  time.sleep(.2)
  assert json.loads(out.read_text())==['--model','claude-haiku-5-5','--effort','low',text],out.read_text()
  assert m.marked_pids(marker),'no marked process'
  result=m.cleanup(socket,marker,socket)
  assert result['nativeSocketClosed'] and result['ownedProcessesRemaining']==[] and result['errors']==[],result
  print('LAUNCHED AND CLEANED')
finally: subprocess.run(['tmux','-L',socket,'kill-server'],capture_output=True)`, runner], { encoding: 'utf8', timeout: 30000 });
  expect(result.stdout, result.stderr).toContain('LAUNCHED AND CLEANED');
});
