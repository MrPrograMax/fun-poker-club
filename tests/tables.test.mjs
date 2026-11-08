import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,createGame,makeLevels,planTableBalance,rebalanceTables,gameTableNumbers,eliminate,addEntry,registerPlayer,registrationTables,normalizeGame,restoreAction,toggleClock,poolOf,bountyPoolOf,filterPlayers} from '../dist/engine.js';

function game(counts, capacity=10, overrides={}) {
  const config={...defaults(),...overrides,seats:counts.reduce((a,b)=>a+b,0),tableCapacity:capacity};
  const people=Array.from({length:config.seats},(_,i)=>({id:`p${i+1}`,name:'',nick:`P${i+1}`}));
  const g=createGame(config,makeLevels(config),people,0);
  let index=0;
  counts.forEach((count,t)=>{for(let seat=1;seat<=count;seat++)Object.assign(g.players[index++],{table:t+1,seat});});
  return g;
}
const financials=g=>g.players.map(({table,seat,lastTable,lastSeat,...player})=>player);
function validSeating(g) {
  const active=g.players.filter(p=>p.active);
  assert.equal(new Set(active.map(p=>`${p.table}:${p.seat}`)).size,active.length);
  assert.ok(active.every(p=>p.table>0&&p.seat>=1&&p.seat<=g.config.tableCapacity));
  assert.ok(g.players.filter(p=>!p.active).every(p=>p.table===null&&p.seat===null));
}

test('8/4/5 merges the second table into the third with only four moves',()=>{
  const g=game([8,4,5]), before=structuredClone(g), plan=planTableBalance(g);
  assert.deepEqual(g,before);assert.deepEqual(plan.tables,[{table:1,count:8},{table:3,count:9}]);
  assert.deepEqual(plan.closedTables,[2]);assert.equal(plan.moves.length,4);
  assert.ok(plan.moves.every(p=>p.fromTable===2&&p.table===3));
  rebalanceTables(g,0,plan);validSeating(g);
  assert.deepEqual(g.players.slice(0,8),before.players.slice(0,8));
  assert.deepEqual(financials(g),financials(before));assert.deepEqual(gameTableNumbers(g),[1,3]);
});
test('uneven tables balance without closing a table or reseating everyone',()=>{
  const g=game([8,4]), plan=planTableBalance(g);
  assert.deepEqual(plan.tables.map(t=>t.count),[6,6]);assert.equal(plan.moves.length,2);assert.deepEqual(plan.closedTables,[]);
  rebalanceTables(g,0);validSeating(g);assert.equal(planTableBalance(g).needsChange,false);
  const settled=structuredClone(g);assert.equal(rebalanceTables(g,1000),null);assert.deepEqual(g,settled);
});
test('only survivors reach the final table; money, ranks and the running clock stay intact',()=>{
  const g=game([5,5]);eliminate(g,'p6',1);eliminate(g,'p7',2);addEntry(g,'p1','addon',3);toggleClock(g,1000);
  const before=structuredClone(g), plan=planTableBalance(g);
  assert.equal(plan.final,true);assert.equal(plan.assignments.length,8);
  assert.ok(plan.assignments.every(p=>!['p6','p7'].includes(p.playerId)));
  rebalanceTables(g,11000,plan);validSeating(g);
  assert.deepEqual(financials(g),financials(before));assert.equal(poolOf(g),poolOf(before));assert.equal(bountyPoolOf(g),bountyPoolOf(before));
  assert.equal(g.deadline,before.deadline);assert.equal(g.remaining,1190);assert.equal(g.running,true);
  assert.deepEqual(g.levels,before.levels);assert.deepEqual(g.eliminationOrder,before.eliminationOrder);
  assert.deepEqual(filterPlayers(g.players,{table:1}).map(p=>p.id),g.players.filter(p=>p.active).map(p=>p.id));
  assert.deepEqual(filterPlayers(g.players,{table:-1}).map(p=>p.id),['p6','p7']);
  const reloaded=normalizeGame(JSON.parse(JSON.stringify(g)));assert.deepEqual(reloaded,g);
  const restored=restoreAction(reloaded,before,26000);
  assert.deepEqual(restored.players,before.players);assert.deepEqual(restored.events,before.events);assert.equal(restored.seatingManaged,undefined);
  assert.equal(restored.remaining,1175);assert.equal(restored.deadline,before.deadline);
});
test('reentry and late registration after merging use current free seats and can open another table',()=>{
  const g=game([5,5]);eliminate(g,'p6',1);eliminate(g,'p7',2);rebalanceTables(g,3);
  addEntry(g,'p6','reentry',4);
  assert.deepEqual([g.players[5].table,g.players[5].seat],[1,9]);
  const late=registerPlayer(g,{id:'late',nick:'Late'},null,5);
  assert.deepEqual([late.table,late.seat],[1,10]);
  addEntry(g,'p7','reentry',6);assert.deepEqual([g.players[6].table,g.players[6].seat],[2,1]);
  assert.deepEqual(gameTableNumbers(g),[1,2]);validSeating(g);
  assert.deepEqual(planTableBalance(g).tables.map(t=>t.count),[6,5]);
  eliminate(g,'p1',7);assert.equal(g.players[0].table,null);
  assert.ok(registrationTables(g).find(t=>t.table===1).seats.includes(1));
  assert.equal(g.players.reduce((sum,p)=>sum+p.invested,0),poolOf(g)+bountyPoolOf(g));
});
test('a table roster retains eliminated players for reentry after managed seating frees their seats',()=>{
  const g=game([3,3],6);
  eliminate(g,'p6',1);rebalanceTables(g,2);
  const before=structuredClone(g);
  eliminate(g,'p1',3);
  const out=g.players.find(p=>p.id==='p1');
  assert.equal(out.table,null);assert.equal(out.lastTable,1);
  assert.ok(filterPlayers(g.players,{table:1,includeLastTable:true}).some(p=>p.id==='p1'));
  assert.deepEqual(filterPlayers(g.players,{table:1,query:'P1',includeLastTable:true}).map(p=>p.id),['p1']);
  assert.ok(!filterPlayers(g.players,{table:1,activeOnly:true,includeLastTable:true}).some(p=>p.id==='p1'));
  assert.ok(!filterPlayers(g.players,{table:1}).some(p=>p.id==='p1'));
  assert.deepEqual(filterPlayers(g.players,{table:-1,includeLastTable:true}).map(p=>p.id),['p1','p6']);
  assert.equal(g.players.find(p=>p.id==='p6').lastTable,2);
  const loaded=normalizeGame(JSON.parse(JSON.stringify(g)));
  assert.ok(filterPlayers(loaded.players,{table:1,includeLastTable:true}).some(p=>p.id==='p1'));
  addEntry(loaded,'p1','reentry',4);
  assert.equal(filterPlayers(loaded.players,{table:1,includeLastTable:true}).filter(p=>p.id==='p1').length,1);
  assert.ok(!filterPlayers(loaded.players,{table:-1}).some(p=>p.id==='p1'));
  const restored=restoreAction(g,before,5);
  assert.equal(filterPlayers(restored.players,{table:1,includeLastTable:true}).filter(p=>p.id==='p1').length,1);
  assert.equal(restored.players.find(p=>p.id==='p1').active,true);
});
test('active players never match their previous table after returning at a different table',()=>{
  const players=[{id:'back',name:'',nick:'Back',active:true,table:3,lastTable:1},{id:'out',name:'',nick:'Out',active:false,table:null,lastTable:1}];
  assert.deepEqual(filterPlayers(players,{table:1,includeLastTable:true}).map(p=>p.id),['out']);
  assert.deepEqual(filterPlayers(players,{table:3,includeLastTable:true}).map(p=>p.id),['back']);
  assert.deepEqual(filterPlayers(players,{table:1,includeLastTable:true,excludeId:'out'}),[]);
});
test('a stale preview and unavailable game states cannot mutate seating or the timer',()=>{
  const g=game([8,4,5]);toggleClock(g,0);const plan=planTableBalance(g);eliminate(g,'p1',1);
  const before=structuredClone(g);assert.throws(()=>rebalanceTables(g,10000,plan),/изменился/);assert.deepEqual(g,before);
  for(const patch of [{finished:true},{config:{...g.config,mode:'cash'}}]) {
    const unavailable={...structuredClone(g),...patch}, snapshot=structuredClone(unavailable);
    assert.throws(()=>rebalanceTables(unavailable,10000));assert.deepEqual(unavailable,snapshot);
  }
});
test('progressive bounties and reentry still balance after opponents join the same table',()=>{
  const g=game([3,3],4,{bountyMode:'progressive'});
  eliminate(g,'p3',1,'p1');eliminate(g,'p6',2,'p4');rebalanceTables(g,3);
  const before=structuredClone(g);
  eliminate(g,'p4',4,'p1');assert.equal(g.players[0].knockouts,2);assert.equal(g.players[0].earnedBounty,250);
  assert.equal(g.players[3].table,null);
  const undone=restoreAction(normalizeGame(JSON.parse(JSON.stringify(g))),before,5);
  assert.deepEqual(undone.players,before.players);validSeating(undone);
  addEntry(g,'p4','reentry',6);validSeating(g);assert.equal(g.players[3].bounty,200);
  assert.equal(g.players.reduce((sum,p)=>sum+p.invested,0),poolOf(g)+bountyPoolOf(g));
  assert.equal(bountyPoolOf(g),g.players.reduce((sum,p)=>sum+p.bounty+p.earnedBounty,0));
});
test('balancing across capacities keeps everyone once and leaves table sizes within one player',()=>{
  for(let capacity=2;capacity<=10;capacity++)for(let tables=2;tables<=7;tables++) {
    const counts=Array.from({length:tables},(_,i)=>1+(i*3+tables)%capacity), g=game(counts,capacity), plan=planTableBalance(g);
    assert.equal(plan.tables.length,Math.ceil(g.players.length/capacity));
    assert.equal(new Set(plan.assignments.map(p=>p.playerId)).size,g.players.length);
    assert.ok(Math.max(...plan.tables.map(t=>t.count))-Math.min(...plan.tables.map(t=>t.count))<=1);
    assert.ok(plan.tables.every(t=>t.count<=capacity));
    if(plan.needsChange){rebalanceTables(g,0);validSeating(g);}
  }
});
