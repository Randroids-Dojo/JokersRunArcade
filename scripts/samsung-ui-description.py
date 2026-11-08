from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile, ZIP_DEFLATED
import io, re, xml.etree.ElementTree as E

import argparse
parser=argparse.ArgumentParser(description="Fill Samsung's v1.42 UI Description template from real TV-build QA captures.")
parser.add_argument('template',type=Path)
parser.add_argument('--output',type=Path)
args=parser.parse_args()
BASE=Path(__file__).resolve().parents[1]
SOURCE=args.template.resolve()
OUT=args.output or BASE/'release-artifacts/samsung/JokersRun-UI-Description-1.0.0.pptx'
OUT.parent.mkdir(parents=True,exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'
P='http://schemas.openxmlformats.org/presentationml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
NS={'a':A,'p':P,'r':R}
for prefix,uri in [('a',A),('p',P),('r',R)]:E.register_namespace(prefix,uri)
z=ZipFile(SOURCE); files={n:z.read(n) for n in z.namelist()}
def xml(name):return E.fromstring(files[name])
def save(name,root):
 uri=root.tag.split('}')[0][1:] if root.tag.startswith('{') else ''
 if uri in [REL,'http://schemas.openxmlformats.org/package/2006/content-types']:E.register_namespace('',uri)
 files[name]=E.tostring(root,encoding='utf-8',xml_declaration=True)
def shape(root,id):
 return next(s for s in root.findall('.//p:sp',NS) if s.find('p:nvSpPr/p:cNvPr',NS).get('id')==str(id))
def text_body(target,lines,size=None,bullet=False,color='000000'):
 body=target.find('p:txBody',NS)
 if body is None:body=target
 first=body.find('a:p',NS)
 proto=deepcopy(first) if first is not None else E.Element('{'+A+'}p')
 for p in list(body.findall('a:p',NS)):body.remove(p)
 for line in lines:
  p=deepcopy(proto)
  old=p.find('a:r/a:rPr',NS)
  props=deepcopy(old) if old is not None else E.Element('{'+A+'}rPr')
  props.attrib.pop('i',None)
  props.attrib.pop('b',None)
  if size:props.set('sz',str(size))
  for child in list(props):
   if child.tag in ['{'+A+'}solidFill','{'+A+'}highlight']:props.remove(child)
  fill=E.SubElement(props,'{'+A+'}solidFill');E.SubElement(fill,'{'+A+'}srgbClr',val=color)
  for child in list(p):
   if child.tag!='{'+A+'}pPr':p.remove(child)
  pp=p.find('a:pPr',NS)
  if pp is None:pp=E.SubElement(p,'{'+A+'}pPr')
  for child in list(pp):
   if child.tag.rsplit('}',1)[-1].startswith('bu'):pp.remove(child)
  if bullet:
   pp.set('marL','220000');pp.set('indent','-160000');pp.set('lvl','0')
   E.SubElement(pp,'{'+A+'}buChar',char='•')
  else:
   pp.set('marL','0');pp.set('indent','0');pp.set('lvl','0');E.SubElement(pp,'{'+A+'}buNone')
  bef=pp.find('a:spcBef',NS)
  if bef is None:bef=E.SubElement(pp,'{'+A+'}spcBef')
  for e in list(bef):bef.remove(e)
  E.SubElement(bef,'{'+A+'}spcPts',val='600')
  run=E.SubElement(p,'{'+A+'}r');run.append(props);E.SubElement(run,'{'+A+'}t').text=line
  E.SubElement(p,'{'+A+'}endParaRPr',sz=str(size or 1600))
  body.append(p)
def title(root,id,value):
 s=shape(root,id);texts=s.findall('.//a:t',NS);texts[0].text=value
 for t in texts[1:]:t.text=''
def geom(s,x,y,w,h):
 xf=s.find('p:spPr/a:xfrm',NS)
 off=xf.find('a:off',NS);ext=xf.find('a:ext',NS)
 off.set('x',str(round(x*914400)));off.set('y',str(round(y*914400)))
 ext.set('cx',str(round(w*914400)));ext.set('cy',str(round(h*914400)))
def table_cells(root):return [tr.findall('a:tc',NS) for tr in root.findall('.//a:tbl/a:tr',NS)]
# Cover, revision, contents and required narrative sections retain the template layouts.
r=xml('ppt/slides/slide2.xml');title(r,116,"Joker's Run Description");title(r,117,'Randroid LLC | Samsung Smart TV | Version 1.0.0');save('ppt/slides/slide2.xml',r)
r=xml('ppt/slides/slide3.xml');rows=table_cells(r)
for cell,value in zip(rows[1],['1.0','2026.11.07','Initial Samsung TV edition. Complete Mission 01; Smart Remote and gamepad controls.','Randroid LLC']):text_body(cell.find('a:txBody',NS),[value],1200)
save('ppt/slides/slide3.xml',r)
r=xml('ppt/slides/slide5.xml');text_body(shape(r,135),[
'Title → Launch → Mission 01 (launch, training, scouts, chase, ace, final intercept).',
'Mission → Return → Paused → Resume / Restart checkpoint / Restart mission / Title.',
'Mission → Failed → Retry checkpoint / Restart mission. Mission → Debrief → Fly again / Title.',
'Title or Paused → Privacy Policy → Close / Return → previous menu and focus.',
'Title → Return or Exit to Smart Hub → exit confirmation → Keep playing / Exit to Smart Hub.',
'Home, background or controller disconnect → suspended mission → Paused on return.',
'Exit key (10182 / long Return on supported remotes) → terminate through the Tizen API.'
],1800,True);save('ppt/slides/slide5.xml',r)
r=xml('ppt/slides/slide8.xml');text_body(shape(r,181),[
'1. Select Launch using arrows + OK (gamepad A). Fly through the maneuver rings and destroy the training drones. The jamming drone requires guns.',
'2. Destroy scouts before their upload clocks expire. Fight escorts, follow the canyon chase, defeat the ace and intercept the final scout.',
'3. Arrows steer with assistance. Hold OK for guns and missiles when locked. Double left/right evades. Return opens pause and flight commands.',
'4. In Paused, select a throttle, target, missile, evade or wingman command. Commands unavailable in the phase are disabled. Resume continues.',
'5. Failure offers checkpoint retry or mission restart. Debrief records rank, statistics and local best score. Breakout is a teaser, not a playable mission.',
'6. Toggle sound, pitch or reduced shake from the menus. Open Privacy to read the offline policy. Return on Title offers exit confirmation.',
'No app login, activation, account, in-app payment, voucher, geo-block, server content or trivia. Mission 01 works offline.'
],1700,False);save('ppt/slides/slide8.xml',r)
# Each real UI screenshot gets a copy of Samsung's menu/function section layout.
menus=[
('Title',BASE/'release-artifacts/samsung/title.png',[
'Launch starts Mission 01.','Invert pitch, radio, music and reduced shake toggle with OK / A.','Best score and settings are saved locally.','Privacy Policy opens the offline policy. Exit to Smart Hub opens confirmation.','Control help explains remote and optional gamepad inputs.']),
('Mission HUD',BASE/'release/samsung/assets/02-scout-intercept.jpg',[
'Top: score, combo, objective and scout upload clock.','Center: target, lock circle, lead pipper and captions.','Sides: speed / boost, altitude, hull and incoming missile warnings.','Bottom: radar, missile rails and remote control reminder.','Keep a target inside the lock circle before firing a missile.']),
('Paused and flight commands',BASE/'release-artifacts/samsung/pause.png',[
'Resume, Restart checkpoint, Restart mission and Quit to title.','Boost / brake toggles resume flight; choosing one cancels the other.','Next target, locked missile, barrel roll and wingman order commands.','Invert pitch, radio, music, shake and all sound toggles.','Privacy Policy opens the offline policy. Return resumes.']),
('Failed',BASE/'release-artifacts/samsung/failed.png',[
'Failure reason appears above the recovery actions.','Retry from checkpoint restores the current phase and checkpoint score.','Restart mission begins Mission 01 again.','Focus moves to Retry after the reveal completes.','Arrows move focus; OK / A selects.']),
('Debrief',BASE/'release-artifacts/samsung/mission-debrief.png',[
'Mission rank, score, shots, missiles and other flight statistics.','Local best score is recorded on the TV.','Fly again replays Mission 01; Title returns to the title screen.','Breakout is a next-mission teaser and does not launch a second mission.']),
('Privacy Policy',BASE/'release-artifacts/samsung/privacy.png',[
'All policy text is bundled locally; no network page is loaded.','Up / Down scrolls the policy.','Close or Return restores the previous menu and focus.','The app has no accounts, analytics, advertisements or data transmission.']),
('Exit confirmation',BASE/'release-artifacts/samsung/exit-confirmation.png',[
'Return on Title or Exit to Smart Hub opens this dialog.','Keep playing cancels and restores the menu.','Exit to Smart Hub terminates through the Tizen application API.','Return cancels the dialog.','The dedicated Exit key exits immediately, as required by the platform.'])]
menu_ids=[]
base_slide=xml('ppt/slides/slide10.xml')
base_rels=xml('ppt/slides/_rels/slide10.xml.rels')
ct=xml('[Content_Types].xml')
ctns='http://schemas.openxmlformats.org/package/2006/content-types'
for ext,mime in [('png','image/png'),('jpg','image/jpeg')]:
 if not any(e.get('Extension')==ext for e in ct):E.SubElement(ct,'{'+ctns+'}Default',Extension=ext,ContentType=mime)
for n,(heading,image,lines) in enumerate(menus):
 num=10 if n==0 else 12+n
 menu_ids.append(num)
 r=deepcopy(base_slide)
 title(r,193,'Menu & function description')
 subtitle=shape(r,194)
 text_body(subtitle,[heading]+lines,1500,False)
 geom(subtitle,6.25,2.12,3.1,4.8)
 pic=r.find('.//p:pic',NS)
 # Keep the actual screenshot pixels and 16:9 aspect ratio.
 geom(pic,0.51,2.62,5.55,3.121875)
 label=pic.find('p:nvPicPr/p:cNvPr',NS);label.set('name',heading+' - actual TV build screenshot')
 label.set('descr','Desktop-browser capture of the packaged TV build; not a physical TV photograph.')
 rels=deepcopy(base_rels)
 for rel in list(rels):
  if rel.get('Type','').endswith('/notesSlide'):rels.remove(rel)
 ext=image.suffix[1:];media=f'image{701+n}.{ext}'
 image_rel=next(rel for rel in rels if rel.get('Id')=='rId3')
 image_rel.set('Target','../media/'+media)
 image_rel.set('Id','rId'+str(701+n))
 blip=pic.find('p:blipFill/a:blip',NS)
 blip.set('{'+R+'}embed','rId'+str(701+n))
 blip.set('cstate','print')
 for child in list(blip):blip.remove(child)
 stretch=pic.find('p:blipFill/a:stretch',NS)
 E.SubElement(stretch,'{'+A+'}fillRect')
 for nv in r.findall('.//p:cNvPr',NS):
  nv.set('id',str(int(nv.get('id'))+1000*(n+1)))
  nv.set('name',nv.get('name','Shape')+' Joker page '+str(n+1))
 files['ppt/media/'+media]=image.read_bytes()
 save(f'ppt/slides/slide{num}.xml',r);save(f'ppt/slides/_rels/slide{num}.xml.rels',rels)
 if n:E.SubElement(ct,'{'+ctns+'}Override',PartName=f'/ppt/slides/slide{num}.xml',ContentType='application/vnd.openxmlformats-officedocument.presentationml.slide+xml')
# Samsung's required key-policy table, with actual platform behavior.
r=xml('ppt/slides/slide11.xml');title(r,200,'Key Policy')
text_body(shape(r,201),['Smart Remote: five-way + Return are sufficient. Optional color/media keys are supplementary.'],1500,False)
rows=table_cells(r)
values=[['Button','Action','Remarks'],['OK / ENTER','Menus: select. Flight: hold for guns and locked missiles.','Required'],['Ch. Up/Down','No app action; remains platform controlled.','Not registered'],['UP / DOWN','Menus: move focus. Flight: pitch. Privacy: scroll.','Assisted steering'],['LEFT / RIGHT','Menus: move focus. Flight: turn; double tap to evade.','Double tap evade'],['COLOR KEYS','Red evade; green boost; yellow brake; blue target.','Optional'],['RETURN','Pause/resume; close dialog; on Title offer exit confirmation.','Samsung Mandatory'],['EXIT','Terminate using Tizen application API (10182).','Samsung Mandatory'],['RETURN / EXIT','Return offers game exit popup on Title; Exit terminates immediately.','Platform policy']]
# Remove template's empty spacer row, retain all required button rows.
if not any(''.join(t.text or '' for t in c.findall('.//a:t',NS)).strip() for c in rows[0]):
 tbl=r.find('.//a:tbl',NS);tbl.remove(tbl.find('a:tr',NS));rows=table_cells(r)
for row,vals in zip(rows,values):
 for cell,value in zip(row,vals):text_body(cell.find('a:txBody',NS),[value],1150)
save('ppt/slides/slide11.xml',r)
r=xml('ppt/slides/slide12.xml');rows=table_cells(r)
text_body(rows[1][1].find('a:txBody',NS),[
'English only for interface, captions and recorded radio. There is no language selector. Changing the TV language does not translate the game.',
'Optional gamepad: left stick flies; X guns, A missile, B evade, Y target, RT boost, LT brake, LB/RB rudder. D-pad up/left/right sends cover/scouts/split orders. Start pauses. Menus use D-pad/left stick, A select and B back.',
'Reviewer navigation: Mission 01 is the only playable level. Web Inspector may load index.html?debug and call __joker.start with launch, training, scouts, chase, ace or final. No invulnerability is needed for normal play.',
'Screens in this document are actual desktop-browser renders of the packaged TV build. They do not establish physical-TV performance. Contact: support@toyboxes.app.'
],1500)
save('ppt/slides/slide12.xml',r)
# Keep all required sections in template order; discard only the guide and obsolete examples.
order=[2,3,4,5,8]+menu_ids+[11,12]
pres=xml('ppt/presentation.xml');sldlst=pres.find('p:sldIdLst',NS);old_ids=list(sldlst)
pr=xml('ppt/_rels/presentation.xml.rels')
rel_by_slide={int(re.search(r'slide(\d+)\.xml',e.get('Target','')).group(1)):e.get('Id') for e in pr if re.search(r'slide(\d+)\.xml',e.get('Target',''))}
for num in menu_ids[1:]:
 rid='rIdJoker'+str(num);E.SubElement(pr,'{'+REL+'}Relationship',Id=rid,Type=R+'/slide',Target=f'slides/slide{num}.xml');rel_by_slide[num]=rid
for e in old_ids:sldlst.remove(e)
for index,num in enumerate(order):E.SubElement(sldlst,'{'+P+'}sldId',{'id':str(400+index),'{'+R+'}id':rel_by_slide[num]})
save('ppt/presentation.xml',pres);save('ppt/_rels/presentation.xml.rels',pr);save('[Content_Types].xml',ct)
# Update safe document metadata, without changing template masters, themes or fonts.
if 'docProps/core.xml' in files:
 core=xml('docProps/core.xml')
 for e in core:
  if e.tag.rsplit('}',1)[-1] in ['creator','lastModifiedBy']:e.text='Randroid LLC'
  if e.tag.rsplit('}',1)[-1]=='title':e.text="Joker's Run Samsung TV UI Description"
 save('docProps/core.xml',core)
if 'docProps/app.xml' in files:
 app=xml('docProps/app.xml')
 for e in app:
  if e.tag.rsplit('}',1)[-1]=='Slides':e.text=str(len(order))
 save('docProps/app.xml',app)
# The presentation playlist is the source of truth; no template sample is shown.
with ZipFile(OUT,'w',ZIP_DEFLATED) as o:
 for name,data in files.items():o.writestr(name,data)
check=ZipFile(OUT);assert check.testzip() is None
for name in check.namelist():
 if name.endswith(('.xml','.rels')):E.fromstring(check.read(name))
print('Created:',OUT)
print('Visible slides:',len(order))
print('Required sections preserved; screenshot pixels unchanged; all XML and ZIP integrity checks passed.')
