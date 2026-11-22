from pathlib import Path
import re
p=Path(__file__).parent/'REPORT.md';s=p.read_text().replace('file count stays270','file count changes269→270').replace(' No fresh approval question is introduced for already accepted costs.','')
parts=re.split(r'(`[^`]*`|https?://[^\s)>]+)',s)
for i in range(0,len(parts),2):
 parts[i]=re.sub(r'(?<=[A-Za-z])(?=\d)',' ',parts[i]);parts[i]=re.sub(r'(?<=\d)(?=[A-Za-z])',' ',parts[i]);parts[i]=parts[i].replace('PR 621','PR #621').replace('issue619','issue #619').replace('issue 619','issue #619')
s=''.join(parts);p.write_text(s)
