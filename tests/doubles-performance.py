"""Ordinary 2v2 playback on the test host, with no concurrent study/training jobs.
This measures actual presented frames and worker simulation pace, not a GPU promise.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os
import json,time,hashlib
R=Path(__file__).resolve().parents[1]
report={'date':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'htmlSha256':hashlib.sha256((R/'index.html').read_bytes()).hexdigest(),'viewport':[1440,900],'deviceScaleFactor':1,'secondsPerSample':7,'mode':'doubles','samples':[],'errors':[],'method':'Headless Chromium, actual Canvas renderer and independent 120 Hz worker. Two seconds settle, seven seconds ordinary live playback per sample. No simultaneous benchmark or comparison job.','limitation':'These samples are not benchmarks of the user device or a native gaming GPU.'}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);page=b.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:report['errors'].append(str(e)))
 page.set_content((R/'index.html').read_text(),wait_until='domcontentloaded');page.wait_for_function('app?.ready');page.evaluate('app.changeMatch("doubles")');page.wait_for_function('app.b.cars.length===4')
 for name,weather,hour,view in [('daylight_overview','clear',12,'arena'),('rainy_night_overview','rain',22,'arena'),('rainy_night_follow_Slate','rain',22,'slate')]:
  page.evaluate('async o=>{await app.request("pause",{value:true});await app.request("weather",{value:{mode:o.weather,hour:o.hour}});await app.request("testAdvance",{testing:true,steps:8400});app.view(o.view);await app.request("pause",{value:false});}',{'weather':weather,'hour':hour,'view':view});page.wait_for_timeout(2000)
  code='({t:performance.now(),frames:app.debug.frames,simulation:app.b.time,updates:app.telemetry.updates,renderer:app.renderer.kind,drawMs:app.renderer.renderMs,tickMs:app.telemetry.tickMs,canvas:[app.renderer.w,app.renderer.h]})'
  a=page.evaluate(code);page.wait_for_timeout(7000);z=page.evaluate(code);seconds=(z['t']-a['t'])/1000
  sample={'scenario':name,'wallSeconds':seconds,'fps':(z['frames']-a['frames'])/seconds,'simulationPace':(z['simulation']-a['simulation'])/seconds,'learningUpdates':[end-start for end,start in zip(z['updates'],a['updates'])],**{k:z[k] for k in ['renderer','drawMs','tickMs','canvas']}}
  report['samples'].append(sample);print(json.dumps(sample),flush=True);(R/'reports/doubles-performance.json').write_text(json.dumps(report,indent=2))
 b.close()
