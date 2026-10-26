#!/usr/bin/env python3
"""Plot recorded fidelity comparisons; never invoke engines or acquire artifacts."""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evidence import read_document
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--report', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
data = read_document(args.report)
args.out.mkdir(parents=True, exist_ok=True)
rows = data['rows']
colors = {'passed': '#178050', 'failed': '#bd3748', 'unavailable': '#b4bac2'}
plt.rcParams.update({'font.size': 9, 'svg.fonttype': 'none'})

def save(fig, name):
    fig.savefig(args.out / (name + '.svg'), bbox_inches='tight')
    fig.savefig(args.out / (name + '.png'), bbox_inches='tight', dpi=130)
    plt.close(fig)

# Same declared reference-qualified denominator in each column for every tool.
fig, axes = plt.subplots(1, 3, figsize=(16, max(5, len(rows)*.30)), sharey=True)
y = np.arange(len(rows))
for index, ax in enumerate(axes):
    left = np.zeros(len(rows))
    for status in ['passed', 'failed', 'unavailable']:
        widths = np.array([100*row['cells'][index][status]/row['cells'][index]['denominator'] if row['cells'][index]['denominator'] else 0 for row in rows])
        ax.barh(y, widths, left=left, color=colors[status], label=status)
        left += widths
    ax.set_xlim(0, 100)
    ax.set_title(rows[0]['cells'][index]['surface'] + '\nqualified denominator: ' + str(rows[0]['cells'][index]['denominator']))
    ax.set_xlabel('Percentage of baseline-qualified criteria')
    ax.grid(axis='x', alpha=.2)
axes[0].set_yticks(y, [row['project'] + (' [alias]' if row['aliasOf'] else '') for row in rows])
axes[0].invert_yaxis()
axes[-1].legend(loc='lower right')
fig.suptitle('Separate Mermaid fidelity dimensions — sorted by paint passes, not an overall score\nGrey is unavailable/unsupported evidence; model APIs are not inferred from SVG', y=1.005)
fig.tight_layout()
save(fig, 'fidelity-dimensions')

families = [cell['family'] + ('' if cell['required'] else ' (supplement)') for cell in rows[0]['families']]
values = np.array([[cell['passed']/cell['total'] if cell['total'] else np.nan for cell in row['families']] for row in rows])
fig, ax = plt.subplots(figsize=(max(13, len(families)*.55), max(5, len(rows)*.30)))
image = ax.imshow(values, vmin=0, vmax=1, aspect='auto', cmap=LinearSegmentedColormap.from_list('coverage', ['#f0f0f0','#acd4bc','#167342']))
ax.set_xticks(np.arange(len(families)), families, rotation=60, ha='right')
ax.set_yticks(y, [row['project'] + (' [alias]' if row['aliasOf'] else '') for row in rows])
for i, row in enumerate(rows):
    for j, cell in enumerate(row['families']):
        ax.text(j, i, str(cell['passed'])+'/'+str(cell['total']), ha='center', va='center', fontsize=6, color='white' if values[i,j]>.8 else '#17202a')
fig.colorbar(image, ax=ax, label='Paint criteria passed / baseline-qualified criteria', shrink=.5)
ax.set_title('Actual owned paint by family\nCounts retain missing peer evidence; raw reference failures remain in the separate review ledger')
fig.tight_layout()
save(fig, 'paint-by-family')

# Show how much the baseline itself can and cannot qualify.
raw = data['comparison']['rawPopulation']
qualified = data['comparison']['calibratedPopulation']
fig, ax = plt.subplots(figsize=(9, 2.5))
ax.barh([0], [qualified], color=colors['passed'], label='Reference-qualified')
ax.barh([0], [raw-qualified], left=[qualified], color='#d49a44', label='Reference requires review / unavailable')
ax.text(qualified/2, 0, str(qualified), ha='center', va='center', color='white')
ax.text(qualified+(raw-qualified)/2, 0, str(raw-qualified), ha='center', va='center')
ax.set_xlim(0, raw)
ax.set_yticks([])
ax.set_xlabel('Authored criterion count')
ax.set_title('Pinned Mermaid is measured, not assumed perfect: '+str(raw)+' declared criteria')
ax.legend(loc='lower center', bbox_to_anchor=(.5, -1), ncol=2)
fig.tight_layout()
save(fig, 'reference-qualification')
