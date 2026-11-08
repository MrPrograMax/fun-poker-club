import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,makeLevels,createGame,eliminate,addEntry,toggleClock,poolOf,bountyPoolOf,extendLevel,actionHistory,rememberAction,undoAction,clearActionHistory,MAX_UNDO_STEPS} from '../dist/engine.js';

function setup(count=4) {
  const config={...defaults(),seats:count,bountyMode:'fixed'};
  const seats=Array.from({length:count},(_,i)=>({id:`p${i}`,name:'',nick:`Player ${i}`}));
  return {version:1,config,seats,library:[],step:'board',game:createGame(config,makeLevels(config),seats,0)};
}
test('multiple undo steps survive reload and restore money, reentries and knockouts without rolling back time',()=>{
  let state=setup();toggleClock(state.game,0);
  const baseline=structuredClone(state.game);
  rememberAction(state);eliminate(state.game,'p1',1000,'p0');
  const knockedOut=structuredClone(state.game);
  rememberAction(state);addEntry(state.game,'p1','reentry',2000);
  const returned=structuredClone(state.game);
  rememberAction(state);addEntry(state.game,'p2','addon',3000);
  state=JSON.parse(JSON.stringify(state));
  for (const [expected,now,left] of [[returned,10000,2],[knockedOut,20000,1],[baseline,30000,0]]) {
    assert.equal(undoAction(state,now),true);
    assert.deepEqual(state.game.players,expected.players);
    assert.deepEqual(state.game.events,expected.events);
    assert.equal(actionHistory(state).length,left);
    assert.equal(state.game.remaining,1200-now/1000);
    assert.equal(state.game.deadline,1200000);
    assert.equal(poolOf(state.game)+bountyPoolOf(state.game),state.game.players.reduce((sum,p)=>sum+p.invested,0));
  }
  assert.equal(undoAction(state,40000),false);
});
test('legacy single-action saves migrate without losing the existing undo or duplicating it on reload',()=>{
  let state=setup();state.undo=structuredClone(state.game);state.undoKind='operation';
  addEntry(state.game,'p0','addon',1);
  assert.equal(actionHistory(state).length,1);assert.equal(state.undo,undefined);
  state=JSON.parse(JSON.stringify(state));assert.equal(actionHistory(state).length,1);
  rememberAction(state);addEntry(state.game,'p1','addon',2);
  assert.equal(undoAction(state,3),true);assert.equal(state.game.players[1].addons,0);
  assert.equal(undoAction(state,4),true);assert.equal(state.game.players[0].addons,0);
});
test('clock edits and new actions after undo keep the remaining older history',()=>{
  const state=setup();toggleClock(state.game,0);
  rememberAction(state);addEntry(state.game,'p0','addon',1000);
  rememberAction(state,state.game,'clock');extendLevel(state.game,5,2000);
  rememberAction(state);eliminate(state.game,'p1',3000,'p0');
  undoAction(state,10000);assert.equal(state.game.remaining,1490);
  undoAction(state,20000);assert.equal(state.game.remaining,1180);
  rememberAction(state);addEntry(state.game,'p2','addon',21000);
  assert.equal(actionHistory(state).length,2);
  undoAction(state,22000);undoAction(state,23000);
  assert.equal(state.game.players.every(p=>p.addons===0),true);
  assert.equal(state.game.remaining,1177);
});
test('history fits the persistence limit and a new game clears all undo points',()=>{
  const state=setup(200);
  state.library=Array.from({length:200},(_,i)=>({id:`library-${i}`,name:'Я'.repeat(60),nick:'Н'.repeat(24)}));
  for(let i=0;i<70;i++){rememberAction(state);addEntry(state.game,'p0','addon',i);}
  assert.ok(actionHistory(state).length>1);
  assert.ok(actionHistory(state).length<=MAX_UNDO_STEPS);
  assert.ok(new TextEncoder().encode(JSON.stringify({revision:123456789,state})).byteLength<1024*1024);
  clearActionHistory(state);assert.equal(actionHistory(state).length,0);assert.equal(undoAction(state),false);
});
