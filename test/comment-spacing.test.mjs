import assert from 'node:assert/strict';
import {test} from 'node:test';
import MarkdownIt from 'markdown-it';
import {commentSeparators,parseNote,reviewGroups,reviewUnits} from '../src/model.ts';
import {dom,importHostModule} from './helpers.mjs';
import {canonical,projectRendered} from '../scripts/unified-oracle.mjs';
const api=await importHostModule('src/unified.ts');
const markdown=new MarkdownIt({html:true});

for(const [name,source]of [
 ['escaped',String.raw`\%%a\%% \%%b\%%`],
 ['inline code','`x %%a%% %%b%%`'],
 ['fenced code','```md\nx %%a%% %%b%%\n```'],
 ['indented code','    x %%a%% %%b%%'],
 ['math','$x %%a%% %%b%%$'],
 ['HTML','<span>x %%a%% %%b%%</span>'],
 ['HTML comment','<!--x %%a%% %%b%%-->'],
 ['frontmatter',"---\nkey: 'x %%a%% %%b%%'\n---\n"],
 ['unclosed','x %%unclosed '],
 ['NBSP','%%a%%\u00a0%%b%%'],
 ['hard break','%%a%%  \n%%b%%'],
 ['CRLF hard break','%%a%%  \r\n%%b%%'],
])test(`${name} is not comment separator trivia`,()=>assert.deepEqual(commentSeparators(source),[]));

test('closed comments identify exact horizontal source runs',()=>{
 const s='text%%a%% \t %%b%%more';const ranges=commentSeparators(s);
 assert.equal(ranges.length,1);assert.equal(s.slice(ranges[0].from,ranges[0].to),' \t ');
 assert.deepEqual(commentSeparators('%%a%%\n  %%b%%'),[]);
});

const table=text=>'| A | B |\n| --- | --- |\n| '+text+' | keep |';
for(const [name,content,count]of [
 ['after','{~~old~>new~~}%%a%% %%b%%',1],
 ['before','%%a%% %%b%%{~~old~>new~~}',1],
 ['between','{~~old~>new~~}%%a%% %%b%%{~~one~>two~~}',1],
 ['tabs','{~~old~>new~~}%%a%%\t%%b%%',1],
 ['many comments','{~~old~>new~~}%%a%% %%b%% %%c%% %%d%%',3],
 ['Unicode','{~~古い👩🏽‍💻~>新しい👩🏽‍💻~~}%%a%% %%b%%',1],
 ['visible prefix','Prefix %%a%% %%b%%{~~old~>new~~}',0],
 ['visible suffix','{~~old~>new~~}%%a%% %%b%% Suffix',0],
 ['NBSP beside trivia','{~~old~>new~~}%%a%% \u00a0 %%b%%',0],
 ['inside proposal arms','{~~old%%a%% %%b%%~>new%%a%% %%b%%~~}',0],
])test(`${name}: neutralize only mapped empty boundary runs`,()=>{
 const d=dom(),doc=d.window.document,source=table(content),note=parseNote(source),group=reviewGroups(note)[0],units=reviewUnits(note,group);
 // Emulate the host's hidden-comment inline output while retaining its spaces.
 // Literal recognition is independently tested above and by the real host suite.
 const render=value=>{const root=doc.createElement('div');root.innerHTML=markdown.render(value);const walker=doc.createTreeWalker(root,4);let node;while((node=walker.nextNode()))if(!node.parentElement.closest('code,pre'))node.data=node.data.replace(/%%[^%]*%%/g,'');return root};
 const before=render(group.before),after=render(group.after);
 const capture=(root,text,decision)=>{const p=api.prepareProjection(root,text,units,decision,'SPACING');return p.text===text?p.blocks:api.captureProjection(root,render(p.text),p)};
 const result=api.assembleComparisons(before,after,units,capture(before,group.before,'reject'),capture(after,group.after,'accept'));
 assert.equal(result.element.querySelectorAll('.inline-diff-comment-trivia').length,count);
 assert.equal(result.element.querySelectorAll('.inline-diff-side-content .inline-diff-comment-trivia').length,0);
 for(const element of result.element.querySelectorAll('.inline-diff-comment-trivia')){assert.match(element.textContent,/^[ \t]+$/);assert.equal(element.getAttribute('aria-hidden'),'true');}
 for(const [side,expected]of [['before',group.before],['after',group.after]])assert.equal(canonical(projectRendered(result.element,side)),canonical(render(expected)),'complete native alternatives retain their original text');
 assert.equal(note.source,source);d.window.close();
});

for(const [name,source,count,breaks]of [
 ['paragraph','{~~old~>new~~}%%a%% %%b%%',1,0],
 ['list','- {~~old~>new~~}%%a%% %%b%%\n- Following',1,0],
 ['callout','> [!note] Context\n> {~~old~>new~~}%%a%% %%b%%\n>\n> Following',1,0],
 ['space hard break','{~~old~>new~~}%%a%%  \nFollowing',0,1],
 ['backslash hard break','{~~old~>new~~}%%a%% \\\nFollowing',0,1],
 ['line break','{~~old~>new~~}%%a%%\nFollowing',0,0],
])test(`${name}: preserve native structure and hard breaks`,()=>{
 const d=dom(),doc=d.window.document,note=parseNote(source),group=reviewGroups(note)[0],units=reviewUnits(note,group);
 const render=value=>{const root=doc.createElement('div');root.innerHTML=markdown.render(value);const walker=doc.createTreeWalker(root,4);let node;while((node=walker.nextNode()))if(!node.parentElement.closest('code,pre'))node.data=node.data.replace(/%%[^%]*%%/g,'');return root};
 const before=render(group.before),after=render(group.after);
 const capture=(root,text,decision)=>{const p=api.prepareProjection(root,text,units,decision,'BOUNDARY');return p.text===text?p.blocks:api.captureProjection(root,render(p.text),p)};
 const result=api.assembleComparisons(before,after,units,capture(before,group.before,'reject'),capture(after,group.after,'accept'));
 assert.equal(result.element.querySelectorAll('.inline-diff-comment-trivia').length,count);
 for(const [side,expected]of [['before',group.before],['after',group.after]]){
  const projection=projectRendered(result.element,side);
  assert.equal(canonical(projection),canonical(render(expected)));
  assert.equal(projection.querySelectorAll('br').length,breaks);
 }
 assert.equal(note.source,source);d.window.close();
});
