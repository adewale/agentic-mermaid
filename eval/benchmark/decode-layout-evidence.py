"""Expand interned benchmark evidence and verify its original canonical hashes.

Usage: python eval/benchmark/decode-layout-evidence.py archive.json.gz output.json
Only reads JSON; it never executes the decoder text embedded in the archive.
"""
import argparse
import gzip
import hashlib
import json
import pathlib


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, allow_nan=False).encode('utf8')


def decode(document):
    if document.get('format') != 'lossless-json-intern@1':
        raise ValueError('Expected lossless-json-intern@1 evidence')
    memo, active = {}, set()

    def expand(value):
        if isinstance(value, dict):
            if set(value) == {'$r'}:
                kind, index = value['$r']
                if kind == 's':
                    return document['strings'][index]
                if kind != 'n' or index in active:
                    raise ValueError('Invalid or cyclic evidence reference')
                if index not in memo:
                    active.add(index)
                    memo[index] = expand(document['nodes'][index])
                    active.remove(index)
                return memo[index]
            return {key: expand(item) for key, item in value.items()}
        if isinstance(value, list):
            return [expand(item) for item in value]
        return value

    restored = expand(document['root'])
    payload = canonical(restored) + b'\n'
    expected = document['restoredCanonical']
    if len(payload) != expected['bytes'] or hashlib.sha256(payload).hexdigest() != expected['sha256']:
        raise ValueError('Restored canonical evidence hash or size mismatch')
    for digest, body in restored.get('content', {}).items():
        if hashlib.sha256(canonical(body)).hexdigest() != digest:
            raise ValueError(f'Evidence content hash mismatch: {digest}')
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    document = json.loads(gzip.decompress(args.archive.read_bytes()))
    payload = decode(document)
    args.output.write_bytes(payload)
    print(f'{len(payload)} bytes; SHA256 {hashlib.sha256(payload).hexdigest()}')


if __name__ == '__main__':
    main()
