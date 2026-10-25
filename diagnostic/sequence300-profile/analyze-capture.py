"""Read retained profiles only. No renderer imports, timers, source or peer runs."""
import collections, hashlib, json, pathlib, sys

root = pathlib.Path(sys.argv[1]).resolve()
bindings_path = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
binding_receipt = json.loads(bindings_path.read_text()) if bindings_path else {'mappings': []}
bindings = {(row['bundle'].removeprefix('package/'), row['functionName'], row['line0'], row['column0Utf16']): row['source'] for row in binding_receipt['mappings']}
assert len(bindings) == len(binding_receipt['mappings']), 'duplicate frame bindings'
summary, witnesses, total_attempts = {}, {}, 0


def frame_key(frame):
    marker = '/node_modules/agentic-mermaid/'
    bundle = frame['url'].split(marker, 1)[1] if marker in frame['url'] else frame['url'].split('/')[-1]
    return bundle, frame['functionName'], frame['lineNumber'], frame['columnNumber']


def category(frame):
    if frame_key(frame) in bindings:
        return bindings[frame_key(frame)]
    url, name = frame['url'], frame['functionName']
    if name == '(garbage collector)': return '[V8 GC]'
    if name.startswith('RegExp:'): return '[V8 RegExp]'
    if url.startswith('node:inspector'): return '[inspector control]'
    if url.startswith('node:'): return '[other Node internals]'
    if url.endswith('/peer-tracks.ts') and name == 'consumePeerOutput': return '[maintained UTF8 consumer]'
    if url.endswith('/diagnostic/profile-worker.mjs'): return '[profile harness]'
    if 'elk.bundled' in url: return '[ELK]'
    if url.startswith('wasm:'): return '[Wasm]'
    if not url: return '[unmapped native/V8]'
    if '/node_modules/agentic-mermaid/dist/' in url: return '[unmapped package frame]'
    return '[other JS]'


def checksum(value):
    result = 0
    for byte in value.encode('utf8'): result = (result * 31 + byte) & 0xffffffff
    return result


for stem in ['cpu-svg-utf8', 'cpu-receipt-json-utf8', 'allocation-svg-utf8', 'allocation-receipt-json-utf8']:
    directory = root / stem
    operation = json.loads((directory / 'operation.json').read_text())
    job = json.loads((directory / 'job.json').read_text())
    count = 51 if operation['mode'] == 'cpu' else 16
    assert operation['sourceRevision'] == job['sourceRevision'] and operation['archiveSha256'] == job['archiveSha256']
    assert operation['runtime']['node'] == '24.19.0'
    assert operation['profiler'] == ({'interval':100} if operation['mode']=='cpu' else {'samplingInterval':32768,'includeObjectsCollectedByMajorGC':True,'includeObjectsCollectedByMinorGC':True})
    assert operation['status'] == 'completed' and operation['profileComplete'] and not operation['errors']
    assert operation['settings'] == {'elkCache':'0','sceneAssertions':'0','experiments':None}
    assert operation['execArgv'] == ['--expose-gc']
    assert len(operation['warm']) == 51 and len(operation['observations']) == operation['attempted'] == operation['completed'] == count
    assert [row['ordinal'] for row in operation['warm']] == list(range(1,52))
    assert all(row['domain']=='warmup' for row in operation['warm'])
    assert len(operation['diagnostics']) == 2 and len(operation['inputs']) == 51 + count + 2
    assert operation['fixture']['id'] == 'sequence:20-participants-300-messages' and operation['fixture']['source'] == job['source']
    assert operation['fixture']['expectedSvgLabels'] == job['expectedSvgLabels']
    assert all(row['status'] == 'ok' for row in operation['warm'] + operation['observations'])
    assert [row['ordinal'] for row in operation['observations']] == list(range(1, count + 1))
    assert all(row['domain']==('profile-cpu' if operation['mode']=='cpu' else 'profile-allocation') for row in operation['observations'])
    assert len({(row['domain'],row['ordinal']) for row in operation['inputs']}) == len(operation['inputs'])
    assert [row['ordinal'] for row in operation['diagnostics']] == [1,2]
    assert all(row['semantic']['ok'] and not row['missing'] for row in operation['warm'] + operation['diagnostics'])
    assert operation['finalProfileValidation']['semantic']['ok'] and not operation['finalProfileValidation']['missing']
    for row in operation['diagnostics']:
        assert any(event['kind'] == 'scope' for event in row['events'])
        assert any(event['kind'] == 'cache' and event['owner'] == 'positioned-layout' and event['outcome'] == 'bypass' and event.get('reason') == 'elk-cache-disabled' for event in row['events'])
    for witness in [operation['finalProfileWitness']] + [row['witness'] for row in operation['diagnostics']]:
        value = witness['svg'] if operation['consumer'] == 'svg-utf8' else witness['recordJson']
        assert len(value.encode('utf8')) == witness['bytes'] and checksum(value) == witness['checksum']
        if operation['consumer'] != 'svg-utf8': assert json.loads(value)['svg'] == witness['svg']
    last = operation['observations'][-1]
    assert all((row['bytes'],row['checksum'])==(last['bytes'],last['checksum']) for row in operation['observations']), 'exact-source consumed checksum/length changed'
    assert (last['bytes'], last['checksum']) == (operation['finalProfileWitness']['bytes'], operation['finalProfileWitness']['checksum'])
    witnesses[stem] = operation['finalProfileWitness']['svg']
    total_attempts += 51 + count + 2
    path = directory / ('profile.cpuprofile' if operation['mode'] == 'cpu' else 'allocation.heapprofile')
    profile = json.loads(path.read_text())
    nodes, parents = {}, {}
    if operation['mode'] == 'cpu':
        nodes = {row['id']: row for row in profile['nodes']}
        for row in nodes.values():
            for child in row.get('children', []):
                assert child not in parents
                parents[child] = row['id']
        assert len(profile['samples']) == len(profile['timeDeltas'])
        observed = list(zip(profile['samples'], profile['timeDeltas']))
        metric = 'rawDeltaMicros'
    else:
        def visit(row, parent=None):
            assert row['id'] not in nodes
            nodes[row['id']] = row
            if parent is not None: parents[row['id']] = parent
            for child in row.get('children', []): visit(child, row['id'])
        visit(profile['head'])
        assert all(row['nodeId'] in nodes for row in profile['samples'])
        observed = [(key, row['selfSize']) for key, row in nodes.items()]
        metric = 'sampledHeadSelfBytes'
    assert len(parents) == len(nodes) - 1
    paths = {}
    for key in nodes:
        route, seen, current = [], set(), key
        while True:
            assert current not in seen
            seen.add(current); route.append(current)
            if current not in parents: break
            current = parents[current]
        paths[key] = route
    exclusive, ownership, inclusive, frames = [collections.Counter() for _ in range(4)]
    for key, weight in observed:
        assert key in nodes
        own = category(nodes[key]['callFrame'])
        exclusive[own] += weight
        frames[frame_key(nodes[key]['callFrame'])] += weight
        if own in ['[unmapped package frame]', '[unmapped native/V8]', '[V8 RegExp]']:
            for ancestor in paths[key]:
                candidate = category(nodes[ancestor]['callFrame'])
                if not candidate.startswith('[') or candidate in ['[maintained UTF8 consumer]', '[inspector control]']:
                    own = candidate; break
        ownership[own] += weight
        for name in {category(nodes[ancestor]['callFrame']) for ancestor in paths[key]}: inclusive[name] += weight
    total = sum(weight for _, weight in observed)
    assert sum(exclusive.values()) == sum(ownership.values()) == total
    receipt = {'mode': operation['mode'], 'consumer': operation['consumer'], 'warm': 51, 'profiled': count, 'diagnostic': 2, 'attempts': 51 + count + 2, 'sourceRevision': job['sourceRevision'], 'archiveSha256': job['archiveSha256'], 'profileSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'metric': metric, 'total': total, 'nodes': len(nodes), 'samples': len(profile['samples']), 'exclusiveSelf': dict(exclusive.most_common()), 'nearestKnownAnchorOwnership': dict(ownership.most_common()), 'inclusiveUnionByMappedSource': {key: value for key, value in inclusive.items() if not key.startswith('[')}, 'directSelfByFrame': [{'bundle': key[0], 'function': key[1], 'line0': key[2], 'column0': key[3], metric: value} for key, value in frames.most_common()]}
    if bindings:
        members=json.loads((root/'shipped-members.json').read_text())
        for row in binding_receipt['mappings']:
            assert members[row['bundle'].removeprefix('package/')]['sha256']==row['bundleSha256']
        assert binding_receipt['sourceRevision'] == job['sourceRevision'] and binding_receipt['archiveSha256'] == job['archiveSha256']
    if operation['mode'] == 'cpu':
        receipt.update({'profileSpanMicros': profile['endTime'] - profile['startTime'], 'negativeDeltas': sum(value < 0 for value in profile['timeDeltas']), 'negativeDeltaSum': sum(value for value in profile['timeDeltas'] if value < 0), 'nodeHitCountSum': sum(row.get('hitCount', 0) for row in nodes.values())})
    else:
        array_total = sum(row['size'] for row in profile['samples'])
        receipt.update({'sampleArraySizeTotal': array_total, 'sampleArrayMinusHead': array_total - total, 'sampledHeadBytesPerCall': total / count})
    summary[stem] = receipt
assert total_attempts == 346
assert witnesses['cpu-svg-utf8'] == witnesses['cpu-receipt-json-utf8']
assert witnesses['allocation-svg-utf8'] == witnesses['allocation-receipt-json-utf8']
(root / 'attribution.json').write_text(json.dumps({'attempts': total_attempts, 'bindings': len(bindings), 'mappingStatus': 'exact-artifact anchors supplied; source correspondence requires review' if bindings else 'not-yet-bound; unknown package mass retained', 'comparative': False, 'profiles': summary}, indent=2))
print(json.dumps({'attempts': total_attempts, 'accountingComplete': True, 'bindings': len(bindings), 'comparative': False}))
