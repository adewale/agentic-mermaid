"""One approved archive, four serial diagnostics; never builds or times a render."""
import hashlib, io, json, os, pathlib, shutil, signal, subprocess, sys, tarfile, time

config_path = pathlib.Path(sys.argv[1]).resolve()
config = json.loads(config_path.read_text())
out = pathlib.Path(config['out']).resolve()
assert not out.exists(), 'fresh evidence directory already exists'
out.mkdir(parents=True)
source = pathlib.Path(config['sourceRoot']).resolve()
harness = pathlib.Path(config['harnessRoot']).resolve()
artifact = pathlib.Path(config['artifactRoot']).resolve()
prefix = pathlib.Path(config['prefix']).resolve()
node, bun = config['node'], config['bun']
started = time.monotonic()
receipt = {'status': 'starting', 'comparative': False, 'sourceRevision': config['sourceRevision'], 'archiveSha256': config['archiveSha256'], 'artifactRunId': config['artifactRunId'], 'artifactId': config['artifactId'], 'steps': [], 'complete': False}
env = os.environ.copy()
for key in ['AGENTIC_MERMAID_EXPERIMENTS', 'NODE_OPTIONS', 'BUN_OPTIONS', 'NODE_COMPILE_CACHE', 'NODE_PATH']:
    env.pop(key, None)
env.update({'AGENTIC_MERMAID_ELK_CACHE': '0', 'AGENTIC_MERMAID_SCENE_ASSERTIONS': '0'})
env['PATH'] = str(pathlib.Path(node).parent) + ':' + str(pathlib.Path(bun).parent) + ':' + env['PATH']


def save():
    (out / 'controller.json').write_text(json.dumps(receipt, indent=2))


def reserve():
    for path in [out, prefix.parent]:
        free = shutil.disk_usage(path).free
        if free < 80 * 1024 * 1024:
            raise RuntimeError(f'{path}: below80MiB reserve ({free})')


def run(name, command, limit, cwd=harness):
    reserve()
    deadline = min(limit, 660 - (time.monotonic() - started))
    if deadline <= 0:
        raise RuntimeError('controller660s deadline')
    with (out / f'{name}.stdout.log').open('w') as stdout, (out / f'{name}.stderr.log').open('w') as stderr:
        proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            proc.wait(timeout=deadline)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            receipt['steps'].append({'name': name, 'timeout': deadline, 'exitCode': proc.returncode})
            save()
            raise
    receipt['steps'].append({'name': name, 'exitCode': proc.returncode})
    save()
    if proc.returncode:
        raise RuntimeError(f'{name}: failed exit{proc.returncode}; no replacement worker')
    reserve()


try:
    reserve()
    bound = json.loads((config_path.parent / 'bound-inputs.json').read_text())
    for field in ['sourceRevision', 'artifactRunId', 'artifactId', 'archiveSha256', 'archiveIntegrity', 'buildHarnessRevision', 'profileHarnessParent']:
        assert config[field] == bound[field], f'approved artifact tuple differs: {field}'
    assert min(shutil.disk_usage(path).free for path in [out, prefix.parent]) >= 512 * 1024 * 1024, 'need512MiB before fresh acquisition'
    assert not prefix.exists(), 'fresh prefix already exists'
    assert subprocess.check_output(['git', '-C', str(harness), 'rev-parse', 'HEAD^'], text=True).strip() == config['profileHarnessParent'], 'profile helper must be a single reviewed child of frozen H075'
    assert subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() == config['sourceRevision']
    assert subprocess.check_output([node, '--version'], text=True).strip() == 'v24.19.0'
    assert subprocess.check_output([bun, '--version'], text=True).strip() == '1.4.2'
    assert subprocess.check_output(['npm', '--version'], env=env, text=True).strip() == '11.18.0'
    package = artifact / 'baseline/package'
    policy = artifact / 'baseline/runtime-source'
    packed = package / 'package.tgz'
    manifest = json.loads((package / 'package-manifest.json').read_text())
    provenance = json.loads((artifact / 'baseline/provenance.json').read_text())
    assert provenance['sourceRevision'] == config['sourceRevision'] and provenance['archiveSha256'] == config['archiveSha256']
    assert provenance['harnessRevision'] == provenance['workflowRevision'] == config['buildHarnessRevision']
    expected_runtime = json.loads((artifact / 'baseline/closure/runtime/baseline.runtime.json').read_text())
    assert json.loads((artifact / 'baseline/closure/runtime.json').read_text())['node'] == '24.19.0'
    receipt['buildProvenance'] = provenance
    receipt['harnessRevision'] = subprocess.check_output(['git', '-C', str(harness), 'rev-parse', 'HEAD'], text=True).strip()
    (out / 'build-provenance.json').write_text(json.dumps(provenance, indent=2))
    data = packed.read_bytes()
    assert hashlib.sha256(data).hexdigest() == config['archiveSha256'] == manifest['sha256']
    integrity = 'sha512-' + __import__('base64').b64encode(hashlib.sha512(data).digest()).decode()
    assert integrity == manifest['integrity'] == config['archiveIntegrity']
    for filename in ['package.json', 'bun.lock']:
        assert (policy / filename).read_bytes() == (source / filename).read_bytes(), filename
    members = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            if member.isdir():
                continue
            assert member.isfile() and member.name.startswith('package/'), member.name
            relative = pathlib.PurePosixPath(member.name.removeprefix('package/'))
            assert not relative.is_absolute() and '..' not in relative.parts and str(relative) not in members, member.name
            content = archive.extractfile(member).read()
            members[str(relative)] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
            if str(relative) == 'package.json':
                assert content == (source / 'package.json').read_bytes()
    assert sorted(members) == sorted(manifest['files'])
    receipt.update({'shippedFiles': len(members), 'frozenPolicyBytesMatchSelectedSource': True, 'archiveIntegrity': integrity})
    (out / 'package-manifest.json').write_text(json.dumps(manifest, indent=2))
    (out / 'shipped-members.json').write_text(json.dumps(members, indent=2))
    run('acquisition', [bun, 'run', str(harness / 'eval/benchmark/release-baseline.ts'), '--install', str(packed), '--prefix', str(prefix), '--runtime-source', str(policy), '--out', str(out / 'acquisition'), '--label', 'baseline', '--expected-integrity', integrity], 180)
    package_root = prefix / 'node_modules/agentic-mermaid'
    runtime = json.loads((out / 'acquisition/baseline.runtime.json').read_text())
    assert runtime['graph'] and all(row['integrity'] for row in runtime['graph'])
    assert runtime['graph'] == expected_runtime['graph'], 'runtime graph differs from bound build closure'
    receipt['runtimeGraphVerifiedByMaintainedAcquisition'] = True
    diagnostic = prefix / 'diagnostic'
    diagnostic.mkdir()
    for filename in ['peer-tracks.ts', 'bench-stats.ts', 'release-bench-cases.ts', 'release-bench-fidelity.ts']:
        original = source / 'eval/benchmark' / filename
        shutil.copyfile(original, diagnostic / filename)
        assert original.read_bytes() == (diagnostic / filename).read_bytes()
    shutil.copyfile(config_path.parent / 'profile-worker.mjs', diagnostic / 'profile-worker.mjs')
    fixture_program = "const {releaseBenchCases}=await import(process.argv[1]);const value=releaseBenchCases().find(x=>x.id==='sequence:20-participants-300-messages');if(!value)throw Error('missing release case');console.log(JSON.stringify(value))"
    fixture = json.loads(subprocess.check_output([node, '--input-type=module', '-e', fixture_program, (diagnostic / 'release-bench-cases.ts').as_uri()], cwd=diagnostic, env=env, text=True))
    (out / 'fixture.json').write_text(json.dumps(fixture, indent=2))
    attempts = 0
    for mode, consumer in [('cpu', 'svg-utf8'), ('cpu', 'receipt-json-utf8'), ('allocation', 'svg-utf8'), ('allocation', 'receipt-json-utf8')]:
        name = f'{mode}-{consumer}'
        directory = out / name
        directory.mkdir()
        job = {'sourceRevision': config['sourceRevision'], 'archiveSha256': config['archiveSha256'], 'mode': mode, 'consumer': consumer, 'packageRoot': str(package_root), 'reserveRoot': str(out), 'source': fixture['source'], 'expectedSvgLabels': fixture['expectedSvgLabels'], 'members': members, 'profile': str(directory / ('profile.cpuprofile' if mode == 'cpu' else 'allocation.heapprofile')), 'result': str(directory / 'operation.json')}
        path = directory / 'job.json'
        path.write_text(json.dumps(job))
        run(name, [node, '--expose-gc', str(diagnostic / 'profile-worker.mjs'), str(path)], 120)
        operation = json.loads((directory / 'operation.json').read_text())
        count = 51 if mode == 'cpu' else 16
        assert operation['status'] == 'completed' and operation['profileComplete'] and not operation['errors']
        assert len(operation['warm']) == 51 and operation['attempted'] == operation['completed'] == count and len(operation['diagnostics']) == 2
        attempts += 51 + count + 2
    assert attempts == 346
    for relative, binding in members.items():
        content = (package_root / relative).read_bytes()
        assert len(content) == binding['bytes'] and hashlib.sha256(content).hexdigest() == binding['sha256'], relative
    runtime_check = out / 'inspect-runtime.ts'
    runtime_check.write_text('import { frozenRuntimePolicy, inspectAgenticRuntime } from ' + json.dumps((harness / 'eval/benchmark/release-baseline.ts').as_uri()) + ';\nconst [root, policy, out] = process.argv.slice(2);\nconsole.log(JSON.stringify(inspectAgenticRuntime(root, frozenRuntimePolicy(policy), out, "after")));\n')
    run('after-runtime', [bun, 'run', str(runtime_check), str(package_root), str(policy), str(out / 'after-runtime')], 30)
    after_runtime = json.loads((out / 'after-runtime/after.runtime.json').read_text())
    assert after_runtime['graph'] == runtime['graph'], 'runtime graph changed during profiling'
    run('analyze-capture', [sys.executable, str(config_path.parent / 'analyze-capture.py'), str(out)], 30)
    receipt.update({'complete': True, 'status': 'completed', 'attempts': attempts, 'afterMembersVerified': True, 'afterRuntimeGraphVerified': True})
    reserve()
except BaseException as error:
    receipt.update({'status': 'failed', 'complete': False, 'error': {'name': type(error).__name__, 'message': str(error)}})
finally:
    save()
print(json.dumps(receipt))
if not receipt['complete']:
    sys.exit(1)
