import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,createGame,makeLevels,addCashEntry,cashOut,poolOf,gameResults,rememberAction,undoAction,toggleClock} from '../static/engine.js';

function game(count=3,buyin=1000) {
  const config={...defaults(),mode:'cash',seats:count,buyin};
  return createGame(config,makeLevels(config),Array.from({length:count},(_,i)=>({id:String(i),nick:`Cash${i}`})),0);
}
test('cash deposits and payouts remain in the archived event log and balance',()=>{
  const g=game();
  addCashEntry(g,'0',500,10);
  cashOut(g,'1',0,20);cashOut(g,'0',2000,30);cashOut(g,'2',1500,40);
  assert.deepEqual(g.events.map(e=>e.type),['cashin','cashout','cashout','cashout','finish']);
  assert.deepEqual(g.events.slice(0,4).map(e=>e.amount),[500,0,2000,1500]);
  assert.equal(g.players[0].entries,2);assert.equal(g.finished,true);
  assert.equal(gameResults(g).rows.reduce((s,p)=>s+p.net,0),0);
  assert.equal(poolOf(g),3500);
});
test('invalid cash actions neither change money nor pollute undo history',()=>{
  const g=game();cashOut(g,'1',500,1);
  for(const action of [()=>cashOut(g,'0',2501),()=>cashOut(g,'1',0),()=>cashOut(g,'0',-1),()=>cashOut(g,'0',1.5),()=>addCashEntry(g,'1',100),()=>addCashEntry(g,'0',NaN),()=>addCashEntry(g,'0',10000001)]) {
    const before=structuredClone(g);assert.throws(action);assert.deepEqual(g,before);
  }
  cashOut(g,'0',0,2);
  assert.throws(()=>cashOut(g,'2',1000),/Последний игрок/);
});
test('cash undo restores an exit and its event without rewinding elapsed time',()=>{
  const g=game(),state={game:g};toggleClock(g,0);
  const before=structuredClone(g);cashOut(g,'0',1000,1000);rememberAction(state,before);
  undoAction(state,5000);
  assert.equal(state.game.players[0].active,true);assert.equal(state.game.players[0].cashout,null);
  assert.equal(state.game.events.length,0);assert.equal(state.game.elapsed,5000);
});
test('a valid large cash pot can be fully paid to the last player',()=>{
  const g=game(12,10000000);
  for(let i=0;i<11;i++)cashOut(g,String(i),0,i);
  cashOut(g,'11',120000000,12);
  assert.equal(g.finished,true);assert.equal(gameResults(g).rows.reduce((s,p)=>s+p.net,0),0);
});
