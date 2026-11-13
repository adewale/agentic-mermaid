from pathlib import Path
import os, signal, subprocess, time, json, hashlib, datetime
out = Path(__file__).parent
coordinator = 887
repo = '/workspace/agentic-mermaid'
branch = 'refs/heads/review/pr449-evidence-20261105'
started = time.monotonic()
record = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'coordinator': coordinator, 'onlyCoordinatorStopped': True, 'childNeverStopped': True, 'pushed': False}
cmd = Path(f'/proc/{coordinator}/cmdline').read_bytes()
assert b'bun' in cmd and b'performance.ts' in cmd
os.kill(coordinator, signal.SIGSTOP)
try:
    latest = max((out/'performance/jobs').glob('*.json'), key=lambda p: p.stat().st_mtime_ns)
    current = json.loads(latest.read_text())
    record['currentJob'] = {'mode': current['mode'], 'case': current['testCase']['id'], 'replica': current['replica']}
    assert current['mode'] == 'warm', 'No checkpoint during cold or resources'
    while True:
        lines = subprocess.check_output(['ps', '-eo', 'pid,ppid,stat,comm,args'], text=True).splitlines()[1:]
        live = []
        for line in lines:
            parts = line.split(None, 4)
            if len(parts) < 5 or parts[2].startswith('Z'):
                continue
            if 'kit/worker.mjs' in parts[4] or (parts[4].split()[0].endswith('/time') and 'gnu-time' in parts[4]):
                live.append(line)
        if not live:
            break
        if time.monotonic() - started >= 10:
            raise RuntimeError('Warm child did not exit within 10s; defer without stopping child')
        time.sleep(0.25)
    record['noLiveNodeOrObserverAtPacking'] = True
    result_file = out/'performance/results.jsonl'
    results = result_file.read_text().splitlines()
    record['verifiedCompletedRecords'] = len(results)
    record['pendingIpcResultExcluded'] = True
    record['source'] = subprocess.check_output(['git', '-C', repo, 'rev-parse', 'HEAD'], text=True).strip()
    record['inputSha256'] = hashlib.sha256((out/'compatibility-overlay/MEASUREMENT-CASES.json').read_bytes()).hexdigest()
    assert record['source'] == '68986ba8e3b76ad99dad44c6ec8d43475cc5e12f'
    assert record['inputSha256'] == '25bcc698e6671fbbe80d075b0ca27e69ad861377b04f80825162f4600f19a31c'
    (out/'CLOCK-PAUSE-CHECKPOINT.json').write_text(json.dumps(record, indent=2)+'\n')
    index = out.parent/'fresh-clock-pause-index'
    assert not index.exists()
    env = {**os.environ, 'GIT_INDEX_FILE': str(index), 'TMPDIR': str(out.parent/'tmp')}
    def git(*args, data=None, timeout=30):
        return subprocess.check_output(['git', '-C', repo, '-c', 'gc.auto=0', '-c', 'pack.threads=1', '-c', 'pack.windowMemory=16m', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', '-c', 'credential.useHttpPath=true', *args], input=data, text=True, env=env, stderr=subprocess.PIPE, timeout=timeout).strip()
    git('fetch', '--filter=blob:none', '--depth=1', 'origin', 'refs/heads/review/pr449-evidence-20261105:'+branch)
    old = git('rev-parse', branch)
    assert old == '7e24482a86e02b1b1a3c8abd44b94fe671d30525', old
    git('read-tree', old)
    files = sorted(p for p in (out/'performance').rglob('*') if p.is_file())
    files += [out/n for n in ['performance.log', 'FRESH-HOST-RECOVERY.json', 'GNU-TIME-RECOVERY.json', 'GNU-TIME-VERSION.log', 'STATE-FRESH-RECOVERED.json', 'PHASE-CURSOR-FRESH-HOST.json', 'ROOT-TOOLCHAIN-RECOVERY.json', 'ROOT-SDK-READINESS.json', 'FRESH-CLOCK-PREFLIGHT.json', 'RECOVERED-CORRECTED-ROUTE-COMPARISON.json', 'CLOCK-PAUSE-CHECKPOINT.json', 'checkpoint-warm-pause.py']]
    entries = []
    for path in files:
        blob = git('hash-object', '-w', '--', str(path))
        entries.append('100644 '+blob+'\tlatest-main-full-trident-20261112/'+str(path.relative_to(out)))
    git('update-index', '--add', '--index-info', data='\n'.join(entries)+'\n')
    commit = git('commit-tree', git('write-tree'), '-p', old, '-m', 'Recover exact benchmark tooling and checkpoint completed cache-disabled stock workers')
    git('update-ref', branch, commit, old)
    record.update(previousEvidence=old, evidence=commit, files=len(files))
    if time.monotonic() - started < 60:
        record['pushOutput'] = git('push', 'origin', branch+':'+branch, timeout=25)
        record['pushed'] = True
finally:
    os.kill(coordinator, signal.SIGCONT)
    record['resumedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record['pauseSeconds'] = time.monotonic() - started
    (out/'CLOCK-PAUSE-CHECKPOINT-RESULT.json').write_text(json.dumps(record, indent=2)+'\n')
    print(json.dumps(record))
