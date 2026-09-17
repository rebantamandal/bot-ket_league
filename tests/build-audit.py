"""Small deterministic source/build checks, separate from gameplay tests."""
from pathlib import Path
import subprocess,hashlib,json,re,tempfile,sys
R=Path(__file__).resolve().parents[1];results=[]
def check(name,value):
 results.append({'name':name,'pass':bool(value)})
with tempfile.TemporaryDirectory() as d:
 f=Path(d)/'rebuilt.html';subprocess.run([sys.executable,str(R/'build.py'),'--output',str(f)],check=True,capture_output=True)
 check('Rebuild is byte-identical to the delivered HTML',(R/'index.html').read_bytes()==f.read_bytes())
html=(R/'index.html').read_text(encoding='utf-8');check('All source placeholders were expanded',not re.search(r'/\*__(?:APP|SIMULATION|RENDERER|MATH|ATELIERCSS|WORLDAPP)__\*/',html))
check('There are no external script, image or stylesheet dependencies',not re.search(r'<(?:script|link|img)[^>]+(?:src|href)=[\"\'](?:https?:)?//',html,re.I))
check('Four embedded scripts retain the offline worker architecture',len(re.findall(r'<script\b',html))==4)
for name in ['math.js','weather.js','field.js','physics.js','agents.js','observer.js','state.js','evaluation.js','runtime.js','renderer.js','renderer-atelier.js','app.js']:
 r=subprocess.run(['node','--check',str(R/'src'/name)],capture_output=True,text=True)
 check(name+' parses as JavaScript',r.returncode==0)
report={'htmlSha256':hashlib.sha256((R/'index.html').read_bytes()).hexdigest(),'passed':sum(x['pass'] for x in results),'failed':sum(not x['pass'] for x in results),'results':results}
(R/'reports/build-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
raise SystemExit(1 if report['failed'] else 0)
