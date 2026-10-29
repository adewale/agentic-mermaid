from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
p=Path(__file__).parent
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
canvas=Image.new('RGB',(1220,660),'#f5f5f5');d=ImageDraw.Draw(canvas)
for col,phase in enumerate(['before','after']):
 x=10+col*610
 d.text((x+10,12),f'{phase.title()}: '+('main cff46b76' if phase=='before' else 'PR + main 934e708a'),fill='#111111',font=font)
 for name,y,crop in [('independent-loops',65,(0,0,600,260)),('shared-route-label',370,(470,60,1230,320))]:
  im=Image.open(p/f'{name}-{phase}.png').convert('RGBA')
  bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im)
  im=bg.convert('RGB');frame=Image.new('RGB',(max(im.width,crop[2]),max(im.height,crop[3])),'white');frame.paste(im,(0,0));im=frame.crop(crop)
  if name=='shared-route-label':im.resize((570,195),Image.Resampling.LANCZOS).save(p/f'{name}-{phase}-crop.png');im=im.resize((570,195),Image.Resampling.LANCZOS)
  canvas.paste(im,(x,y))
 d.text((x+10,335),'Independent loops: shared segment → separate channels',fill='#333333',font=small)
 d.text((x+10,580),'q: shared shaft → private label-bearing channel',fill='#333333',font=small)
d.text((20,625),'Same inputs and options; matched crop coordinates and scale within each pair. Full SVGs and receipts linked in PR.',fill='#333333',font=small)
canvas.save(p/'preview.png')
