"""Generate runtime ASCII advances/pair corrections from bundled Inter using HarfBuzz.

Requires the system HarfBuzz shared library. No Python packages are required.
The generated data is runtime-consumed; font hashes identify shipped resources.
"""
import base64
import ctypes as C
import ctypes.util
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
hb = C.CDLL(ctypes.util.find_library('harfbuzz'))


def bind(name, result, *args):
    function = getattr(hb, name)
    function.restype, function.argtypes = result, args
    return function


class Position(C.Structure):
    _fields_ = [(name, C.c_int32) for name in ['ax', 'ay', 'dx', 'dy', 'var']]


blob_create = bind('hb_blob_create_from_file_or_fail', C.c_void_p, C.c_char_p)
face_create = bind('hb_face_create', C.c_void_p, C.c_void_p, C.c_uint)
face_upem = bind('hb_face_get_upem', C.c_uint, C.c_void_p)
font_create = bind('hb_font_create', C.c_void_p, C.c_void_p)
set_funcs = bind('hb_ot_font_set_funcs', None, C.c_void_p)
set_scale = bind('hb_font_set_scale', None, C.c_void_p, C.c_int, C.c_int)
buffer_create = bind('hb_buffer_create', C.c_void_p)
buffer_destroy = bind('hb_buffer_destroy', None, C.c_void_p)
add = bind('hb_buffer_add_utf8', None, C.c_void_p, C.c_char_p, C.c_int, C.c_uint, C.c_int)
guess = bind('hb_buffer_guess_segment_properties', None, C.c_void_p)
shape = bind('hb_shape', None, C.c_void_p, C.c_void_p, C.c_void_p, C.c_uint)
positions = bind('hb_buffer_get_glyph_positions', C.POINTER(Position), C.c_void_p, C.POINTER(C.c_uint))
version = bind('hb_version_string', C.c_char_p)
faces = []
for weight, filename in [(400, 'Inter-Regular.ttf'), (500, 'Inter-Medium.ttf'), (600, 'Inter-SemiBold.ttf'), (700, 'Inter-Bold.ttf')]:
    path = root / 'assets/fonts' / filename
    blob = blob_create(str(path).encode())
    if not blob:
        raise RuntimeError('Cannot read ' + str(path))
    face = face_create(blob, 0)
    upem = face_upem(face)
    font = font_create(face)
    set_funcs(font)
    set_scale(font, upem, upem)

    def width(text):
        buffer = buffer_create()
        encoded = text.encode()
        add(buffer, encoded, len(encoded), 0, len(encoded))
        guess(buffer)
        shape(font, buffer, None, 0)
        count = C.c_uint()
        result = positions(buffer, C.byref(count))
        advance = sum(result[i].ax for i in range(count.value))
        buffer_destroy(buffer)
        return advance

    advances = [width(chr(code)) for code in range(32, 127)]
    pairs = []
    for a in range(95):
        for b in range(95):
            delta = width(chr(a + 32) + chr(b + 32)) - advances[a] - advances[b]
            if delta:
                pairs.extend([a * 95 + b, delta])
    # Sorted ASCII keys need at most two delta bytes. Repeated signed values
    # share a one-byte palette index; decoding preserves the exact HB integers.
    values = sorted(set(pairs[1::2]))
    if len(values) > 256 or any(value < -32768 or value > 32767 for value in values):
        raise RuntimeError('Inter pair adjustment palette exceeds its encoding')
    indices = {value: index for index, value in enumerate(values)}
    packed = bytearray()
    previous = 0
    for i in range(0, len(pairs), 2):
        delta = pairs[i] - previous
        previous = pairs[i]
        if not 0 <= delta < 16384:
            raise RuntimeError('Inter pair key exceeds its encoding')
        if delta >= 128:
            packed.extend([(delta & 127) | 128, delta >> 7])
        else:
            packed.append(delta)
        packed.append(indices[pairs[i + 1]])
    faces.append({'weight': weight, 'file': filename, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'upem': upem, 'advances': advances, 'count': len(pairs) // 2, 'values': values, 'pairs': base64.b64encode(packed).decode()})
    print(weight, len(packed), 'pair bytes')
output = root / 'src/inter-metrics-data.ts'
output.write_text('// Runtime-consumed bundled Inter ASCII metrics. Regenerate with scripts/build/generate-inter-metrics.py.\n'
    '// Advances plus pair corrections approximate default shaping; full contextual shaping is outside this profile.\n'
    + '// Generator HarfBuzz ' + version().decode() + '\n'
    + 'export const INTER_METRICS_DATA = ' + json.dumps(faces, separators=(',', ':')) + ' as const\n')
