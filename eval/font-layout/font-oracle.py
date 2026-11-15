"""Independent HarfBuzz advance comparison over the fixed campaign labels."""
import json
from pathlib import Path
import subprocess
import sys

root, corpus, output = map(lambda value: Path(value).resolve(), sys.argv[1:4])
bundled = '--bundled' in sys.argv[4:]
label_path = corpus.parent / 'font-labels.json'
if label_path.exists():
    labels = json.loads(label_path.read_text())
else:
    import re
    labels = ['Authentication', 'API Gateway', 'Minimum width', '11111111', '88888888', 'AVATAR', 'office', 'Retry failed request']
    for item in json.loads(corpus.read_text()):
        for text in re.findall(r'\[([^\[\]\n]+)\]', item['source']):
            text = text.strip('"`')
            if text and len(text) < 140 and all(32 <= ord(char) <= 126 for char in text) and '<' not in text:
                labels.append(text)
    labels = list(dict.fromkeys(labels))
    label_path.write_text(json.dumps(labels, indent=2) + '\n')
worker = Path(__file__).with_name('text-widths.ts')
rows = json.loads(subprocess.run(['bun', str(worker)], input=json.dumps({'root': str(root), 'bundled': bundled, 'labels': labels}), text=True, capture_output=True, check=True).stdout)
files = {400: 'Inter-Regular.ttf', 500: 'Inter-Medium.ttf', 600: 'Inter-SemiBold.ttf', 700: 'Inter-Bold.ttf'}
for row in rows:
    glyphs = json.loads(subprocess.run(['hb-shape', str(root / 'assets/fonts' / files[row['weight']]), row['text'], '--font-size=65536', '--output-format=json'], text=True, capture_output=True, check=True).stdout)
    actual = sum(glyph['ax'] for glyph in glyphs) / 4096
    row.update(naturalPx=actual, errorPx=row['measuredPx'] - actual, absoluteErrorPx=abs(row['measuredPx'] - actual), errorPercent=(row['measuredPx'] / actual - 1) * 100 if actual else None)
output.write_text(json.dumps({'method': '16px, HarfBuzz default shaping, pinned faces; estimator includes its own padding, natural advances do not; exposed development labels', 'bundled': bundled, 'labels': len(labels), 'rows': rows}, indent=2) + '\n')
print(len(rows), 'measurements', output)
