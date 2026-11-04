import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {connectSession,installOracle,setFixture} from './qa-client.mjs';

// Diagnostic regression suite: failures are recorded across the whole matrix.
// Uses only disposable notes and the installed comment-plugin assets, never its settings.
const hash=b=>createHash('sha256').update(b).digest('hex');
const commentsMode=parseArgs({options:{comments:{type:'string',default:'combined'}}}).values.comments;
assert.ok(['off','combined'].includes(commentsMode),'Use --comments=off or --comments=combined.');
const combined=commentsMode==='combined',ircDir=process.env.OBSIDIAN_QA_IRC_DIR,cssFile=process.env.OBSIDIAN_QA_OVERRIDE_FILE;
assert.ok(cssFile,'Set OBSIDIAN_QA_OVERRIDE_FILE.');if(combined)assert.ok(ircDir,'Set OBSIDIAN_QA_IRC_DIR for combined-plugin tests.');
const ircManifest=combined?JSON.parse(await fs.readFile(path.join(ircDir,'manifest.json'),'utf8')):null;
if(ircManifest)assert.equal(ircManifest.id,'inline-review-comment');
const exact=await fs.readFile(cssFile),exactHash=hash(exact),session=await connectSession(),{page}=session;
const cases=[],errors=[],probes=[],cellChrome=new Map();
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&/Inline Diff:|plugin:inline-diff|plugin:inline-review-comment/.test(m.text()))errors.push(m.text())});
const profiles=[['none',''],['exact',exact.toString()],['padding','.table-cell-wrapper{padding:7px 11px 13px 9px!important}.markdown-reading-view td,.markdown-reading-view th{padding:7px 11px 13px 9px!important}'],['large-type','.cm-contentContainer,.markdown-rendered{font-size:20px;line-height:200%!important}.table-cell-wrapper{font-size:20px;line-height:30px}']];
const next='Following sentinel remains unchanged.',tail='Outside sentinel remains unchanged.';
const comment=i=>`%% ::Reviewer ${i%2?'B':'A'}:: Review this change ${i}. %%`;
const comments=n=>Array.from({length:n},(_,i)=>comment(i)).join(' ');
const table=(v,after='')=>`| Item | Value |\n| --- | --- |\n| Previous | Stable |\n| ${v('Earlier wording','Updated wording')}${after} | Stable |\n| ${next} | Stable |`;
const fixtures=[
 ['table-clean',v=>table(v),[next,tail]],
 ['table-spaces',v=>table(v,'   '),[next,tail]],
 ['table-tabs',v=>table(v,Array.from({length:4},(_,i)=>comment(i)).join('\t')),[next,tail]],
 ['table-before-comments',v=>table((a,b)=>comments(4)+' '+v(a,b)),[next,tail]],
 ['table-between-proposals',v=>table((a,b)=>v(a,b)+comments(4)+' '+v('Second earlier','Second updated')),[next,tail],2],
 ['table-one-comment',v=>table(v,comment(0)),[next,tail]],
 ['table-four-comments',v=>table(v,comments(4)),[next,tail]],
 ['paragraph',v=>v('Earlier paragraph.','Updated paragraph.')+comments(4)+`\n\n${next}`,[next,tail]],
 ['heading',v=>'## '+v('Earlier heading','Updated heading')+comments(2)+`\n\n${next}`,[next,tail]],
 ['list',v=>'- '+v('Earlier item','Updated item')+comments(4)+`\n- ${next}`,[next,tail]],
 ['callout',v=>'> [!note] Context\n> '+v('Earlier wording.','Updated wording.')+comments(4)+`\n>\n> ${next}`,[next,tail]],
 ['whole-callout',v=>v('> [!note] Earlier\n> Earlier content.','> [!note] Updated\n> Updated content.')+`\n\n${next}`,[next,tail]],
 ['next-heading',v=>v('Earlier paragraph.','Updated paragraph.')+`\n\n## ${next}`,[next,tail]],
 ['next-code',v=>v('Earlier paragraph.','Updated paragraph.')+'\n\n```text\n'+next+'\n```',[next,tail]],
 ['next-table',v=>v('Earlier paragraph.','Updated paragraph.')+`\n\n| Item | Value |\n| --- | --- |\n| ${next} | Stable |`,[next,tail]],
 ['next-callout',v=>v('Earlier paragraph.','Updated paragraph.')+`\n\n> [!note] Following\n> ${next}`,[next,tail]],
 ['code',v=>v('```js\nconst earlier = 1;\n```','```js\nconst updated = 2;\n```')+`\n\n${next}`,[next,tail]],
];
const wrap=text=>'Intro.\n\n'+text+'\n\n'+tail+'\n';
const marker=(a,b)=>a.includes('\n')||b.includes('\n')?`{~~\n${a}\n~>\n${b}\n~~}`:`{~~${a}~>${b}~~}`;
const fixtureCss='#qa-following-content .markdown-source-view table,#qa-following-content .markdown-reading-view table{table-layout:fixed;width:800px;min-width:800px;max-width:800px}#qa-following-content .markdown-source-view td,#qa-following-content .markdown-source-view th,#qa-following-content .markdown-reading-view td,#qa-following-content .markdown-reading-view th{width:400px;min-width:400px;max-width:400px}';
async function settle(){await page.evaluate(async()=>{await document.fonts.ready;for(let i=0;i<8;i++)await new Promise(r=>requestAnimationFrame(r))})}
async function snippet(css){
 const p=path.join(session.vault,'.obsidian/snippets/qa-following.css');await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,css);
 await page.evaluate(async enabled=>{await app.customCss.readSnippets();app.customCss.setCssEnabledStatus('qa-following',enabled);await app.customCss.loadSnippets()},!!css);
 await page.waitForFunction(css=>css?app.customCss.extraStyleEls.some(e=>e.textContent===css):!app.customCss.enabledSnippets.has('qa-following'),css,{polling:25});await settle();
}
async function ready(mode,pending,count=1){
 if(pending&&mode!=='source')await page.waitForFunction(({mode,count})=>app.workspace.activeLeaf.view.contentEl.querySelectorAll((mode==='reading'?'.markdown-reading-view':'.markdown-source-view')+' .inline-diff-review[data-inline-diff-ready=true] .inline-diff-proposal').length===count,{mode,count},{polling:25});
 await settle();
}
async function decisions(build,source,mode,count){
 const captured=[];build((before,after)=>{captured.push({before,after,raw:marker(before,after)});return marker(before,after)});
 for(let index=0;index<count;index++)for(const decision of ['accept','reject']){
  await setFixture(page,source,mode);await ready(mode,true,count);
  let target;
  if(mode==='source'){
   const ids=await page.evaluate(()=>[...new Set([...app.workspace.activeLeaf.view.contentEl.querySelectorAll('.cm-content .inline-diff-source-mark')].map(e=>e.dataset.inlineDiffId))]);
   target=page.locator(`.workspace-leaf.mod-active .cm-content .inline-diff-source-mark[data-inline-diff-id="${ids[index]}"]`).first();
  }else target=page.locator('.workspace-leaf.mod-active .markdown-source-view .inline-diff-proposal[tabindex]').nth(index);
  await page.mouse.move(5,5);await target.hover();
  await page.locator(`.inline-diff-toolbar:visible [data-decision=${decision}]`).click();
  await page.evaluate(async()=>{await app.plugins.plugins['inline-diff'].lastResolution;await inlineDiffQa.save(app.workspace.activeLeaf.view)});
  const arm=captured[index],expected=source.replace(arm.raw,decision==='accept'?arm.after:arm.before);
  assert.equal(await fs.readFile(path.join(session.vault,'Review.md'),'utf8'),expected,'decision preserves comment and following-content bytes');
  assert.deepEqual(await page.evaluate(()=>inlineDiffQa.historyDepth(app.workspace.activeLeaf.view)),{undo:1,redo:0});
  await page.evaluate(async()=>{inlineDiffQa.undo(app.workspace.activeLeaf.view);await inlineDiffQa.save(app.workspace.activeLeaf.view)});
  assert.equal(await fs.readFile(path.join(session.vault,'Review.md'),'utf8'),source,'one undo restores exact source');
  await page.evaluate(async()=>{inlineDiffQa.redo(app.workspace.activeLeaf.view);await inlineDiffQa.save(app.workspace.activeLeaf.view)});
  assert.equal(await fs.readFile(path.join(session.vault,'Review.md'),'utf8'),expected,'redo restores exact decision');
 }
}
async function snapshot(mode,labels){return page.evaluate(({mode,labels})=>{
 const view=app.workspace.activeLeaf.view,root=view.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view');
 const rect=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom}};
 const style=e=>{const s=getComputedStyle(e);return Object.fromEntries(['font-family','font-size','font-weight','font-style','line-height','color','letter-spacing','white-space','text-decoration-line'].map(k=>[k,s.getPropertyValue(k)]))};
 const following=labels.map(label=>{
  const found=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){let at=node.data.indexOf(label);if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+label.length);const boxes=[...range.getClientRects()].filter(r=>r.width&&r.height);if(boxes.length){const block=node.parentElement.closest('p,h1,h2,h3,h4,h5,h6,li,pre,tr,.cm-line');found.push({block: block?rect(block):null,parentTag:node.parentElement.tagName,editableLine:!!node.parentElement.closest('.cm-line'),style:style(node.parentElement),rects:boxes.map(r=>({x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom})),highlighted:!!node.parentElement.closest('.inline-diff-text,.inline-diff-proposal'),text:range.toString()})}}
  return{label,found};
 });
 const avatars=[...root.querySelectorAll('.irc-inline-avatar')].filter(e=>e.getBoundingClientRect().height>0).map(e=>{const row=e.closest('tr'),cell=e.closest('td,th');return{rect:rect(e),row:row?.rowIndex,cell:cell?.cellIndex,rowBox:row?rect(row):null,insideWrapper:!!e.closest('.table-cell-wrapper'),parent:e.parentElement.tagName}});
 const pair=root.querySelector('.inline-diff-proposal'),cell=pair?.closest('td,th'),wrapper=cell?.querySelector(':scope > .table-cell-wrapper'),row=cell?.closest('tr'),after=row?.nextElementSibling;
 const table=cell?{rowIndex:row.rowIndex,pair:{...rect(pair),h:[...cell.querySelectorAll('.inline-diff-proposal')].reduce((sum,p)=>sum+p.getBoundingClientRect().height,0)},cell:rect(cell),row:rect(row),followingRow:after?rect(after):null,wrapper:wrapper?rect(wrapper):null,padding:[getComputedStyle(wrapper??cell).paddingTop,getComputedStyle(wrapper??cell).paddingBottom].map(parseFloat),border:[getComputedStyle(cell).borderTopWidth,getComputedStyle(cell).borderBottomWidth].map(parseFloat),lineHeight:parseFloat(getComputedStyle(wrapper??cell).lineHeight)}:null;
 return{following,avatars,table,history:inlineDiffQa.historyDepth(view)};
},{mode,labels})}
function issues(actual,native,chrome){
 const result=[];
 for(let i=0;i<actual.following.length;i++){
  const a=actual.following[i],b=native.following[i];
  if(a.found.length!==1||b.found.length!==1){result.push(`following-content occurrence count ${a.found.length}/${b.found.length}`);continue}
  const x=a.found[0],y=b.found[0];
  const expectedStyle={...y.style};if(x.parentTag==='LI'&&y.editableLine&&native.renderedListWhiteSpace)expectedStyle['white-space']=native.renderedListWhiteSpace;
  if(JSON.stringify(x.style)!==JSON.stringify(expectedStyle))result.push(`following typography: ${a.label}`);
  if(x.highlighted)result.push(`following content included in comparison: ${a.label}`);
  if(x.block&&y.block&&Math.abs(x.block.h-y.block.h)>.5)result.push(`following block height: ${a.label}`);
  if(x.rects.length!==y.rects.length||x.rects.some((r,i)=>Math.abs(r.w-y.rects[i]?.w)>.5||Math.abs(r.h-y.rects[i]?.h)>.5))result.push(`following wrapping/dimensions: ${a.label}`);
  for(const avatar of actual.avatars)for(const r of x.rects){const box=avatar.rect,overlapX=Math.min(box.x+box.w,r.x+r.w)-Math.max(box.x,r.x),overlapY=Math.min(box.bottom,r.bottom)-Math.max(box.y,r.y);if(overlapX>.5&&overlapY>.5)result.push(`avatar overlaps following content: ${a.label}`)}
 }
 for(const avatar of actual.avatars)if(avatar.rowBox&&avatar.rect.bottom>avatar.rowBox.bottom+.5)result.push('avatar overflows its owning row');
 if(actual.table&&chrome!==undefined){const t=actual.table,avatars=actual.avatars.filter(a=>a.row===t.rowIndex),extra=t.cell.h-t.pair.h-chrome,allowed=avatars.length?t.lineHeight:0;if(extra>allowed+.5)result.push(`unaccounted cell height ${extra.toFixed(3)}px (allowed avatar line ${allowed.toFixed(3)}px)`)}
 return [...new Set(result)];
}
try{
 await installOracle(session);
 if(combined){const ircDest=path.join(session.vault,'.obsidian/plugins/inline-review-comment');await fs.mkdir(ircDest,{recursive:true});const ircHashes={};for(const file of ['main.js','manifest.json','styles.css']){const b=await fs.readFile(path.join(ircDir,file));await fs.writeFile(path.join(ircDest,file),b);ircHashes[file]=hash(b)}session.ircArtifacts={version:ircManifest.version,sha256:ircHashes};}
 await page.evaluate(()=>app.plugins.loadManifests());await page.setViewportSize({width:1280,height:1200});
 await page.evaluate(css=>{document.body.id='qa-following-content';const s=document.createElement('style');s.textContent=css;document.head.append(s)},fixtureCss);
 for(const [profile,css]of profiles)for(const irc of (combined?[false,true]:[false])){
  await snippet(css);await page.evaluate(async enabled=>{if(enabled)await app.plugins.enablePlugin('inline-review-comment');else if(app.plugins.plugins['inline-review-comment'])await app.plugins.disablePlugin('inline-review-comment')},irc);
  for(const mode of ['source','live','reading'])for(const [id,build,labels,count=1]of fixtures){
   const name=`${profile}/${irc?'comments-on':'comments-off'}/${mode}/${id}`;
   try{
    await setFixture(page,wrap(build((a,b)=>b)),mode);await ready(mode,false);const native=await snapshot(mode,labels);
    // Ordinary Live Preview lists use editable CM lines; review-owned lists use
    // native rendered Markdown. Verify that context's whitespace independently.
    if(mode==='live'&&id==='list')native.renderedListWhiteSpace=await page.evaluate(async label=>{const oracle=await inlineDiffQa.render('- Earlier item\n- '+label);try{oracle.root.className='cm-embed-block markdown-rendered';app.workspace.activeLeaf.view.contentEl.querySelector('.markdown-source-view').append(oracle.root);return getComputedStyle(oracle.root.querySelector('li')).whiteSpace}finally{oracle.dispose()}},next);
    const source=wrap(build(marker));await setFixture(page,source,mode);await ready(mode,true,count);const actual=await snapshot(mode,labels);const chromeKey=`${profile}/${irc}/${mode}`;if(id==='table-clean'&&actual.table)cellChrome.set(chromeKey,actual.table.cell.h-actual.table.pair.h);const failures=issues(actual,native,cellChrome.get(chromeKey));
    if(await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData())!==source)failures.push('buffer changed');if(await fs.readFile(path.join(session.vault,'Review.md'),'utf8')!==source)failures.push('saved bytes changed');if(actual.history.undo||actual.history.redo)failures.push('unexpected undo history');
    if(profile==='exact'&&!irc&&id==='table-four-comments')await page.screenshot({path:path.resolve(`.qa/comment-spacing-${mode}.png`)});
    if(profile==='exact'&&irc&&mode==='live'&&id==='table-four-comments')await page.screenshot({path:path.resolve('.qa/following-table-avatar-overlap.png')});
    if(mode!=='reading')try{await decisions(build,source,mode,count)}catch(error){failures.push('decision/undo regression: '+error.message)}
    cases.push({name,native,actual,failures});console.log(`${failures.length?'FAIL':'PASS'} ${name}${failures.length?' '+failures.join('; '):''}`);
   }catch(error){cases.push({name,failures:[error.message]});console.log('FAIL '+name+' '+error.message.split('\n')[0])}
  }
 }
 if(combined){
 // Causal DOM probes in a disposable fixture, with source and styles preserved.
 await snippet(exact.toString());await page.evaluate(async()=>{await app.plugins.disablePlugin('inline-review-comment');await app.plugins.enablePlugin('inline-review-comment')});
 const source=wrap(table(marker,comments(4)));await setFixture(page,source,'live');await ready('live',true);
 probes.push({variant:'observed',snapshot:await snapshot('live',[next,tail])});
 await page.evaluate(()=>{const row=app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-proposal').closest('tr');globalThis.qaProbeAvatars=[...row.querySelectorAll('.irc-inline-avatar')].map(a=>a.cloneNode(true));app.plugins.plugins['inline-review-comment'].markerManager.destroy()});await settle();
 probes.push({variant:'avatars-removed',snapshot:await snapshot('live',[next,tail])});
 await page.evaluate(()=>{const cell=app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-proposal').closest('td');cell.querySelector(':scope > .table-cell-wrapper').append(...qaProbeAvatars)});await settle();
 probes.push({variant:'avatars-in-wrapper',snapshot:await snapshot('live',[next,tail])});
 await page.evaluate(()=>{const pair=app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-proposal');for(const n of [...pair.parentElement.childNodes])if(n.nodeType===3&&!n.textContent.trim())n.remove()});await settle();
 probes.push({variant:'avatars-in-wrapper-no-empty-space',snapshot:await snapshot('live',[next,tail])});
 await page.evaluate(()=>{for(const avatar of qaProbeAvatars)avatar.remove();delete globalThis.qaProbeAvatars});await settle();
 probes.push({variant:'no-avatar-no-empty-space',snapshot:await snapshot('live',[next,tail])});
 assert.equal(await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData()),source);assert.equal(await fs.readFile(path.join(session.vault,'Review.md'),'utf8'),source);}
 assert.equal(hash(await fs.readFile(cssFile)),exactHash);
}finally{
 const failures=cases.filter(c=>c.failures.length);
 await fs.writeFile('.qa/following-content-report.json',JSON.stringify({date:new Date().toISOString(),commentsMode,version:await page.evaluate(()=>inlineDiffQa.version).catch(()=>null),runtime:await page.evaluate(()=>({userAgent:navigator.userAgent,versions:globalThis.process?.versions})).catch(()=>null),artifacts:session.artifacts,ircArtifacts:session.ircArtifacts,exactSnippetSha256:exactHash,cases,probes,errors,summary:{total:cases.length,passed:cases.length-failures.length,failed:failures.length}},null,2));
 console.log(JSON.stringify({total:cases.length,failed:failures.length,errors:errors.length}));await session.close();if(failures.length||errors.length)process.exitCode=1;
}
