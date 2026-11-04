import assert from 'node:assert/strict';
import { test } from 'node:test';
import MarkdownIt from 'markdown-it';
import { parseNote, reviewGroups, reviewUnits } from '../src/model.ts';
import { dom, importHostModule } from './helpers.mjs';
import { projectRendered, canonical } from '../scripts/unified-oracle.mjs';
const { prepareProjection, captureProjection, assembleComparisons, registerReviewAnchors, reviewAnchors, unregisterReviewAnchors } = await importHostModule('src/unified.ts');
const markdown = new MarkdownIt({html:true});
const cases = [
 ['task list followed by generated block','Intro.\n\n{~~\n- [ ] Old task\n~>\n- [x] New task\n~~}\n\n{++\n```base\nfilters: x\n```\n++}\n\nTail.\n',2],
 ['added row and cell','| A | B |\n| --- | --- |\n| first | {~~old~>new~~} |\n{++\n| added | row |\n++}\n| last | keep |',2],
 ['empty emphasis context','| A | B |\n| --- | --- |\n| **{++new++}** | keep |',1],
 ['tag syntax context','#project/{~~old~>new~~}',1],
 ['eight cells','| A | B |\n| --- | --- |\n'+Array.from({length:8},(_,i)=>`| row ${i} | {~~same~>new ${i}~~} |`).join('\n'),8],
 ['header and same cell','| {~~A~>Header~~} | B |\n| :--- | ---: |\n| {~~same~>first~~} and {~~same~>second~~} | keep |',3],
 ['distant list items','1. {~~same~>one~~}\n2. keep\n3. {~~same~>two~~}',2],
 ['formatted nested list','- **{~~old~>new~~}**\n  - _{~~old~>new~~}_',2],
 ['quote and nested content','> Title {~~old~>new~~}\n>\n> - Body {~~old~>new~~}',2],
 ['links and inline code','| A | B |\n| --- | --- |\n| [{~~old~>new~~}](Target.md) | `{~~old~>new~~}` |\n| {~~a~>b~~} | keep |',2],
];
for (const [name,source,count] of cases) test(`${name}: one native structure and independently mapped anchors`,()=>{
 const d=dom(), doc=d.window.document, note=parseNote(source), group=reviewGroups(note)[0], units=reviewUnits(note,group);
 assert.equal(units.length,count);
 const render=value=>{const el=doc.createElement('div');el.innerHTML=markdown.render(value);return el;};
 const before=render(group.before),after=render(group.after),prefix='SOURCELOCATION';
 const ranges=side=>{const original=side==='reject'?before:after,source=side==='reject'?group.before:group.after,capture=prepareProjection(original,source,units,side,prefix);return capture.text===source?capture.blocks:captureProjection(original,render(capture.text),capture);};
 const result=assembleComparisons(before,after,units,ranges('reject'),ranges('accept'));
 const host=doc.createElement('section');host.className='inline-diff-review';host.append(result.element);doc.body.append(host);
 registerReviewAnchors(host,units,true);
 assert.equal(host.querySelectorAll('.inline-diff-hunk-anchor').length,count);
 for(const unit of units){const anchors=reviewAnchors(doc.body,unit.id);assert.ok(anchors.length);for(const anchor of anchors)assert.equal(anchor.dataset.inlineDiffId,unit.id);}
 for(const [side,expected] of [['before',group.before],['after',group.after]])assert.equal(canonical(projectRendered(result.element,side)),canonical(render(expected)));
 assert.equal(host.querySelectorAll('table:not([data-inline-diff-shell])').length,markdown.render(group.before).includes('<table>')?1:0);
 assert.equal(host.querySelector('table > span,tr > span,ul > span,ol > span'),null);
 unregisterReviewAnchors(host);assert.equal(reviewAnchors(doc.body,units[0].id).length,0);d.window.close();
});
test('mismatched attribution fails closed rather than targeting matching words elsewhere',()=>{
 const d=dom(),doc=d.window.document, note=parseNote('A {~~same~>one~~} and {~~same~>two~~}.'),units=reviewUnits(note,reviewGroups(note)[0]);
 const original=doc.createElement('div'),marked=doc.createElement('div');original.innerHTML='<p>same same</p>';marked.innerHTML='<p>;IDS0;same;IDE0; changed</p>';
 assert.throws(()=>captureProjection(original,marked,{prefix:'ID',units,blocks:new Map()}),/Could not map/);d.window.close();
});

test('source units keep proposal decisions while exposing distinct source passages and table locations',()=>{
 const note=parseNote('| A | B |\n| --- | --- |\n| {~~old one and old two~>new one and new two~~} | keep |');
 const unit=reviewUnits(note,reviewGroups(note)[0])[0];
 assert.equal(unit.id,note.proposals[0].id);assert.equal(unit.proposal,note.proposals[0]);assert.ok(unit.hunks.length>=2);
 for(const hunk of unit.hunks){assert.equal(hunk.proposalId,unit.id);assert.equal(hunk.beforeLocation.row,2);assert.equal(hunk.beforeLocation.column,0);assert.ok(hunk.beforeLocation.path.some(path=>path.startsWith('table_open:')));}
});

for (const [name,source,expectedPairs,expectedTables] of [
 ['whole paragraph','{~~The service starts slowly and uses old settings.~>The service boots quickly and loads new settings.~~}',1,0],
 ['phrase','A {~~small old phrase~>small new phrase~~} ends here.',1,0],
 ['whole table','{~~\n| A | B |\n| --- | --- |\n| old | keep |\n~>\n| A | B |\n| --- | --- |\n| new | keep |\n~~}',1,2],
 ['two phrases in one cell','| A | B |\n| --- | --- |\n| Prefix {~~first old~>first new~~} and {~~second old~>second new~~} suffix | keep |',2,1],
]) test(`${name}: complete proposal sides, exact scope and stacked presentation`,()=>{
 const d=dom(),doc=d.window.document,note=parseNote(source),group=reviewGroups(note)[0],units=reviewUnits(note,group);
 const render=value=>{const el=doc.createElement('div');el.innerHTML=markdown.render(value);return el;};
 const before=render(group.before),after=render(group.after);
 const ranges=(root,source,decision)=>{const c=prepareProjection(root,source,units,decision,'SCOPE');return c.text===source?c.blocks:captureProjection(root,render(c.text),c);};
 const result=assembleComparisons(before,after,units,ranges(before,group.before,'reject'),ranges(after,group.after,'accept'));
 assert.equal(result.element.querySelectorAll('.inline-diff-proposal').length,expectedPairs);
 assert.equal(result.element.querySelectorAll('table').length,expectedTables);
 for(const [index,pair] of [...result.element.querySelectorAll('.inline-diff-proposal')].entries()){
  assert.equal(pair.children.length,2);
  for(const [side,value] of [['before',units[index].proposal.before],['after',units[index].proposal.after]]){
   const body=pair.querySelector(`[data-inline-diff-side=${side}] > .inline-diff-side-content`);
   assert.equal(body.textContent.trim(),render(value).textContent.trim());
   assert.equal(body.parentElement.getAttribute('aria-label'),side==='before'?'Before':'After');
  }
 }
 if(name==='whole paragraph')assert.equal(result.element.querySelectorAll('.inline-diff-side-content > p').length,2);
 if(name==='phrase'){assert.equal(result.element.querySelector('p').firstChild.textContent,'A ');assert.equal(result.element.querySelector('p').lastChild.textContent,' ends here.');}
 for(const [side,expected]of[['before',group.before],['after',group.after]])assert.equal(canonical(projectRendered(result.element,side)),canonical(render(expected)));
 d.window.close();
});
