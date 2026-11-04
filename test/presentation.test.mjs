import assert from 'node:assert/strict';
import { test } from 'node:test';
import MarkdownIt from 'markdown-it';
import { dom, importHostModule } from './helpers.mjs';
import { canonical, projectRendered } from '../scripts/unified-oracle.mjs';
const {liveTables,adaptLiveTables}=await importHostModule('src/presentation.ts');
const markdown=new MarkdownIt({html:true});
const table='| A | B |\n| --- | --- |\n| one | two |';
for(const [name,source,count] of [['top-level',table,1],['quote','> '+table.replaceAll('\n','\n> '),0],['nested list','- Parent\n\n'+table.split('\n').map(s=>'  '+s).join('\n'),0],['HTML','<table><tr><td>Literal</td></tr></table>',0]])test(`${name} table keeps its native layout context`,()=>{
 const d=dom(),root=d.window.document.createElement('div');root.innerHTML=markdown.render(source);const original=root.cloneNode(true),tables=liveTables(root,source);assert.equal(tables.length,count);adaptLiveTables(tables);
 assert.equal(root.querySelectorAll('[data-inline-diff-layout=table]').length,count);
 if(count){assert.equal(root.querySelectorAll('.table-cell-wrapper').length,4);assert.equal(root.querySelector('.table-editor').parentElement.className,'table-wrapper');assert.equal(root.querySelector('input,button,[contenteditable],.table-row-drag-handle'),null);adaptLiveTables(tables);assert.equal(root.querySelectorAll('[data-inline-diff-layout=table]').length,1);}
 assert.equal(canonical(projectRendered(root,'before')),canonical(original));d.window.close();
});
