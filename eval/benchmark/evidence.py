"""Read Trident gzip/reference documents and legacy inline JSON; never measure."""
import gzip
import hashlib
import json
from pathlib import Path


def read_document(source):
    return _read(Path(source), set(), False)


def _read(source, visited, project_record, expected=None):
    if expected and source.is_symlink():
        raise ValueError('Canonical output must be a regular file, not a symlink')
    source = source.resolve()
    if not expected and not source.is_file() and Path(str(source) + '.gz').is_file():
        source = Path(str(source) + '.gz')
    if source in visited:
        raise ValueError('Cyclic benchmark result reference')
    visited.add(source)
    data = source.read_bytes()
    if expected and (len(data) != expected.get('bytes') or hashlib.sha256(data).hexdigest() != expected.get('sha256')):
        raise ValueError('Canonical output differs from its immutable reference')
    value = json.loads(gzip.decompress(data) if source.suffix == '.gz' else data)
    if not isinstance(value, dict):
        return value
    kind = value.get('kind') if value.get('schemaVersion') == 2 else None
    if kind in ('benchmark-result-reference', 'project-benchmark-record-reference'):
        proof = value.get('payload', {})
        name = proof.get('path')
        if not isinstance(name, str) or not isinstance(proof.get('bytes'), int) or isinstance(proof['bytes'], bool) or proof['bytes'] < 0 or not isinstance(proof.get('sha256'), str) or len(proof['sha256']) != 64:
            raise ValueError('Invalid benchmark output reference')
        target = Path(name)
        if not target.is_absolute():
            if kind != 'benchmark-result-reference' or name in ('', '.', '..') or target.name != name or '\\' in name:
                raise ValueError('Relative output reference must be a sibling basename')
            target = source.parent / target
        result = _read(target, visited, kind == 'benchmark-result-reference', proof)
        if kind == 'project-benchmark-record-reference':
            record = result
            if record.get('id') != value.get('id') or record.get('identity', {}).get('project') != value.get('project') or record.get('identity', {}).get('lane', 'community') != value.get('lane', 'community'):
                raise ValueError('Record identity differs from its reference')
            return {**record.get('provenance', {}), 'observations': record['observations']} if project_record else record
        return result
    if project_record and value.get('schemaVersion') == 1 and 'identity' in value and isinstance(value.get('observations'), list) and isinstance(value.get('evidenceDirectory'), str):
        return {**value.get('provenance', {}), 'observations': value['observations']}
    return value
