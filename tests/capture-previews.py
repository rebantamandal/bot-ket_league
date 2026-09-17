"""Capture actual four-player simulation states; no composited scene or staged scores."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os
import json,math,hashlib
R=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);pg=b.new_page(viewport={'width':1440,'height':900});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.set_content((R/'index.html').read_text(),wait_until='domcontentloaded');pg.wait_for_function('app?.ready')
 def req(kind,**args):return pg.evaluate('(m)=>app.request(m.kind,m.args)',{'kind':kind,'args':args})
 req('pause',value=True);pg.evaluate('app.changeMatch("doubles")');pg.wait_for_function('app.b.cars.length===4');req('weather',value={'mode':'clear','hour':13});req('testAdvance',testing=True,steps=1500)
 for i in range(35):
  s=pg.evaluate('app.b');c=s['cars'];ball=s['ball'];sep=min(math.hypot(a['x']-d['x'],a['z']-d['z']) for a in c for d in c if a['id']!=d['id'])
  if max(a['y'] for a in c)<3 and abs(ball['x'])<37 and abs(ball['z'])<24 and sep>8:break
  req('testAdvance',testing=True,steps=120)
 pg.wait_for_timeout(6200);pg.screenshot(path=str(R/'previews/release-desktop.png'))
 pg.evaluate('app.selectAgent(2);app.setTab("now");app.openInspector(true)');pg.wait_for_timeout(650);pg.screenshot(path=str(R/'previews/release-inspector.png'))
 pg.evaluate('app.openInspector(false);app.view("slate")');pg.wait_for_timeout(1000);pg.screenshot(path=str(R/'previews/release-follow.png'))
 pg.evaluate('app.view("arena")');req('weather',value={'mode':'rain','hour':22});req('testAdvance',testing=True,steps=8400);pg.wait_for_timeout(6300);pg.screenshot(path=str(R/'previews/release-night.png'))
 req('weather',value={'mode':'clear','hour':12});pg.wait_for_timeout(500);pg.set_viewport_size({'width':390,'height':844});pg.wait_for_timeout(900);pg.screenshot(path=str(R/'previews/release-mobile.png'))
 (R/'reports/preview-capture.json').write_text(json.dumps({'renderer':pg.evaluate('app.renderer.kind'),'htmlSha256':hashlib.sha256((R/'index.html').read_bytes()).hexdigest(),'errors':errors,'method':'Actual paused four-car simulation states and real UI. No compositing.'},indent=2));b.close()
