from pathlib import Path
import urllib.request,tarfile,json,hashlib,os
p=Path('/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107');nodes=json.load(open(p/'SELECTED-CATALOG.json'))['nodes'];wanted=['lukilabs/beautiful-mermaid','wevm/ondine','1jehuang/mermaid-rs-renderer','Latias94/merman','Dicklesworthstone/frankenmermaid','crabtalk/bezel','dfadler/zombie-mermaid'];requests=[{'id':n['id'],'revision':n['head']}for n in nodes if n['id']in wanted];requests += [{'id':'mermaid-js/mermaid','revision':'1fb7869866dd619168d840291c9c54b4f129758b'},{'id':'eclipse-elk/elk','revision':'v0.11.0'}];outcomes=[];p.joinpath('sources').mkdir(exist_ok=True)
for row in requests:
 name=row['id'].replace('/','--');archive=p/'sources'/f'{name}-{row["revision"][:12]}.tar.gz';dest=p/'sources'/name;url=f'https://codeload.github.com/{row["id"]}/tar.gz/{row["revision"]}';row.update(url=url,archive=str(archive),directory=str(dest))
 try:
  if not archive.exists():
   with urllib.request.urlopen(url,timeout=45)as response,open(str(archive)+'.partial','wb')as f:
    size=0
    while chunk:=response.read(65536):
     size+=len(chunk)
     if size>32*1024*1024:raise RuntimeError('bounded archive exceeds32MiB; retain partial')
     f.write(chunk)
   os.rename(str(archive)+'.partial',archive)
  row['archiveBytes']=archive.stat().st_size;row['sha256']=hashlib.sha256(archive.read_bytes()).hexdigest();dest.mkdir(exist_ok=True);count=0;total=0
  with tarfile.open(archive)as t:
   for m in t.getmembers():
    if not m.isfile():continue
    parts=Path(m.name).parts[1:]
    if not parts or '..'in parts or any(q in['node_modules','target','.git','dist','pkg','website']for q in parts):continue
    suffix=Path(parts[-1]).suffix.lower()
    if suffix not in['.ts','.tsx','.rs','.go','.java','.json','.toml','.md','.js','.mjs','.yml','.yaml','.txt','.elkt','.elk','.snap','.peg','.ne','.jison','.pest']and parts[-1]not in['LICENSE','Cargo.lock','bun.lock']:continue
    if m.size>2*1024*1024:continue
    total+=m.size
    if total>48*1024*1024:raise RuntimeError('bounded extracted source exceeds48MiB')
    target=dest.joinpath(*parts);target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():target.write_bytes(t.extractfile(m).read())
    count+=1
  row.update(status='source-recovered',extractedFiles=count,extractedBytes=total)
 except Exception as e:row.update(status='source-unavailable',failure=str(e))
 outcomes.append(row);(p/'SOURCE-ACQUISITION.json').write_text(json.dumps(outcomes,indent=2)+'\n');print(row['id'],row['status'],row.get('extractedFiles'),row.get('archiveBytes'),row.get('failure',''),flush=True)
