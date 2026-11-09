import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, seatingPlan, seatPlayers, normalizeGame, makeLevels, recommendStructure, payouts, validateConfig, createGame, advanceClock, toggleClock, jumpLevel, startFreezeout, restoreAction, eliminate, addEntry, poolOf, bountyPoolOf, formatTime } from '../static/engine.js';

const players = [{ id:'1', name:'Alex' },{ id:'2',name:'Anna' },{ id:'3',name:'Max' }];
function game(config={}) { const c={...defaults(),...config};return createGame(c,makeLevels(c),players,0); }
test('default structure includes twelve levels and two breaks',()=>{
  const levels=makeLevels(defaults());assert.equal(levels.length,14);assert.equal(levels[4].kind,'break');assert.equal(levels[5].number,5);assert.equal(levels[9].kind,'break');
});
test('prizes conserve odd pools and apply largest remainders',()=>{
  assert.deepEqual(payouts(1001,[50,30,20]),[501,300,200]);assert.deepEqual(payouts(5,[50,30,20]),[3,1,1]);
  for(let n=1;n<1000;n++)assert.equal(payouts(n,[45,25,20,10]).reduce((a,b)=>a+b,0),n);
});
test('validation rejects inconsistent blinds, percentages and seats',()=>{
  assert.equal(validateConfig(defaults()),'');
  for(const change of [{sb:50},{prizes:[50,20,20]},{seats:1},{prizes:[100,0]},{duration:0},{seats:2},{buyin:0}]) assert.notEqual(validateConfig({...defaults(),...change}),'');
});
test('cash mode ignores tournament payout slots and keeps fixed blinds',()=>{
  const c={...defaults(),mode:'cash',seats:2};assert.equal(validateConfig(c),'');const g=game(c);toggleClock(g,0);advanceClock(g,7200000);assert.equal(g.index,0);assert.equal(g.elapsed,7200000);assert.equal(g.running,true);
});
test('pause does not count paused time and resume keeps exact remainder',()=>{
  const g=game();toggleClock(g,1000);advanceClock(g,61000);assert.equal(g.remaining,1140);toggleClock(g,61000);advanceClock(g,500000);assert.equal(g.remaining,1140);toggleClock(g,600000);advanceClock(g,630000);assert.equal(g.remaining,1110);assert.equal(g.elapsed,90000);
});
test('reload and throttled tabs advance through multiple deadlines and a break',()=>{
  const g=game();toggleClock(g,0);const restored=JSON.parse(JSON.stringify(g));advanceClock(restored,95*60000);assert.equal(restored.index,5);assert.equal(restored.levels[restored.index].number,5);assert.equal(restored.remaining,15*60);
});
test('exact boundary moves to next level with full duration',()=>{
  const g=game();toggleClock(g,0);advanceClock(g,20*60000);assert.equal(g.index,1);assert.equal(g.remaining,1200);
});
test('structure end stops clock without eliminating players or awarding a winner',()=>{
  const g=game();toggleClock(g,0);advanceClock(g,24*3600000);assert.equal(g.structureEnded,true);assert.equal(g.finished,false);assert.equal(g.running,false);assert.equal(g.remaining,0);assert.equal(g.players.filter(p=>p.active).length,3);
});
test('manual level switch resets duration but preserves paused state',()=>{
  const g=game();jumpLevel(g,2,100);assert.equal(g.index,2);assert.equal(g.remaining,1200);assert.equal(g.running,false);jumpLevel(g,-1);assert.equal(g.index,2);
});
test('elimination assigns places and stops timer when winner remains',()=>{
  const g=game();toggleClock(g,0);eliminate(g,'2',100);assert.equal(g.players[1].place,3);eliminate(g,'2',200);assert.equal(g.players[1].place,3);eliminate(g,'1',300);assert.equal(g.players[0].place,2);assert.equal(g.players[2].place,1);assert.equal(g.finished,true);assert.equal(g.running,false);
});
test('tournaments reject rebuy operations and reentry for active players without changing funds',()=>{
  const g=game(),before=structuredClone(g);
  assert.throws(()=>addEntry(g,'2','rebuy'));assert.throws(()=>addEntry(g,'2','reentry'));
  assert.deepEqual(g,before);
});
test('timer formatting is never negative and supports hours',()=>{
  assert.equal(formatTime(-1),'00:00');assert.equal(formatTime(59.1),'01:00');assert.equal(formatTime(3601),'01:00:01');
});

function assertBankBalances(g) {
  const contributed=g.players.reduce((s,p)=>s+p.invested,0);
  const outstanding=g.players.reduce((s,p)=>s+p.bounty,0);
  const earned=g.players.reduce((s,p)=>s+p.earnedBounty,0);
  assert.equal(poolOf(g)+bountyPoolOf(g),contributed);
  assert.equal(outstanding+earned,bountyPoolOf(g));
}
test('fixed bounty pays killer and winner receives their own head',()=>{
  const g=game({bountyMode:'fixed'});assert.equal(poolOf(g),2400);assert.equal(bountyPoolOf(g),600);
  eliminate(g,'2',10,'1');assert.equal(g.players[0].earnedBounty,200);assert.equal(g.players[0].knockouts,1);assertBankBalances(g);
  eliminate(g,'3',20,'1');assert.equal(g.players[0].earnedBounty,600);assert.equal(g.players[0].bounty,0);assertBankBalances(g);
});
test('progressive bounty splits cash and head, including chained eliminations',()=>{
  const g=game({bountyMode:'progressive'});
  eliminate(g,'2',10,'1');assert.equal(g.players[0].earnedBounty,100);assert.equal(g.players[0].bounty,300);assertBankBalances(g);
  eliminate(g,'1',20,'3');assert.equal(g.players[2].earnedBounty,500);assert.equal(g.players[0].earnedBounty,100);assertBankBalances(g);
});
test('re-entry reserves a new bounty from the same payment, addon goes entirely to prizes',()=>{
  const g=game({bountyMode:'progressive'});eliminate(g,'2',10,'1');addEntry(g,'2','reentry',20);
  assert.equal(g.players[1].invested,2000);assert.equal(g.players[1].bounty,200);assert.equal(g.players[1].reentries,1);assert.equal(poolOf(g),3200);assert.equal(bountyPoolOf(g),800);assertBankBalances(g);
  addEntry(g,'2','addon',30);assert.equal(poolOf(g),3700);assert.equal(bountyPoolOf(g),800);assert.equal(g.players[1].addons,1);assertBankBalances(g);
  addEntry(g,'1','addon',40);assert.equal(poolOf(g),4200);assert.equal(g.players[0].bounty,300);assertBankBalances(g);
});
test('reopening a finished tournament reverses only the winner own-head award',()=>{
  const g=game({bountyMode:'progressive'});eliminate(g,'2',10,'1');eliminate(g,'3',20,'1');assert.equal(g.players[0].earnedBounty,600);
  addEntry(g,'2','reentry',30);assert.equal(g.finished,false);assert.equal(g.running,false);assert.equal(g.players[0].place,null);assert.equal(g.players[0].bounty,400);assert.equal(g.players[0].earnedBounty,200);assert.equal(g.players[2].place,3);assertBankBalances(g);
});
test('odd bounty amounts remain conserved with configurable PKO split',()=>{
  const g=game({bountyMode:'progressive',bountyAmount:201,bountyImmediate:33});eliminate(g,'2',10,'1');assert.equal(g.players[0].earnedBounty,66);assert.equal(g.players[0].bounty,336);assertBankBalances(g);
});
test('bounty needs a distinct live killer and re-entry only allows eliminated players',()=>{
  const g=game({bountyMode:'fixed'});assert.throws(()=>eliminate(g,'2',10,'2'));assert.throws(()=>eliminate(g,'2',10,null));assert.throws(()=>addEntry(g,'2','reentry'));assertBankBalances(g);
});

test('large groups are balanced across tables without exceeding capacity',()=>{
  assert.deepEqual(seatingPlan(12,10),[6,6]);
  assert.deepEqual(seatingPlan(15,10),[8,7]);
  assert.deepEqual(seatingPlan(25,8),[7,6,6,6]);
  for(let count=2;count<=200;count++) {
    for(let capacity=2;capacity<=10;capacity++) {
      const plan=seatingPlan(count,capacity);
      assert.equal(plan.reduce((a,b)=>a+b,0),count);
      assert.ok(Math.max(...plan)<=capacity);
      assert.ok(Math.max(...plan)-Math.min(...plan)<=1);
    }
  }
});
test('each player gets exactly one table and seat, preserving the shuffled input order',()=>{
  const people=Array.from({length:15},(_,i)=>({id:String(15-i),name:`Player ${i}`}));
  const seated=seatPlayers(people,10);
  assert.deepEqual(seated.map(p=>p.id),people.map(p=>p.id));
  assert.equal(new Set(seated.map(p=>`${p.table}/${p.seat}`)).size,15);
  assert.deepEqual(seated[8],{...people[8],table:2,seat:1});
  assert.equal(people[0].table,undefined);
});
test('multiple tables share prizes and preserve seating across knockouts and re-entries',()=>{
  const c={...defaults(),seats:15,bountyMode:'progressive'};
  const people=Array.from({length:15},(_,i)=>({id:String(i),name:`Player ${i}`}));
  const g=createGame(c,makeLevels(c),people,0);
  assert.equal(poolOf(g),12000);assert.equal(bountyPoolOf(g),3000);
  assert.equal(new Set(g.players.map(p=>p.table)).size,2);
  const positions=g.players.map(p=>[p.table,p.seat]);
  eliminate(g,'9',10,'8');addEntry(g,'9','reentry',20);
  assert.deepEqual(g.players.map(p=>[p.table,p.seat]),positions);
  assertBankBalances(g);
});
test('old saved games gain table numbers without changing financial results or clock',()=>{
  const g=game();delete g.config.tableCapacity;
  g.players.forEach(p=>delete p.table);
  const before={pool:poolOf(g),remaining:g.remaining,players:g.players.map(p=>p.id)};
  normalizeGame(g);
  assert.deepEqual(g.players.map(p=>p.table),[1,1,1]);
  assert.deepEqual({pool:poolOf(g),remaining:g.remaining,players:g.players.map(p=>p.id)},before);
});
test('rejects out-of-range groups without trying to allocate seats',()=>{
  for(const seats of [-1,0,1,201,Infinity,NaN,2.5]) {
    assert.notEqual(validateConfig({...defaults(),seats}),'');
    assert.deepEqual(seatingPlan(seats),[]);
  }
  assert.equal(validateConfig({...defaults(),seats:200}),'');
  assert.notEqual(validateConfig({...defaults(),tableCapacity:11}),'');
});

test('smart structure fills the requested time including breaks and preserves opening blinds',()=>{
  const c=defaults(), plan=recommendStructure(c,{targetMinutes:240});
  assert.equal(plan.levels.reduce((sum,l)=>sum+l.duration,0),240*60);
  assert.equal(plan.playingMinutes+plan.breakMinutes,240);
  assert.equal(plan.chips,60000);
  assert.equal(plan.finalBB,3000);
  assert.equal(plan.levels[0].sb,c.sb);
  assert.equal(plan.levels[0].bb,c.bb);
  assert.equal(plan.levels.at(-1).kind,'level');
  const playing=plan.levels.filter(l=>l.kind==='level');
  assert.ok(playing.every((l,i)=>l.number===i+1 && (i===0 || l.bb>playing[i-1].bb)));
});
test('smart structure accounts for planned entries, addons and BB ante',()=>{
  const c={...defaults(),ante:true};
  const base=recommendStructure(c), withExtras=recommendStructure(c,{extraEntries:6,addons:6});
  assert.equal(withExtras.chips,150000);
  assert.ok(withExtras.finalBB>base.finalBB);
  assert.ok(withExtras.levels.filter(l=>l.kind==='level').every(l=>l.ante===l.bb));
});
test('smart structure supports short, long and multitable evenings without trailing breaks',()=>{
  for(const seats of [2,6,15,50,200]) for(const targetMinutes of [30,120,240,480,720]) for(const breakEvery of [0,3,4,6]) {
    const c={...defaults(),seats,breakEvery};
    const plan=recommendStructure(c,{targetMinutes});
    assert.equal(plan.levels.reduce((sum,l)=>sum+l.duration,0),targetMinutes*60);
    const playing=plan.levels.filter(l=>l.kind==='level');
    assert.equal(plan.levels.filter(l=>l.kind==='break').length,breakEvery?Math.floor((playing.length-1)/breakEvery):0);
    assert.equal(plan.levels.at(-1).kind,'level');
    assert.ok(playing.every((l,i)=>Number.isInteger(l.sb)&&l.sb>=1&&l.sb<l.bb&&l.duration>=60&&l.duration<=10800&&(i===0||l.bb>playing[i-1].bb)));
    assert.ok(plan.finalBB>=plan.chips/20);
  }
});
test('smart structure rounds later blinds to opening chip units',()=>{
  for(const [sb,bb] of [[25,50],[100,200],[10,25],[3,7]]) {
    const plan=recommendStructure({...defaults(),sb,bb});
    assert.equal(plan.levels[0].sb,sb);assert.equal(plan.levels[0].bb,bb);
    assert.ok(plan.levels.filter(l=>l.kind==='level').every(l=>Number.isInteger(l.sb)&&Number.isInteger(l.bb)));
  }
});
test('smart structure rejects invalid and infeasible inputs',()=>{
  for(const options of [{targetMinutes:0},{targetMinutes:1441},{targetMinutes:NaN},{extraEntries:-1},{extraEntries:1.5},{addons:Infinity}]) assert.throws(()=>recommendStructure(defaults(),options));
  for(const config of [{stack:0},{seats:201},{bb:25},{duration:0},{breakEvery:-1}]) assert.throws(()=>recommendStructure({...defaults(),...config}));
  assert.throws(()=>recommendStructure({...defaults(),stack:1,sb:25,bb:50},{targetMinutes:1440}));
});

test('undo restores contributions and history without rewinding the timer or level',()=>{
  const g=game();toggleClock(g,0);
  const snapshot=structuredClone(g);
  addEntry(g,'1','addon',1000);
  jumpLevel(g,2,2000);
  const restored=restoreAction(g,JSON.parse(JSON.stringify(snapshot)),5000);
  assert.equal(poolOf(restored),3000);
  assert.equal(restored.players[0].addons,0);
  assert.equal(restored.events.length,0);
  assert.equal(restored.index,2);
  assert.equal(restored.remaining,1197);
  assert.equal(restored.elapsed,5000);
  assert.equal(restored.running,true);
  assert.equal(restored.deadline,g.deadline);
});
test('undoing a final knockout restores heads and players and leaves the clock paused',()=>{
  const g=game({bountyMode:'progressive'});
  eliminate(g,'3',0,'1');toggleClock(g,0);
  const snapshot=structuredClone(g);
  eliminate(g,'2',1000,'1');
  const restored=restoreAction(g,snapshot,5000);
  assert.equal(restored.finished,false);
  assert.equal(restored.running,false);
  assert.equal(restored.elapsed,1000);
  assert.deepEqual(restored.players,snapshot.players);
  assert.deepEqual(restored.winnerBounty,snapshot.winnerBounty);
});
test('undoing reentry returns a reopened tournament to its settled result',()=>{
  const g=game({bountyMode:'fixed'});
  eliminate(g,'3',0,'1');eliminate(g,'2',0,'1');
  const snapshot=structuredClone(g);
  addEntry(g,'2','reentry',1000);toggleClock(g,1000);
  const restored=restoreAction(g,snapshot,3000);
  assert.equal(restored.finished,true);
  assert.equal(restored.running,false);
  assert.equal(restored.deadline,null);
  assert.deepEqual(restored.players,snapshot.players);
  assert.deepEqual(restored.events,snapshot.events);
});

test('addons have no quantity limit and each contributes fully to prizes',()=>{
  const g=game({bountyMode:'fixed',addonLimit:1});
  for(let i=0;i<8;i++)addEntry(g,'1','addon',i);
  assert.equal(g.players[0].addons,8);assert.equal(poolOf(g),6400);
  assert.equal(g.players[0].bounty,200);assertBankBalances(g);
  const before=structuredClone(g);addEntry(g,'1','addon',20);
  const restored=restoreAction(g,before,30);
  assert.equal(restored.players[0].addons,8);assert.equal(poolOf(restored),6400);
});
test('addons remain available after reentry but not while the player is out',()=>{
  const g=game({bountyMode:'fixed'});
  addEntry(g,'1','addon',0);eliminate(g,'1',10,'2');
  assert.throws(()=>addEntry(g,'1','addon',20));
  addEntry(g,'1','reentry',30);addEntry(g,'1','addon',40);
  assert.equal(g.players[0].addons,2);assertBankBalances(g);
});
test('removing old addon limits preserves recorded purchases, money and undo snapshots',()=>{
  const g=game({addonLimit:1});delete g.freezeout;
  Object.assign(g.players[0],{rebuys:2,addons:2,entries:3,invested:4000,mainContribution:4000});
  g.events.push({type:'rebuy',playerId:'1',amount:1000,at:0});
  const oldPlayers=structuredClone(g.players),oldEvents=structuredClone(g.events),oldPool=poolOf(g);
  normalizeGame(g);
  assert.equal(g.config.addonLimit,undefined);assert.equal(g.freezeout,null);
  assert.deepEqual(g.players,oldPlayers);assert.deepEqual(g.events,oldEvents);assert.equal(poolOf(g),oldPool);
  const snapshot=structuredClone(g);snapshot.config.addonLimit=1;
  assert.equal(restoreAction(g,snapshot).config.addonLimit,undefined);
  addEntry(g,'1','addon');assert.equal(g.players[0].addons,3);
});
test('smart structure accepts multiple addons for every player',()=>{
  assert.equal(recommendStructure(defaults(),{addons:18}).chips,150000);
  assert.equal(recommendStructure({...defaults(),addonLimit:1},{addons:18}).chips,150000);
});
test('freezeout restarts the current level and preserves entries, players and funds',()=>{
  const g=game({bountyMode:'fixed'});jumpLevel(g,2,0);g.remaining=90;
  const before=structuredClone(g);
  assert.equal(startFreezeout(g,1000),true);
  assert.equal(g.index,2);assert.equal(g.remaining,1200);assert.equal(g.deadline,1201000);
  assert.equal(g.running,true);assert.equal(g.elapsed,0);assert.equal(g.freezeout.level,3);
  assert.deepEqual(g.players,before.players);assert.deepEqual(g.config,before.config);assertBankBalances(g);
  assert.equal(g.events.at(-1).type,'freezeout');
  const saved=normalizeGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(saved.freezeout,g.freezeout);assert.equal(saved.config.reentry,true);
  const started=structuredClone(g);
  assert.equal(startFreezeout(g,2000),false);assert.deepEqual(g,started);
});
test('freezeout skips a break and starts the next playable level',()=>{
  const g=game();jumpLevel(g,4,0);
  assert.equal(g.levels[g.index].kind,'break');
  startFreezeout(g,1000);
  assert.equal(g.index,5);assert.equal(g.freezeout.level,5);
  assert.equal(g.remaining,1200);assert.equal(g.deadline,1201000);assert.equal(g.running,true);
});
test('freezeout settles a running clock before restarting its actual level',()=>{
  const g=game();toggleClock(g,0);
  startFreezeout(g,1205000);
  assert.equal(g.index,1);assert.equal(g.elapsed,1205000);
  assert.equal(g.remaining,1200);assert.equal(g.deadline,2405000);
});
test('freezeout is unavailable in cash and completed games',()=>{
  for(const g of [game({mode:'cash'}),{...game(),finished:true},{...game(),structureEnded:true}]) {
    const before=structuredClone(g);assert.equal(startFreezeout(g,1000),false);assert.deepEqual(g,before);
  }
  const g=game();toggleClock(g,0);
  assert.equal(startFreezeout(g,1000000000),false);assert.equal(g.freezeout,null);assert.equal(g.structureEnded,true);
});
test('freezeout keeps manual reentry and unlimited addons available',()=>{
  const g=game({bountyMode:'progressive'});startFreezeout(g,0);
  eliminate(g,'1',1000,'2');addEntry(g,'1','reentry',100000);
  for(let i=0;i<4;i++)addEntry(g,'1','addon',100000+i);
  assert.equal(g.players[0].reentries,1);assert.equal(g.players[0].addons,4);
  assert.equal(g.config.reentry,true);assert.ok(g.freezeout);assertBankBalances(g);
});
test('undoing freezeout restores a paused timer or its original running schedule',()=>{
  const paused=game();paused.remaining=90;const beforePause=structuredClone(paused);
  startFreezeout(paused,1000);
  const restoredPause=restoreAction(paused,beforePause,5000);
  assert.equal(restoredPause.running,false);assert.equal(restoredPause.remaining,90);assert.equal(restoredPause.freezeout,null);
  const running=game();toggleClock(running,0);const beforeRun=structuredClone(running);
  startFreezeout(running,5000);
  const restoredRun=restoreAction(running,beforeRun,8000);
  assert.equal(restoredRun.running,true);assert.equal(restoredRun.remaining,1192);assert.equal(restoredRun.elapsed,8000);
  assert.equal(restoredRun.deadline,1200000);assert.equal(restoredRun.freezeout,null);assert.equal(restoredRun.events.length,0);
});
test('undoing a financial operation after freezeout keeps its phase and clock',()=>{
  const g=game();startFreezeout(g,0);const before=structuredClone(g);
  addEntry(g,'1','addon',1000);const restored=restoreAction(g,before,2000);
  assert.deepEqual(restored.freezeout,before.freezeout);assert.equal(restored.running,true);
  assert.equal(restored.elapsed,2000);assert.equal(restored.remaining,1198);assert.equal(poolOf(restored),3000);
});

test('automatic opening blinds repair invalid manual blinds and scale with stack and depth',()=>{
  const c={...defaults(),stack:1000,sb:10,bb:10};
  const plan=recommendStructure(c,{autoBlinds:true,startDepth:100});
  assert.equal(plan.startSB,5);assert.equal(plan.startBB,10);assert.equal(plan.startDepth,100);
  assert.equal(plan.levels[0].sb,5);assert.equal(plan.levels[0].bb,10);
  assert.equal(plan.levels.reduce((sum,l)=>sum+l.duration,0),240*60);
  assert.equal(recommendStructure({...c,stack:10000},{autoBlinds:true}).startBB,100);
  assert.equal(recommendStructure({...c,stack:10000},{autoBlinds:true,startDepth:200}).startBB,50);
  assert.equal(c.sb,10);assert.equal(c.bb,10);
  assert.throws(()=>recommendStructure(c,{autoBlinds:false}));
});
test('automatic openings use integer chips and valid blind ratios over the supported range',()=>{
  for(const stack of [1,99,750,1000,15000,10000000]) for(const startDepth of [20,100,200,500]) {
    const plan=recommendStructure({...defaults(),stack},{autoBlinds:true,startDepth});
    assert.ok(plan.levels.filter(l=>l.kind==='level').every(l=>Number.isInteger(l.sb)&&l.sb>=1&&l.bb===2*l.sb));
    assert.ok(plan.startBB<=1000000);
  }
  for(const startDepth of [0,19,501,100.5,NaN]) assert.throws(()=>recommendStructure(defaults(),{autoBlinds:true,startDepth}));
});
test('elimination without bounty records no killer and can be undone after declaring a winner',()=>{
  const g=game();eliminate(g,'2',10,'1');
  assert.equal(g.events.at(-1).killerId,null);assert.equal(g.players[0].knockouts,0);
  const before=structuredClone(g);eliminate(g,'3',20);
  assert.equal(g.finished,true);assert.equal(g.players[0].place,1);
  const restored=restoreAction(g,before,30);
  assert.equal(restored.finished,false);assert.equal(restored.players[2].active,true);
  assert.equal(restored.players[0].place,null);assert.equal(poolOf(restored),3000);
});
test('freezeout addon terms affect only future purchases and preserve their recorded chip counts',()=>{
  const g=game({bountyMode:'fixed'});addEntry(g,'1','addon',0);
  const paid=structuredClone(g.players), before=structuredClone(g), oldPurchase=structuredClone(g.events[0]);
  assert.equal(startFreezeout(g,1000,{addonCost:1500,addonStack:20000}),true);
  assert.deepEqual(g.players,paid);assert.equal(poolOf(g),2900);
  assert.deepEqual(g.events[0],oldPurchase);assert.equal(oldPurchase.amount,500);assert.equal(oldPurchase.chips,5000);
  assert.equal(g.events.at(-1).addonCost,1500);assert.equal(g.events.at(-1).addonStack,20000);
  const restored=restoreAction(g,before,2000);
  assert.equal(restored.config.addonCost,500);assert.equal(restored.config.addonStack,5000);assert.equal(restored.freezeout,null);
  const reloaded=normalizeGame(JSON.parse(JSON.stringify(g)));
  addEntry(reloaded,'1','addon',2000);
  assert.equal(poolOf(reloaded),4400);assert.equal(reloaded.players[0].addons,2);
  assert.equal(reloaded.events.at(-1).amount,1500);assert.equal(reloaded.events.at(-1).chips,20000);
  assert.equal(reloaded.config.reentry,true);assertBankBalances(reloaded);
});
test('invalid freezeout addon terms leave game and running timer untouched',()=>{
  for(const terms of [{addonCost:0},{addonStack:-1},{addonCost:1.5},{addonStack:10000001},{addonCost:NaN}]) {
    const g=game();toggleClock(g,0);const before=structuredClone(g);
    assert.throws(()=>startFreezeout(g,1000,terms));assert.deepEqual(g,before);
  }
});
