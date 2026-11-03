import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, makeLevels, payouts, validateConfig, createGame, advanceClock, toggleClock, jumpLevel, eliminate, addEntry, poolOf, bountyPoolOf, formatTime } from '../dist/engine.js';

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
test('rebuy changes prize pool without changing player count',()=>{
  const g=game();addEntry(g,'2','rebuy');assert.equal(poolOf(g),4000);assert.deepEqual(payouts(poolOf(g),g.config.prizes),[2000,1200,800]);assert.equal(g.players.length,3);
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
  addEntry(g,'1','rebuy',40);assert.equal(poolOf(g),4700);assert.equal(g.players[0].bounty,300);assertBankBalances(g);
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
