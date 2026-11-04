import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EditorState,StateEffect} from '@codemirror/state';
import {history,undoDepth} from '@codemirror/commands';
import {highlightSource,sourceHighlight} from '../src/source-highlight.ts';

test('Source outlines survive focus/configuration redraws without selection or history changes',()=>{
 let state=EditorState.create({doc:'A {~~old~>new~~} note.',selection:{anchor:1},extensions:[history(),sourceHighlight]});
 const before=state.selection.toJSON();state=state.update({effects:highlightSource.of({from:2,to:15})}).state;
 state=state.update({effects:StateEffect.reconfigure.of([history(),sourceHighlight])}).state;
 const marks=[];state.field(sourceHighlight).between(0,state.doc.length,(from,to,value)=>marks.push([from,to,value.spec.class]));
 assert.deepEqual(marks,[[2,15,'inline-diff-navigation-target']]);assert.deepEqual(state.selection.toJSON(),before);assert.equal(undoDepth(state),0);
 state=state.update({effects:highlightSource.of(null)}).state;assert.equal(state.field(sourceHighlight).size,0);assert.equal(undoDepth(state),0);
});
test('Source edits and invalid targets clear the temporary outline',()=>{
 let state=EditorState.create({doc:'old text',extensions:sourceHighlight});
 state=state.update({effects:highlightSource.of({from:0,to:3})}).state;assert.equal(state.field(sourceHighlight).size,1);
 state=state.update({changes:{from:0,to:3,insert:'new'}}).state;assert.equal(state.field(sourceHighlight).size,0);
 state=state.update({effects:highlightSource.of({from:0,to:999})}).state;assert.equal(state.field(sourceHighlight).size,0);
});
