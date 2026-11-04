import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {connectSession,installOracle,setFixture} from './qa-client.mjs';

const session=await connectSession(),{page}=session,passed=[],measurements=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&/inline.diff|plugin:inline-diff/i.test(m.text()))errors.push(m.text())});
const hash=b=>createHash('sha256').update(b).digest('hex');
const privateCss=process.env.OBSIDIAN_QA_OVERRIDE_FILE;
assert.ok(privateCss,'Set OBSIDIAN_QA_OVERRIDE_FILE to the current personal snippet (read-only).');
const exact=await fs.readFile(privateCss),exactHash=hash(exact);
const profiles=[
 ['none',''],
 ['regression','.cm-contentContainer,.markdown-rendered{line-height:200%!important}.table-cell-wrapper{padding:10px!important;font-size:var(--font-text-size)!important}'],
 ['exact',exact.toString()],
 ['padding','.table-cell-wrapper{padding:7px 11px 13px 9px!important}.markdown-reading-view .markdown-rendered td,.markdown-reading-view .markdown-rendered th{padding:7px 11px 13px 9px!important}'],
 ['typography','.cm-contentContainer,.markdown-rendered{font-family:monospace;font-size:18px;line-height:1.8}.table-cell-wrapper,.callout-content{font-family:monospace;font-size:18px;line-height:1.7}'],
 ['scoped','.markdown-source-view .cm-table-widget .table-cell-wrapper{line-height:28px!important;letter-spacing:.3px}.markdown-reading-view td,.markdown-reading-view th{line-height:28px!important;letter-spacing:.3px}.callout-content h2{line-height:36px!important}.callout-content p{line-height:29px!important}.callout-content li{line-height:27px!important}'],
 ['variables','body{--table-line-height:1.8;--size-2-2:6px;--table-text-size:17px}.callout-content{line-height:1.9}'],
 ['whitespace','.markdown-reading-view,.markdown-source-view .markdown-rendered{white-space:pre-wrap}'],
 ['chrome','.inline-diff-side{padding-block:3px}.inline-diff-side-content{letter-spacing:.4px}'],
];
const fixtures=[
 ['table',v=>'| Key | '+v('Value','Label')+' |\n| --- | --- |\n| Keep | Same |\n| Other | Same |\n| Change | '+v('old','new')+' |',2],
 ['contexts',v=>'> [!note] Context\n> ## Heading '+v('old','new')+'\n> Paragraph '+v('old','new')+' ends here.\n>\n> - Item '+v('old','new')+'\n>\n> | A | B |\n> | --- | --- |\n> | Keep | Same |\n> | '+v('old','new')+' | Keep |\n>\n> ```js\n> const unchanged = 1;\n> ```',4],
];
const wrap=s=>'Intro.\n\n'+s+'\n\nTail.\n';
// Independently specified columns isolate row padding from content sizing.
const fixtureCss='#qa-override-fixtures .markdown-source-view table,#qa-override-fixtures .markdown-reading-view table{table-layout:fixed;width:400px;min-width:400px;max-width:400px}#qa-override-fixtures .markdown-source-view th,#qa-override-fixtures .markdown-source-view td,#qa-override-fixtures .markdown-reading-view th,#qa-override-fixtures .markdown-reading-view td{width:200px;min-width:200px;max-width:200px}';
const snippetPath=path.join(session.vault,'.obsidian/snippets/qa-overrides.css');
async function snippet(css,enabled=true){
 await fs.mkdir(path.dirname(snippetPath),{recursive:true});await fs.writeFile(snippetPath,css);
 await page.evaluate(async enabled=>{await app.customCss.readSnippets();app.customCss.setCssEnabledStatus('qa-overrides',enabled);await app.customCss.loadSnippets();},enabled);
 await page.waitForFunction(({css,enabled})=>enabled ? app.customCss.extraStyleEls.some(style=>style.textContent===css) : !app.customCss.enabledSnippets.has('qa-overrides')&&!app.customCss.extraStyleEls.length,{css,enabled},{polling:25});
 await page.evaluate(css=>{const doc=app.workspace.activeLeaf.view.contentEl.ownerDocument;doc.body.id='qa-override-fixtures';let style=doc.getElementById('qa-column-layout');if(!style){style=doc.createElement('style');style.id='qa-column-layout';doc.head.append(style)}style.textContent=css},fixtureCss);
 await settle();
}
async function settle(){await page.evaluate(async()=>{const doc=app.workspace.activeLeaf.view.contentEl.ownerDocument;await doc.fonts.ready;for(let i=0;i<5;i++)await new Promise(r=>doc.defaultView.requestAnimationFrame(r));})}
async function ready(mode,count){await page.waitForFunction(({mode,count})=>{
 const root=app.workspace.activeLeaf.view.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view');return root?.querySelectorAll('.inline-diff-review[data-inline-diff-ready=true] .inline-diff-proposal').length===count;
},{mode,count},{polling:25});await settle()}
async function snapshot(mode,name){return page.evaluate(({mode,name})=>{
 const root=app.workspace.activeLeaf.view.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view');
 const css=e=>{if(!e)return null;const s=getComputedStyle(e);return Object.fromEntries(['font-family','font-size','font-weight','line-height','letter-spacing','word-spacing','text-align','white-space'].map(k=>[k,s.getPropertyValue(k)]))};
 const cellStyle=e=>{const target=e?.querySelector(':scope > .table-cell-wrapper')??e;if(!target)return null;const s=getComputedStyle(target);return {text:css(target),padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft]}};
 const table=root.querySelector('table'),row=table?.querySelector('tbody tr'),cell=row?.querySelector('td'),panels=[...root.querySelectorAll('.inline-diff-side-content')];
 const tableCell=table?.rows[table.rows.length-1]?.cells[1];
 const context=root.querySelector('.callout-content'),heading=context?.querySelector('h2'),p=context?.querySelector('p'),li=context?.querySelector('li');
 const references=name==='table'?[cellStyle(table.querySelector('th'))?.text,cellStyle(tableCell)?.text]:[css(heading),css(p),css(li),cellStyle(cell)?.text];
 return {columns:[...row.cells].map(cell=>cell.getBoundingClientRect().width),rowHeight:row?.getBoundingClientRect().height,cell:cellStyle(cell),header:cellStyle(table?.querySelector('th')),references,code:css(context?.querySelector('pre')),panels:panels.map(css),panelPadding:[...root.querySelectorAll('.inline-diff-side')].map(e=>getComputedStyle(e).paddingTop),nativeWrappers:root.querySelectorAll('.table-cell-wrapper').length,editing:root.querySelectorAll('.inline-diff-review .cm-editor,.inline-diff-review .table-row-drag-handle,.inline-diff-review .table-col-drag-handle').length};
},{mode,name})}
function compare(actual,expected,name,profile){
 assert.deepEqual(actual.cell,expected.cell,`${name}: native cell style`);assert.deepEqual(actual.header,expected.header,`${name}: native header style`);
 for(let i=0;i<actual.columns.length;i++)assert.ok(Math.abs(actual.columns[i]-expected.columns[i])<=.5,`${name}: independently controlled column width ${JSON.stringify(actual.columns)} vs ${JSON.stringify(expected.columns)}`);
 assert.ok(Math.abs(actual.rowHeight-expected.rowHeight)<=.5,`${name}: unchanged row height ${actual.rowHeight} vs ${expected.rowHeight}`);
 assert.deepEqual(actual.references,expected.references,`${name}: surrounding typography`);assert.deepEqual(actual.code,expected.code,`${name}: native code typography`);
 for(const [i,panel]of actual.panels.entries()){
  const reference=expected.references[Math.floor(i/2)];
  for(const key of ['font-family','font-size','font-weight','line-height','word-spacing','text-align','white-space'])assert.equal(panel[key],reference[key],`${name}: panel ${i}/${key}`);
  if(profile==='chrome')assert.equal(panel['letter-spacing'],'0.4px');else assert.equal(panel['letter-spacing'],reference['letter-spacing']);
 }
 if(profile==='chrome')assert.ok(actual.panelPadding.every(v=>v==='3px'));
 assert.equal(actual.editing,0,'passive tables create no editor or drag controls');
}
async function inspectInput(mode,input=page){
 await page.evaluate(()=>{for(const leaf of app.workspace.getLeavesOfType('markdown'))delete leaf.view.contentEl.dataset.qaOverridesActive;app.workspace.activeLeaf.view.contentEl.dataset.qaOverridesActive='true'});
 const scope='[data-qa-overrides-active] '+(mode==='reading'?'.markdown-reading-view':'.markdown-source-view');
 const target=input.locator(`${scope} .inline-diff-proposal`).first();await target.scrollIntoViewIfNeeded();await settle();
 const boxes=()=>input.locator(`${scope} .inline-diff-proposal,${scope} table`).evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]}));
 const before=await boxes();await target.hover();
 if(mode==='live'){await target.focus();await input.keyboard.press('Enter');await input.locator('.inline-diff-toolbar:visible button').first().waitFor();await input.keyboard.press('Escape');}
 const after=await boxes();assert.equal(after.length,before.length);for(let i=0;i<before.length;i++)for(let j=0;j<4;j++)assert.ok(Math.abs(after[i][j]-before[i][j])<=.5,'hover/focus preserves geometry');
 await input.mouse.move(2,2);
}
async function pair(mode,fixture,profile,css,label,input=page){
 const [name,build,count]=fixture;await snippet(css,!!css);
 await setFixture(page,wrap(build((a,b)=>b)),mode);await settle();const expected=await snapshot(mode,name);
 const source=wrap(build((a,b)=>`{~~${a}~>${b}~~}`));await setFixture(page,source,mode);await ready(mode,count);const actual=await snapshot(mode,name);compare(actual,expected,label,profile);await inspectInput(mode,input);
 assert.equal(await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData()),source);
 measurements.push({name:label,native:expected,comparison:actual});passed.push(label);console.log('PASS '+label);
 return {source,expected,count};
}
try{
 await installOracle(session);
 await page.setViewportSize({width:1280,height:1000});
 const themeRoot=process.env.OBSIDIAN_QA_THEME_ROOT;assert.ok(themeRoot,'Set OBSIDIAN_QA_THEME_ROOT for four-theme coverage.');
 for(const theme of ['Primary','Minimal','Blue Topaz']){const dest=path.join(session.vault,'.obsidian/themes',theme);await fs.mkdir(dest,{recursive:true});for(const file of ['manifest.json','theme.css'])await fs.copyFile(path.join(themeRoot,theme,file),path.join(dest,file));}
 await page.evaluate(()=>app.customCss.readThemes());
 for(const theme of ['','Primary','Minimal','Blue Topaz'])for(const palette of ['light','dark']){
  await page.evaluate(async({theme,palette})=>{await app.customCss.setTheme(theme);app.changeTheme(palette==='light'?'moonstone':'obsidian')},{theme,palette});await settle();
  for(const [profile,css]of profiles.filter(([id])=>!process.env.QA_OVERRIDE_PROFILE||new RegExp(process.env.QA_OVERRIDE_PROFILE).test(id)))for(const mode of ['live','reading'])for(const fixture of fixtures){
   if(process.env.QA_OVERRIDE_THEME&&theme!==process.env.QA_OVERRIDE_THEME)continue;
   const label=`${theme||'Default'}/${palette}/${profile}/${mode}/${fixture[0]}`;
   await pair(mode,fixture,profile,css,label+'/wide');
   await page.setViewportSize({width:720,height:1000});await page.evaluate(()=>require('electron').webFrame.setZoomFactor(1.5));
   await pair(mode,fixture,profile,css,label+'/narrow-150-percent');
   await page.evaluate(()=>require('electron').webFrame.setZoomFactor(1));await page.setViewportSize({width:1280,height:1000});
   if(theme===''&&palette==='light'&&['none','exact'].includes(profile))await page.screenshot({path:path.resolve('.qa',`override-${profile}-${mode}-${fixture[0]}.png`)});
  }
  if(!process.env.QA_OVERRIDE_THEME||theme===process.env.QA_OVERRIDE_THEME)for(const [profile,css]of profiles.filter(([id])=>!process.env.QA_OVERRIDE_PROFILE||new RegExp(process.env.QA_OVERRIDE_PROFILE).test(id)))for(const mode of ['live','reading']){
   const label=`${theme||'Default'}/${palette}/${profile}/${mode}`;
   await page.evaluate(async()=>{globalThis.qaOverrideMain=app.workspace.activeLeaf;globalThis.qaOverrideSplit=app.workspace.getLeaf('split');await qaOverrideSplit.openFile(qaOverrideMain.view.file);app.workspace.setActiveLeaf(qaOverrideSplit,{focus:true})});
   try{await pair(mode,fixtures[0],profile,css,label+'/split')}finally{await page.evaluate(()=>{qaOverrideSplit.detach();app.workspace.setActiveLeaf(qaOverrideMain,{focus:true})})}
   await page.evaluate(async()=>{globalThis.qaOverridePopout=app.workspace.openPopoutLeaf();await qaOverridePopout.openFile(qaOverrideMain.view.file);app.workspace.setActiveLeaf(qaOverridePopout,{focus:true})});
   let popup;for(let attempt=0;attempt<100&&!popup;attempt++){for(const candidate of session.browser.contexts()[0].pages())if(candidate!==page&&await candidate.locator('.markdown-source-view').count()){popup=candidate;break}if(!popup)await new Promise(r=>setTimeout(r,50))}
   assert.ok(popup,'native popout');
   try{await pair(mode,fixtures[0],profile,css,label+'/popout',popup)}finally{await page.evaluate(()=>{qaOverridePopout.detach();app.workspace.setActiveLeaf(qaOverrideMain,{focus:true})})}
  }
 }
 // Live cascade updates must change existing pairs without rebuilding their DOM.
 await page.evaluate(async()=>{await app.customCss.setTheme('');app.changeTheme('moonstone')});
 for(const mode of ['live','reading']){
  const fixture=fixtures[0];const {source,count}=await pair(mode,fixture,'regression',profiles[1][1],`runtime/${mode}/initial`);
  await page.evaluate(()=>{globalThis.qaOverridePair=app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-proposal')});
  await snippet(profiles[1][1],false);assert.equal(await page.evaluate(()=>qaOverridePair===app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-proposal')),true);
  const disabled=await snapshot(mode,'table');
  await snippet(profiles[1][1],true);const enabled=await snapshot(mode,'table');
  assert.equal(enabled.cell.padding[0],mode==='live'?'10px':disabled.cell.padding[0]);assert.equal(enabled.panels[0]['line-height'],enabled.references[0]['line-height']);
  await snippet(profiles[3][1]);assert.equal((await snapshot(mode,'table')).cell.padding[0],'7px');
  await page.evaluate(async()=>{await app.plugins.disablePlugin('inline-diff');await app.plugins.enablePlugin('inline-diff')});await ready(mode,count);assert.equal((await snapshot(mode,'table')).cell.padding[0],'7px');
  if(mode==='live'){
   await page.evaluate(()=>inlineDiffQa.makeReadOnly(app.workspace.activeLeaf.view));await ready(mode,count);
   assert.ok((await snapshot(mode,'table')).nativeWrappers>0);assert.equal(await page.locator('.markdown-source-view .inline-diff-hunk-anchor[tabindex]').count(),0);
  }
  assert.equal(await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData()),source);passed.push(`runtime/${mode}/toggle-edit-reload-readonly`);console.log(`PASS runtime/${mode}/toggle-edit-reload-readonly`);
 }
 for(const [profile,css]of profiles.filter(([id])=>['none','exact'].includes(id))){
  await snippet(css,!!css);
  const source=wrap(fixtures[0][1]((a,b)=>`{~~${a}~>${b}~~}`))+'\n| Native | Editable |\n| --- | --- |\n| Keep | Original |\n\nEnd.\n';
  await setFixture(page,source,'live');await ready('live',2);
  const pending=page.locator('.markdown-source-view [data-inline-diff-layout=table] tbody td').first();await pending.click();assert.equal(await page.locator('.inline-diff-review .cm-editor').count(),0);
  const native=page.locator('.markdown-source-view .cm-table-widget:not([data-inline-diff-layout]) tbody td').nth(1);await native.click();await page.locator('.cm-table-widget .cm-editor').waitFor();
  await page.keyboard.press('End');await page.keyboard.type(' edited');
  await page.evaluate(async()=>{const v=app.workspace.activeLeaf.view;v.editor.setCursor(v.editor.lastLine(),0);v.editor.focus();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await inlineDiffQa.save(v)});
  const saved=await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData());assert.match(saved,/Original edited/);assert.equal((saved.match(/\{~~/g)||[]).length,2);assert.equal(await fs.readFile(path.join(session.vault,'Review.md'),'utf8'),saved);
  passed.push(`native-editing/${profile}`);console.log(`PASS native-editing/${profile}`);
 }
 assert.deepEqual(errors,[]);assert.equal(hash(await fs.readFile(privateCss)),exactHash,'personal snippet unchanged');
}finally{
 await fs.writeFile('.qa/overrides-report.json',JSON.stringify({date:new Date().toISOString(),artifacts:session.artifacts,version:await page.evaluate(()=>inlineDiffQa.version).catch(()=>null),exactSnippetSha256:exactHash,passed,measurements,errors},null,2));
 await session.close();
}
