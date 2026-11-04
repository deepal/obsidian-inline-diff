import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectSession, installOracle, setFixture } from './qa-client.mjs';
import { projectRendered, canonical } from './unified-oracle.mjs';
const session=await connectSession(),{page}=session,passed=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/inline.diff/i.test(m.text()))errors.push(m.text())});
const proposal=(a,b)=>`{~~${a}~>${b}~~}`;
const table=(value)=>'| Key | Left | Right |\n| :--- | :---: | ---: |\n'+Array.from({length:32},(_,i)=>`| Row ${i} | ${i%4===0?value(i):'same'} | Keep |`).join('\n');
const templateCases=[
 ['whole-paragraph',v=>v('The service starts slowly and uses old settings.','The service boots quickly and loads new settings.'),1],
 ['phrase-scope',v=>`Prefix ${v('small old phrase','small new phrase')} suffix.`,1],
 ['whitespace-evidence',v=>`A ${v(' ','  ')} B and ${v('<!-- old -->','<!-- new -->')}.`,2],
 ['eight-table-cells',value=>table(i=>value('same',`new ${i}`)),8],
 ['wide-horizontal-table',v=>'| '+Array.from({length:12},(_,i)=>`Column_${i}_heading_that_must_not_wrap`).join(' | ')+' |\n| '+Array(12).fill('---').join(' | ')+' |\n| '+Array.from({length:12},(_,i)=>i===0||i===11?v('same',`new ${i}`):'unchanged').join(' | ')+' |',2],
 ['headers-and-same-cell',value=>`| ${value('Same','Header')} | ${value('Same','Other')} |\n| --- | ---: |\n| ${value('same','one')} and ${value('same','two')} | keep |`,4],
 ['format-escaped-pipes-links',v=>`| A | B |\n| --- | --- |\n| **${v('same','new')}** | [${v('same','label')}](Target.md) |\n| A\\|B ${v('old','new')} | \`A\\|B\` |`,3],
 ['multiple-tables',v=>`| A | B |\n| --- | --- |\n| ${v('same','one')} | keep |\n\n| A | B |\n| --- | --- |\n| ${v('same','two')} | keep |`,2],
 ['ordered-nested-tasks',v=>`3. ${v('same','first')}\n4. keep\n   - [ ] ${v('same','nested')}\n5. ${v('same','last')}`,3],
 ['callout-title-and-body',v=>`> [!note] ${v('same','Title')}\n> ${v('same','body')}\n>\n> Unchanged paragraph.`,2],
 ['nested-folded-callout-table',v=>`> [!note]- Outer\n> ${v('same','body')}\n>\n> > [!tip] ${v('same','Title')}\n> > | A | B |\n> > | --- | --- |\n> > | ${v('same','cell')} | keep |\n> >\n> > \`\`\`js\n> > const literal = 1;\n> > \`\`\``,3],
 ['adjacent-unicode-rtl',v=>`## ${v('👨🏾‍💻','👩🏻‍🔬')} ${v('مرحبا','שלום')}\n\nA ${v('same','one')}${v('same','two')} paragraph.`,4],
 ['hidden-destination',v=>`A ${v('old','new')} and ${v('[same](Target.md)','[same](Other.md)')} link.`,2],
 ['local-list-structure',v=>`- ${v('**old**','_new_')}\n- keep\n- ${v('before','after')}`,2],
];
const fixtures=templateCases.map(([name,build,count])=>{
 const decisions=[];const source=build((before,after)=>{const raw=proposal(before,after);decisions.push({raw,before,after});return raw});
 return {name,count,source,before:build(a=>a),after:build((a,b)=>b),decisions};
});
fixtures.push({name:'row-and-cell-independent',count:2,source:'| A | B |\n| --- | --- |\n| first | {~~old~>new~~} |\n{++\n| added | row |\n++}\n| last | keep |',before:'| A | B |\n| --- | --- |\n| first | old |\n| last | keep |',after:'| A | B |\n| --- | --- |\n| first | new |\n| added | row |\n| last | keep |'});
fixtures.push(...[
 ['table-row-addition','| A | B |\n| --- | --- |\n| first | keep |','| A | B |\n| --- | --- |\n| first | keep |\n| added | row |'],
 ['table-column-rewrite','| A | B |\n| --- | --- |\n| one | two |','| A | C | D |\n| --- | --- | --- |\n| one | three | four |'],
 ['callout-type','> [!note] Title\n> Keep body.','> [!warning] Title\n> Keep body.'],
 ['list-structural','- First\n- Second','1. First\n2. Added\n3. Second'],
].map(([name,before,after])=>({name,count:1,source:`{~~\n${before}\n~>\n${after}\n~~}`,before,after})));
async function ready(mode,count){await page.waitForFunction(({mode,count})=>{const v=app.workspace.activeLeaf.view,r=v.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view');return r&&new Set([...r.querySelectorAll('.inline-diff-review[data-inline-diff-ready=true] .inline-diff-hunk-anchor')].map(e=>e.dataset.inlineDiffId)).size===count},{mode,count},{timeout:10000})}
try{
 await installOracle(session);
 for(const fixture of fixtures.filter(f=>!process.env.QA_GRANULAR_FILTER||new RegExp(process.env.QA_GRANULAR_FILTER).test(f.name)))for(const mode of ['live','reading']){
  const source='Intro.\n\n'+fixture.source+'\n\nTail.\n';await setFixture(page,source,mode);await ready(mode,fixture.count);
  const result=await page.evaluate(async({before,after,mode,projectSource,canonicalSource})=>{
   const project=(0,eval)(`(${projectSource})`),normalize=(0,eval)(`(${canonicalSource})`),host=app.workspace.activeLeaf.view.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view');
   const bodies=[...host.querySelectorAll('.inline-diff-review[data-inline-diff-ready=true] > .inline-diff-content')];
   const results=[];
   for(const [side,markdown]of[['before',before],['after',after]]){
    const oracle=await inlineDiffQa.render(markdown),root=document.createElement('div');for(const body of bodies)root.append(...project(body,side).childNodes);
    results.push({actual:normalize(root),expected:normalize(oracle.root)});oracle.dispose();
   }
   return {pairs:host.querySelectorAll('.inline-diff-proposal').length,panels:host.querySelectorAll('.inline-diff-side').length,fullParagraphs:host.querySelectorAll('.inline-diff-side-content > p').length,results,tables:host.querySelectorAll('.inline-diff-content table').length,selectors:host.querySelectorAll('.inline-diff-anchors').length,invalid:host.querySelectorAll('.inline-diff-content table > span,.inline-diff-content tr > span,.inline-diff-content ul > span,.inline-diff-content ol > span').length};
  },{before:fixture.before,after:fixture.after,mode,projectSource:projectRendered.toString(),canonicalSource:canonical.toString()});
  assert.equal(result.pairs,fixture.count);assert.equal(result.panels,fixture.count*2);if(fixture.name==='whole-paragraph')assert.equal(result.fullParagraphs,2);if(fixture.name==='phrase-scope')assert.equal(result.fullParagraphs,0);if(fixture.name==='table-column-rewrite')assert.equal(result.tables,2);
  for(const r of result.results)assert.equal(r.actual,r.expected,fixture.name+'/'+mode);assert.equal(result.selectors,0);assert.equal(result.invalid,0);
  if(fixture.name==='eight-table-cells')assert.equal(result.tables,1);
  assert.equal(await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData()),source);
  if(fixture.name==='eight-table-cells'){
   await page.screenshot({path:path.resolve('.qa',`granular-table-${mode}.png`)});
   const observed=[];
   // Native pointer activation must reach eight distinct cells, then the proposal outside the table.
   const extended=source.replace('\n\nTail.','\n\nOutside {~~before~>after~~}.\n\nTail.')+'\n'+'Trailing paragraph.\n\n'.repeat(40);
   await setFixture(page,extended,mode);
   for(let index=1;index<=9;index++){
    await page.locator('.workspace-leaf.mod-active .inline-diff-review-bar [data-direction="1"]').click();
    await page.waitForFunction(index=>app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-navigation-status')?.textContent===`Change ${index} of 9`,index);
    const target=await page.evaluate(mode=>{const h=app.workspace.activeLeaf.view.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view').querySelector('.inline-diff-navigation-target'),cell=h?.closest('td,th');return {id:h?.dataset.inlineDiffId,cell:cell?`${cell.parentElement.rowIndex}:${cell.cellIndex}`:null,table:h?.tagName==='TABLE',flashing:!!h?.closest('.is-flashing'),visible:!!h&&h.getBoundingClientRect().height>0}},mode);
    assert.ok(target.visible);assert.equal(target.table,false);assert.equal(target.flashing,false);if(index<=8)assert.ok(target.cell);else assert.equal(target.cell,null);observed.push(target);
   }
   assert.equal(new Set(observed.slice(0,8).map(x=>x.cell)).size,8);assert.equal(new Set(observed.map(x=>x.id)).size,9);
  }
  if(fixture.name==='wide-horizontal-table'){
   await page.setViewportSize({width:720,height:900});
   await setFixture(page,source+'\n'+'Trailing paragraph.\n\n'.repeat(40),mode);await ready(mode,2);
   for(let index=1;index<=2;index++){
    await page.locator('.workspace-leaf.mod-active .inline-diff-review-bar [data-direction="1"]').click();
    await page.waitForFunction(index=>app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-navigation-status')?.textContent===`Change ${index} of 2`,index);
    const horizontal=await page.evaluate(mode=>{
     const root=app.workspace.activeLeaf.view.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view'),h=root.querySelector('.inline-diff-navigation-target'),box=h.getBoundingClientRect();
     let parent=h.parentElement;const scrollers=[];
     while(parent&&!parent.matches('.cm-scroller,.markdown-preview-view')){if(parent.scrollWidth>parent.clientWidth&&/auto|scroll/.test(getComputedStyle(parent).overflowX)){const r=parent.getBoundingClientRect();scrollers.push({left:parent.scrollLeft,visible:box.width>r.width-16?box.left>=r.left-1&&box.left<=r.left+9:box.left>=r.left-1&&box.right<=r.right+1,box:[box.left,box.right],parent:[r.left,r.right],width:parent.clientWidth,className:parent.className})}parent=parent.parentElement}
     return {scrollers,cell:h.closest('td')?.cellIndex};
    },mode);
    assert.equal(horizontal.cell,index===1?0:11);assert.ok(horizontal.scrollers.length);assert.ok(horizontal.scrollers.every(s=>s.visible),JSON.stringify(horizontal));
    if(index===2)assert.ok(horizontal.scrollers.some(s=>s.left>0));
   }
   await page.screenshot({path:path.resolve('.qa',`granular-wide-table-${mode}.png`)});
   const point=await page.evaluate(mode=>{
    const view=app.workspace.activeLeaf.view,root=view.contentEl.querySelector(mode==='reading'?'.markdown-reading-view':'.markdown-source-view'),h=root.querySelector('.inline-diff-navigation-target'),r=h.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
   },mode);
   await page.mouse.move(point.x,point.y);await page.mouse.wheel(-300,0);
   await page.waitForFunction(()=>!app.workspace.activeLeaf.view.contentEl.querySelector('.inline-diff-navigation-status').textContent);
await page.setViewportSize({width:1280,height:900});
  }
  if(mode==='live')for(let proposalIndex=0;proposalIndex<fixture.count;proposalIndex++)for(const decision of ['accept','reject']){
   await setFixture(page,source,mode);await ready(mode,fixture.count);
   const anchors=page.locator('.markdown-source-view .inline-diff-hunk-anchor[tabindex]');await page.mouse.move(5,5);await page.waitForTimeout(220);await anchors.nth(proposalIndex).hover();await page.locator(".inline-diff-toolbar:visible").waitFor();
   const snapshot=await page.evaluate(()=>{const t=app.plugins.plugins['inline-diff'].overlay(document).target;return {source:t.source,raw:t.proposal.raw,before:t.proposal.before,after:t.proposal.after,from:t.proposal.from,to:t.proposal.to}});
   await page.locator(`.inline-diff-toolbar:visible [data-decision=${decision}]`).click();await page.evaluate(async()=>{await app.plugins.plugins['inline-diff'].lastResolution;await inlineDiffQa.save(app.workspace.activeLeaf.view)});
   let captured=fixture.decisions?.[proposalIndex];
   if(!captured&&fixture.count===1)captured={raw:fixture.source+'\n',before:fixture.before+'\n',after:fixture.after+'\n'};
   if(!captured&&fixture.name==='row-and-cell-independent')captured=proposalIndex===0?{raw:'{~~old~>new~~}',before:'old',after:'new'}:{raw:'{++\n| added | row |\n++}\n',before:'',after:'| added | row |\n'};
   assert.ok(captured);assert.equal(snapshot.raw,captured.raw);assert.equal(snapshot.from,source.indexOf(captured.raw));
   const expected=source.replace(captured.raw,decision==='accept'?captured.after:captured.before);
   assert.equal(await fs.readFile(path.join(session.vault,'Review.md'),'utf8'),expected);await page.evaluate(()=>inlineDiffQa.undo(app.workspace.activeLeaf.view));assert.equal(await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData()),source);await page.evaluate(()=>inlineDiffQa.redo(app.workspace.activeLeaf.view));assert.equal(await page.evaluate(()=>app.workspace.activeLeaf.view.getViewData()),expected);
  }
  passed.push(fixture.name+'/'+mode);console.log('PASS '+passed.at(-1));
 }
 assert.deepEqual(errors,[]);
}finally{await fs.writeFile('.qa/granular-report.json',JSON.stringify({date:new Date().toISOString(),artifacts:session.artifacts,version:await page.evaluate(()=>inlineDiffQa.version).catch(()=>null),passed,errors},null,2));await session.close()}
