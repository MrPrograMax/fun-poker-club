import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, MAX_PLAYERS, createGame, makeLevels, registerPlayer, registrationTables, poolOf, bountyPoolOf, payouts, eliminate, addEntry, toggleClock, advanceClock, startFreezeout, restoreAction, normalizeGame } from '../dist/engine.js';

function game(overrides={}, count=3) {
  const config={...defaults(),seats:count,...overrides};
  const players=Array.from({length:count},(_,i)=>({id:String(i+1),name:`Игрок ${i+1}`,nick:''}));
  return createGame(config,makeLevels(config),players,0);
}
const newcomer=()=>({id:'late',name:'Новый игрок',nick:'Late'});
function balanced(g) {
  assert.equal(g.players.reduce((sum,p)=>sum+p.invested,0),poolOf(g)+bountyPoolOf(g));
  assert.equal(bountyPoolOf(g),g.players.reduce((sum,p)=>sum+p.bounty+p.earnedBounty,0));
}

for(const mode of ['off','fixed','progressive']) test(`late first entry applies ${mode} bounty and preserves existing funds`,()=>{
  const g=game({bountyMode:mode});
  eliminate(g,'3',100,'1');
  const existing=g.players.map(p=>({id:p.id,earned:p.earnedBounty,bounty:p.bounty,table:p.table,seat:p.seat}));
  const before=poolOf(g), heads=bountyPoolOf(g), reward=mode==='off'?0:200;
  const p=registerPlayer(g,newcomer(),null,200);
  assert.equal(poolOf(g),before+1000-reward);assert.equal(bountyPoolOf(g),heads+reward);
  assert.equal(p.bounty,reward);assert.equal(p.entries,1);assert.equal(p.reentries,0);assert.equal(p.addons,0);assert.equal(p.active,true);
  assert.equal(g.players[2].place,4);assert.equal(g.config.seats,4);
  assert.deepEqual(g.players.slice(0,3).map(p=>({id:p.id,earned:p.earnedBounty,bounty:p.bounty,table:p.table,seat:p.seat})),existing);
  assert.equal(payouts(poolOf(g),g.config.prizes).reduce((sum,n)=>sum+n,0),poolOf(g));
  assert.deepEqual(g.events.at(-1),{type:'registration',playerId:'late',amount:1000,bounty:reward,chips:10000,table:1,seat:4,at:200});
  balanced(g);
});

test('registration stays available after freezeout even with reentry disabled',()=>{
  const g=game({reentry:false,bountyMode:'progressive'});
  startFreezeout(g,1000,{addonCost:1500,addonStack:20000});
  const schedule=structuredClone(g.levels), deadline=g.deadline, phase=structuredClone(g.freezeout);
  const p=registerPlayer(g,newcomer(),null,2000);
  assert.equal(p.invested,1000);assert.equal(g.remaining,1199);assert.equal(g.elapsed,1000);
  assert.equal(g.deadline,deadline);assert.equal(g.running,true);assert.deepEqual(g.freezeout,phase);assert.deepEqual(g.levels,schedule);
  addEntry(g,p.id,'addon',3000);assert.equal(poolOf(g),4700);balanced(g);
});

test('registration advances across a level boundary without resetting the running clock',()=>{
  const g=game();toggleClock(g,0);const schedule=structuredClone(g.levels);
  registerPlayer(g,newcomer(),null,1201000);
  assert.equal(g.index,1);assert.equal(g.remaining,1199);assert.equal(g.elapsed,1201000);assert.equal(g.deadline,2400000);
  assert.equal(g.running,true);assert.deepEqual(g.levels,schedule);
});

test('registration preserves a pause and remains available after the schedule ends',()=>{
  const g=game();registerPlayer(g,newcomer(),null,40000);
  assert.equal(g.running,false);assert.equal(g.remaining,1200);assert.equal(g.elapsed,0);
  toggleClock(g,40000);advanceClock(g,1000000000);
  registerPlayer(g,{id:'later',name:'Ещё один'},null,1000000001);
  assert.equal(g.structureEnded,true);assert.equal(g.running,false);assert.equal(g.remaining,0);
});

test('newcomer gets the least occupied existing table without reseating anyone',()=>{
  const g=game({},15), before=g.players.map(p=>[p.table,p.seat]);
  const p=registerPlayer(g,newcomer(),null,1);
  assert.deepEqual([p.table,p.seat],[2,8]);assert.deepEqual(g.players.slice(0,15).map(p=>[p.table,p.seat]),before);
  const another=registerPlayer(g,{id:'another',name:'Другой'}, {table:1,seat:10},2);
  assert.deepEqual([another.table,another.seat],[1,10]);
});

test('full tables create one more table and eliminated seats stay reserved for reentry',()=>{
  const g=game({tableCapacity:2},4);eliminate(g,'1',1);
  assert.equal(registrationTables(g).filter(t=>!t.isNew).flatMap(t=>t.seats).length,0);
  const before=structuredClone(g);
  assert.throws(()=>registerPlayer(g,newcomer(),{table:1,seat:1},2),/свободное место/);assert.deepEqual(g,before);
  const p=registerPlayer(g,newcomer(),null,3);assert.deepEqual([p.table,p.seat],[3,1]);
  addEntry(g,'1','reentry',4);assert.deepEqual([g.players[0].table,g.players[0].seat],[1,1]);
  assert.equal(new Set(g.players.map(p=>`${p.table}:${p.seat}`)).size,g.players.length);
});

test('invalid or duplicate registrations do not change game, history or clock',()=>{
  const g=game();toggleClock(g,0);eliminate(g,'2',10);
  const before=structuredClone(g);
  for(const profile of [{id:'1',name:'Иное имя'},{id:'new',name:'  ИГРОК   2  '},{id:'new',name:''},{id:'new',name:'x'.repeat(61)},{id:'new',name:'Имя',nick:'x'.repeat(25)},{name:'Без id'}]) {
    assert.throws(()=>registerPlayer(g,profile,null,1000));assert.deepEqual(g,before);
  }
  for(const placement of [{table:1,seat:1},{table:0,seat:4},{table:99,seat:1},{table:1,seat:11},{table:1,seat:1.5}]) {
    assert.throws(()=>registerPlayer(g,newcomer(),placement,1000));assert.deepEqual(g,before);
  }
});

test('registration supports the last allowed player and rejects completed games',()=>{
  const g=game({},MAX_PLAYERS-1);registerPlayer(g,newcomer(),null,1);const before=structuredClone(g);
  assert.throws(()=>registerPlayer(g,{id:'too-many',name:'Лишний'},null,2),/200/);assert.deepEqual(g,before);
  const finished=game();eliminate(finished,'2',1);eliminate(finished,'3',2);const settled=structuredClone(finished);
  assert.throws(()=>registerPlayer(finished,newcomer(),null,3),/завершена/);assert.deepEqual(finished,settled);
});

test('undo after reload removes the new player and restores funds, places and capacity without rewinding the clock',()=>{
  const g=game({bountyMode:'progressive'});eliminate(g,'3',1,'1');startFreezeout(g,1000);
  const before=structuredClone(g);registerPlayer(g,newcomer(),null,2000);
  const reloaded=normalizeGame(JSON.parse(JSON.stringify(g)));
  assert.equal(reloaded.players.at(-1).name,'Новый игрок');assert.equal(reloaded.events.at(-1).type,'registration');
  const restored=restoreAction(reloaded,JSON.parse(JSON.stringify(before)),1300000);
  assert.deepEqual(restored.players,before.players);assert.deepEqual(restored.events,before.events);assert.deepEqual(restored.config,before.config);
  assert.equal(restored.running,true);assert.equal(restored.index,1);assert.equal(restored.deadline,2401000);assert.equal(restored.elapsed,1299000);
  assert.deepEqual(restored.freezeout,before.freezeout);balanced(restored);
});

test('cash first entry adds the whole payment to the bank without bounty or timer reset',()=>{
  const g=game({mode:'cash',bountyMode:'progressive'});toggleClock(g,0);
  const p=registerPlayer(g,newcomer(),null,5000);
  assert.equal(poolOf(g),4000);assert.equal(p.bounty,0);assert.equal(bountyPoolOf(g),0);assert.equal(g.elapsed,5000);assert.equal(g.running,true);
});
