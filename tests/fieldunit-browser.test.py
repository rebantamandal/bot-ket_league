"""Atelier UI/accessibility/state regression tests (adapted from 09). Document injection is required by the
managed test browser; non-opaque-origin autosave/reload is not covered.
Worker-failure coverage below is deliberate fault injection, not a real crash.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os
import re
import json, time, hashlib, traceback
R=Path(__file__).resolve().parents[1]
results=[];errors=[];requests=[];started=time.time();pg=None

def check(name, ok, detail=None):
 results.append({'name':name,'pass':bool(ok),**({'detail':detail} if detail is not None else {})});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def save():
 (R/'reports/fieldunit-browser-tests.json').write_text(json.dumps({'date':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'htmlSha256':hashlib.sha256((R/'index.html').read_bytes()).hexdigest(),'passed':sum(r['pass'] for r in results),'failed':sum(not r['pass'] for r in results),'results':results,'errors':errors,'seconds':time.time()-started,'limitations':['Chromium document injection; real-origin IndexedDB reload unverified.','Worker fault is deliberately injected to exercise recovery.']},indent=2))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 pg=b.new_page(viewport={'width':1440,'height':900},accept_downloads=True);pg.set_default_timeout(12000)
 pg.on('pageerror',lambda e: errors.append(str(e)));pg.on('request',lambda r: requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
 def ev(code,arg=None):return pg.evaluate(code,arg)
 def req(kind,**args):return ev('(m)=>app.request(m.kind,m.args)',{'kind':kind,'args':args})
 try:
  pg.set_content((R/'index.html').read_text(),wait_until='domcontentloaded');pg.wait_for_function('window.touchlineReady===true');pg.wait_for_timeout(2300)
  check('11 identity is built into the actual cartridge',pg.title()=='Bo-ket League' and pg.inner_text('.edition')=='11')
  check('All assets are bundled with no font or external requests',not requests)
  check('Default stage does not expose settings or technical cards',not pg.is_visible('#inspector') and not pg.is_visible('#tacticalCard'))
  check('Overview score uses flat typography without a hardware backing',ev('getComputedStyle(document.querySelector(".scoreboard")).backgroundColor==="rgba(0, 0, 0, 0)" && getComputedStyle(document.querySelector(".scoreboard")).boxShadow==="none"'))
  check('Camera keys expose their real pressed state',pg.get_attribute('[data-view="arena"]','aria-pressed')=='true')
  pg.click('[data-view="mica"]');pg.wait_for_timeout(300)
  check('Pressing a camera key updates the camera and key state',ev('app.renderer.mode==="mica"') and pg.get_attribute('[data-view="mica"]','aria-pressed')=='true')
  pg.click('#play');pg.wait_for_timeout(300)
  check('Play button mirrors paused simulation state',ev('app.paused') and pg.get_attribute('#play','aria-pressed')=='false')
  paused=req('export')['universe'];pg.wait_for_timeout(500)
  check('Paused display does not secretly keep training',req('export')['universe']==paused)
  # Deliberately inject slow-render diagnostics; keep the worker actually paused.
  # This tests the adaptive policy and state separation, not measured frame rate.
  adaptive=ev('''()=>{const r=app.renderer,old=r.w;r.orbit(.3,0);const yaw=r.orbitYaw,cam=r.camYaw;app.fps=30;app.graphicsSince=performance.now()-10000;app.canvasPressure=3;app.paused=false;app.adaptGraphics(performance.now(),.1);app.paused=true;return {before:old,after:r.w,orbit:r.orbitYaw===yaw,cam:r.camYaw===cam};}''')
  check('Adaptive Canvas scaling reduces pixels without moving the chosen camera',adaptive['after']<adaptive['before'] and adaptive['orbit'] and adaptive['cam'],adaptive)
  check('Adaptive rendering never changes a paused physical world or learned policy',req('export')['universe']==paused)
  stable=ev('''()=>{const r=app.renderer;r.quality='fine';r.resize();const width=r.w;app.fps=20;app.canvasPressure=4;app.scaledAt=performance.now()-10000;app.paused=false;app.adaptGraphics(performance.now(),.2);app.paused=true;const stable=r.w===width;r.quality='auto';r.resolutionScale=1;r.resize();app.canvasPressure=0;app.scaledAt=performance.now();return stable;}''')
  check('Explicit high-detail mode is not silently downscaled',stable)
  pg.click('#inspectButton');pg.wait_for_timeout(250)
  check('Opening Fieldnotes focuses its close button',ev('document.activeElement.id==="closeInspector"'))
  check('Wide-screen Fieldnotes does not disable the live controls',ev('!game.inert&&inspector.getAttribute("aria-modal")==="false"'))
  check('Tactical display comes from real candidate measurements',ev('app.telemetry.agents[0].plan.role') is not None and re.search(r'\d+/100',pg.inner_text('#tacticalNote')) is not None)
  check('Arrival indicator is numeric or explicitly unavailable',ev('/^(\\d+\\.\\d{2} s|--)$/.test(arrivalEstimate.textContent)'))
  check('Compared plans show finite authored and bounded learned scores',ev('app.detail.agents.every(a=>a.alternatives.every(p=>Number.isFinite(p.score)&&Math.abs(p.correction)<=.721))'))
  pg.click('#closeInspector');check('Closing the inspector restores the opening button focus',ev('document.activeElement.id==="inspectButton"'))
  pg.keyboard.press('i');pg.wait_for_timeout(200);check('Fieldnotes keyboard shortcut opens the inspector',ev('app.drawer'))
  pg.focus('#tab-now');pg.keyboard.press('ArrowRight');check('Arrow keys navigate proper inspector tabs',ev('app.tab==="discoveries"&&document.activeElement.id==="tab-discoveries"'))
  pg.keyboard.press('End');check('End key selects the last inspector tab',ev('app.tab==="lab"'))
  pg.keyboard.press('Escape');pg.wait_for_timeout(200);check('Escape exits the inspector',ev('!app.drawer'))
  pg.set_viewport_size({'width':1024,'height':768});pg.wait_for_timeout(200);pg.click('#inspectButton');pg.wait_for_timeout(250)
  check('Tablet inspector is a labelled modal, not a covered interactive page',ev('game.inert&&inspector.getAttribute("role")==="dialog"&&inspector.getAttribute("aria-modal")==="true"&&!!inspector.getAttribute("aria-labelledby")'))
  check('Tablet modal has a real dismissible scrim',pg.is_visible('#drawerScrim'))
  pg.focus('#closeInspector');pg.keyboard.press('Shift+Tab')
  check('Reverse Tab wraps within modal controls',ev('inspector.contains(document.activeElement)&&document.activeElement.id!=="closeInspector"'))
  pg.keyboard.press('Tab');check('Forward Tab wraps back to modal start',ev('document.activeElement.id==="closeInspector"'))
  pg.mouse.click(70,300);pg.wait_for_timeout(150);check('Outside tap closes modal and restores page interaction',ev('!app.drawer&&!game.inert'))
  for width,height in [(320,700),(390,844),(768,1024),(844,390),(1024,768),(1440,900)]:
   pg.set_viewport_size({'width':width,'height':height});pg.wait_for_timeout(250)
   check(f'{width} x {height}: no page overflow, score and play available',ev('document.documentElement.scrollWidth<=innerWidth') and pg.is_visible('.scoreboard') and pg.is_visible('#play'))
  pg.emulate_media(reduced_motion='reduce');check('Reduced-motion preference removes decorative animation',ev('getComputedStyle(document.querySelector(".boot-mark")).animationName==="none"'))
  pg.emulate_media(reduced_motion='no-preference')
  pg.click('#focus');check('Focus mode hides interface, score and weather together',not pg.is_visible('#top') and not pg.is_visible('.scoreboard') and not pg.is_visible('#weatherBadge') and pg.is_visible('#restoreHUD'));pg.click('#restoreHUD')
  before=req('export')['universe'];ev('app.setTheme("night")');pg.wait_for_timeout(250)
  check('Night palette switch does not change the physical world',before==req('export')['universe'])
  check('Night overview retains the flat scoreboard treatment',ev('getComputedStyle(document.querySelector(".scoreboard")).backgroundImage==="none" && getComputedStyle(document.querySelector(".scoreboard")).boxShadow==="none"'))
  ev('app.setTheme("auto")');req('testAdvance',testing=True,steps=8000);pg.wait_for_timeout(300)
  ev('app.setTab("discoveries");app.openInspector(true)');pg.wait_for_timeout(300)
  check('Observer titles describe recorded motion sequences',ev('app.detail.patterns.some(p=>p.sequence?.length>1)'))
  pg.locator('.entry button:not([disabled])').first.click();pg.wait_for_function('!!app.replay')
  ev('app.setTab("now");app.openInspector(true)');pg.wait_for_timeout(400)
  check('Replay inspector explicitly separates recorded motion from live decisions',pg.inner_text('#intent')=='Recorded motion.' and 'not saved' in pg.inner_text('#reason'))
  check('Live tactic meters are hidden while replaying history',not pg.is_visible('#tacticalCard') and not pg.is_visible('#planReadout'))
  ev('app.openInspector(false)');pg.click('#ribbonExit');ev('app.setTab("now");app.openInspector(true)');pg.wait_for_timeout(400)
  check('Returning live restores the true current tactic display',pg.is_visible('#tacticalCard') and pg.inner_text('#intent')!='Recorded motion.')
  ev('app.openInspector(false)');req('pause',value=True)
  old=json.loads((R/'tests/fixtures/world-08.json').read_text());req('import',data=old);pg.wait_for_timeout(300)
  check('Actual 08 world import is supported in the worker',req('export')['universe']['brains'][0]['w']==old['universe']['brains'][0]['w']+[0]*12)
  check('Older-planner migration warning is visible to the user','future decisions can differ' in pg.inner_text('#toast'))
  good=req('export');bad=json.loads(json.dumps(good));bad['universe']['weather']['step']='broken'
  response=ev('async data=>{try{await app.request("import",{data});return "accepted";}catch(e){return e.message;}}',bad)
  check('Bad save fails with an actionable error',response=='Unsupported weather state.',response)
  check('Rejected save leaves both policies and world untouched',req('export')['universe']==good['universe'])
  ev('app.setTab("lab");app.openInspector(true)');pg.locator('details').filter(has=pg.locator('summary',has_text='Save & resume')).locator('summary').click()
  with pg.expect_download() as item:pg.click('#export')
  download=item.value;data=json.loads(Path(download.path()).read_text())
  check('Portable file download contains a complete 11 world',data['plannerVersion']==11 and data['universe']['plannerVersion']==11 and len(data['universe']['brains'])==2)
  # A real exported save is used as the backup, not a fabricated miniature payload.
  ev('async data=>{await app.persist(JSON.stringify(data));}',data)
  ev('app.openInspector(false);app.worker.dispatchEvent(new ErrorEvent("error",{message:"Deliberate test failure"}));');pg.wait_for_timeout(300)
  check('Injected worker failure stops simulation and shows recovery controls',pg.is_visible('#boot') and pg.is_visible('#recoverSave') and ev('app.worker===null&&app.paused'))
  check('Failure message does not claim unsaved progress was recovered','last available backup' in pg.inner_text('#bootText'))
  with pg.expect_download() as item:pg.click('#recoverSave')
  recovered=json.loads(Path(item.value.path()).read_text());check('Recovery exports the actual last available backup unchanged',recovered==data)
  check('No unhandled JavaScript exception during UI, import, replay or fault recovery',not errors,errors)
 except Exception as e:
  check('The complete Atelier workflow finishes',False,str(e));errors.append(traceback.format_exc())
  pg.screenshot(path=str(R/'previews/fieldunit-test-failure.png'))
 finally: save();b.close()
print('RESULT',sum(r['pass'] for r in results),'passed;',sum(not r['pass'] for r in results),'failed',flush=True)
raise SystemExit(1 if any(not r['pass'] for r in results) or errors else 0)
