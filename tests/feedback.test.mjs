import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, makeLevels, createGame, normalizeGame, wholeNumber, validateProfile, validateConfig, validateStructure, seatingDescription, filterPlayers, registerPlayer, toggleClock, advanceClock, jumpLevel, extendLevel, editFutureStructure, moveStructureRow, startFreezeout, setAddonTerms, restoreAction, eliminate, addEntry, finishGame, gameResults, exportGameResults, poolOf, bountyPoolOf } from '../dist/engine.js';
const people=[{id:'a',name:'Анна',nick:'Fox22'},{id:'b',name:'Максим',nick:''},{id:'c',name:'Мария',nick:'Ace'}];
function game(config={}) {const c={...defaults(),seats:3,...config};return createGame(c,makeLevels(c),people,0);}
function balanced(g){assert.equal(g.players.reduce((n,p)=>n+p.invested,0),poolOf(g)+bountyPoolOf(g));assert.equal(bountyPoolOf(g),g.players.reduce((n,p)=>n+p.bounty+p.earnedBounty,0));}

test('whole-number parsing rejects malformed, fractional and unsafe amounts without reinterpretation',()=>{
  for(const raw of ['','-1','+12','1500-000','12.5','1e3','Infinity','9007199254740993'])assert.throws(()=>wholeNumber(raw,0,100000000));
  assert.equal(wholeNumber('001500',1,10000000),1500);
  assert.throws(()=>wholeNumber('10000001',1,10000000));
  for(const config of [{addonCost:10000001},{addonStack:1.5},{prizes:[50.5,49.5]},{freezeoutAfterBreak:-1}])assert.notEqual(validateConfig({...defaults(),...config}),'');
});
test('real names accept Unicode letters, spaces and punctuation; nickname-only profiles retain digits',()=>{
  for(const name of ['Анна-Мария','O’Connor','李 明','José'])assert.equal(validateProfile({name}),'');
  for(const name of ['123','Alex22','—','Anna_'])assert.notEqual(validateProfile({name}),'');
  assert.equal(validateProfile({name:'',nick:'123Fox'}),'');assert.notEqual(validateProfile({name:'',nick:''}),'');
  const g=game();const player=registerPlayer(g,{id:'nick',name:'',nick:'777'},null,1);
  assert.equal(player.nick,'777');assert.throws(()=>registerPlayer(g,{id:'copy',name:'',nick:'777'},null,2),/уже зарегистрирован/);
});
test('table summaries group actual balanced seat counts compactly',()=>{
  assert.equal(seatingDescription(200,2),'100 столов по 2 игрока');
  assert.equal(seatingDescription(199,2),'99 столов по 2 игрока, 1 стол по 1 игроку');
  assert.equal(seatingDescription(15,10),'1 стол по 8 игроков, 1 стол по 7 игроков');
});
test('filters search both name and nickname, combine table and active status and exclude the eliminated player',()=>{
  const g=game({tableCapacity:2});
  assert.deepEqual(filterPlayers(g.players,{query:'FOx22'}).map(p=>p.id),['a']);
  assert.deepEqual(filterPlayers(g.players,{query:'мар',table:2}).map(p=>p.id),['c']);
  assert.equal(filterPlayers(g.players,{query:'мар',table:1}).length,0);
  assert.deepEqual(filterPlayers(g.players,{table:1,activeOnly:true,excludeId:'a'}).map(p=>p.id),['b']);
});
test('cross-table bounty selection needs an explicit override and preserves all money',()=>{
  const g=game({tableCapacity:2,bountyMode:'progressive'}),before=structuredClone(g);
  assert.throws(()=>eliminate(g,'c',1,'a'),/другим столом/);assert.deepEqual(g,before);
  eliminate(g,'c',1,'a',{allowOtherTable:true});assert.equal(g.players[0].earnedBounty,100);balanced(g);
});
test('structure validation catches invalid durations and blinds and missing scheduled freezeout break',()=>{
  const rows=makeLevels(defaults());assert.equal(validateStructure(rows,2),'');
  for(const row of [{kind:'level',number:1,sb:10,bb:10,duration:60},{kind:'level',number:1,sb:5,bb:10,duration:90}])assert.notEqual(validateStructure([row]),'');
  assert.notEqual(validateStructure([...rows,{kind:'break',duration:600}]),'');
  assert.notEqual(validateStructure(rows,3),'');
});
test('an appended break can move to slot seven without losing edits or the selected freezeout break',()=>{
  const rows=makeLevels(defaults());rows[0].duration=1380;rows[6].bb=425;
  rows.push({kind:'break',duration:780});
  const before=structuredClone(rows), moved=moveStructureRow(rows,rows.length-1,6,3);
  assert.deepEqual(rows,before);assert.equal(moved.rows[6].kind,'break');assert.equal(moved.rows[6].duration,780);
  assert.equal(moved.rows[0].duration,1380);assert.equal(moved.rows[7].bb,425);
  assert.equal(moved.freezeoutAfterBreak,2);assert.equal(validateStructure(moved.rows,moved.freezeoutAfterBreak),'');
  assert.equal(moved.rows.reduce((sum,l)=>sum+l.duration,0),rows.reduce((sum,l)=>sum+l.duration,0));
});
test('playing levels cannot be moved, including across a break',()=>{
  const rows=makeLevels({...defaults(),ante:true}), before=structuredClone(rows);
  for(const [from,to] of [[0,1],[2,1],[3,4],[5,4],[6,8]])assert.throws(()=>moveStructureRow(rows,from,to),/только перерывы/);
  assert.deepEqual(rows,before);
});
test('moving a break in either direction preserves the order and all fields of playing levels',()=>{
  const rows=makeLevels({...defaults(),ante:true});rows[2].duration=1500;
  const before=structuredClone(rows), levels=rows.filter(l=>l.kind==='level');
  const down=moveStructureRow(rows,4,7);
  assert.equal(down.rows[7].kind,'break');assert.deepEqual(down.rows.filter(l=>l.kind==='level'),levels);
  const up=moveStructureRow(down.rows,7,2);
  assert.equal(up.rows[2].kind,'break');assert.deepEqual(up.rows.filter(l=>l.kind==='level'),levels);
  assert.equal(up.rows[2].duration,rows[4].duration);assert.deepEqual(rows,before);
});
test('break movement cannot cross a running row or the schedule boundaries',()=>{
  const rows=makeLevels(defaults()), before=structuredClone(rows);
  for(const [from,to] of [[4,1],[-1,2],[4,rows.length],[4,1.5],[4,-1]])assert.throws(()=>moveStructureRow(rows,from,to,0,1));
  assert.throws(()=>moveStructureRow(rows,4,5,0,4),/будущие перерывы/);
  assert.throws(()=>moveStructureRow(rows,9,4,0,4),/будущие перерывы/);
  assert.deepEqual(rows,before);assert.equal(moveStructureRow(rows,4,3,0,1).rows[3].kind,'break');
});
test('moving a future freezeout break preserves the live deadline and its new trigger through save and undo',()=>{
  const g=game({duration:1,breakEvery:2,breakDuration:1,freezeoutAfterBreak:2});toggleClock(g,0);
  const before=structuredClone(g), moved=moveStructureRow(g.levels,5,1,2,g.index);
  editFutureStructure(g,moved.rows,10000,{freezeoutAfterBreak:moved.freezeoutAfterBreak});
  assert.equal(g.config.freezeoutAfterBreak,1);assert.equal(g.deadline,60000);assert.equal(g.remaining,50);
  const loaded=normalizeGame(JSON.parse(JSON.stringify(g)));advanceClock(loaded,121000);
  assert.equal(loaded.freezeout.startedAt,120000);assert.equal(loaded.freezeout.level,2);
  const restored=restoreAction(loaded,before,121000,'clock');
  assert.equal(restored.config.freezeoutAfterBreak,2);assert.deepEqual(restored.levels,before.levels);assert.equal(restored.freezeout,null);
});
test('running level extension preserves elapsed time and shifts the deadline by the added minutes',()=>{
  const g=game();toggleClock(g,0);extendLevel(g,5,10000);
  assert.equal(g.elapsed,10000);assert.equal(g.remaining,1490);assert.equal(g.deadline,1500000);assert.equal(g.levels[0].duration,1500);
  const loaded=normalizeGame(JSON.parse(JSON.stringify(g)));advanceClock(loaded,1490000);assert.equal(loaded.index,0);assert.equal(loaded.remaining,10);
});
test('extension of a paused or expired last level does not automatically resume',()=>{
  const paused=game();paused.remaining=5;extendLevel(paused,2,1000);assert.equal(paused.remaining,125);assert.equal(paused.running,false);
  const ended=game();jumpLevel(ended,ended.levels.length-1,0);toggleClock(ended,0);advanceClock(ended,1200000);
  const before=structuredClone(ended);extendLevel(ended,5,1300000);assert.equal(ended.structureEnded,false);assert.equal(ended.remaining,300);assert.equal(ended.running,false);
  assert.deepEqual(restoreAction(ended,before,1400000,'clock').levels,before.levels);
  assert.equal(restoreAction(ended,before,1400000,'clock').structureEnded,true);
});
test('an expired modal cannot extend the next level by mistake, and invalid requests are atomic',()=>{
  const g=game();toggleClock(g,0);const before=structuredClone(g);
  assert.throws(()=>extendLevel(g,5,1201000,0),/уже сменился/);assert.deepEqual(g,before);
  assert.throws(()=>extendLevel(g,180,10),/180/);assert.deepEqual(g,before);
});
test('future structure editing preserves the current deadline and refuses to change played levels',()=>{
  const g=game();toggleClock(g,0);const rows=structuredClone(g.levels);rows[1].duration=1800;
  editFutureStructure(g,rows,10000);assert.equal(g.remaining,1190);assert.equal(g.deadline,1200000);assert.equal(g.levels[1].duration,1800);
  const before=structuredClone(g), invalid=structuredClone(g.levels);invalid[0].sb=1;
  assert.throws(()=>editFutureStructure(g,invalid,11000));assert.deepEqual(g,before);
  const raced=structuredClone(g.levels);raced[1].duration=600;
  assert.throws(()=>editFutureStructure(g,raced,1201000));assert.deepEqual(g,before);
});
test('adding a level after the structure ends selects it paused and is undoable after reload',()=>{
  const g=game();toggleClock(g,0);advanceClock(g,100000000);const before=structuredClone(g), originalLength=g.levels.length;
  const rows=[...g.levels,{kind:'level',number:13,sb:2000,bb:4000,ante:0,duration:600}];
  editFutureStructure(g,rows,100001000);assert.equal(g.index,originalLength);assert.equal(g.remaining,600);assert.equal(g.finished,false);assert.equal(g.running,false);assert.equal(g.structureEnded,false);
  const restored=restoreAction(normalizeGame(JSON.parse(JSON.stringify(g))),before,100002000,'clock');assert.deepEqual(restored.levels,before.levels);assert.equal(restored.structureEnded,true);
});
test('results exclude time after the last deadline when an inactive tab wakes up late',()=>{
  const g=game({duration:1,breakEvery:0});toggleClock(g,1000);advanceClock(g,900000);
  assert.equal(g.elapsed,720000);assert.equal(g.structureEnded,true);assert.equal(g.finished,false);
  finishGame(g,1000000);assert.equal(gameResults(g).rows.every(p=>p.prize===null),true);assert.equal(g.elapsed,720000);
});
test('undoing a purchase after a manual level change retains its clock and extended schedule',()=>{
  const g=game();extendLevel(g,5,0);const before=structuredClone(g);addEntry(g,'a','addon',10);jumpLevel(g,1,20);
  const restored=restoreAction(g,before,30);assert.deepEqual(restored.levels,g.levels);assert.equal(restored.index,1);assert.equal(restored.players[0].addons,0);
});
test('planned freezeout starts at the boundary after the chosen break without resetting the deadline',()=>{
  const g=game({duration:1,breakEvery:1,breakDuration:1,freezeoutAfterBreak:2});toggleClock(g,0);
  advanceClock(g,239999);assert.equal(g.freezeout,null);
  advanceClock(g,245000);assert.equal(g.index,4);assert.equal(g.freezeout.startedAt,240000);assert.equal(g.remaining,55);assert.equal(g.deadline,300000);
  assert.equal(g.freezeout.automatic,true);assert.equal(g.events.filter(e=>e.type==='freezeout').length,1);
  const loaded=normalizeGame(JSON.parse(JSON.stringify(g)));advanceClock(loaded,450000);assert.equal(loaded.events.filter(e=>e.type==='freezeout').length,1);
});
test('restoring an inactive tab catches a planned freezeout and manual forward jumps honor it',()=>{
  const g=game({duration:1,breakEvery:1,breakDuration:1,freezeoutAfterBreak:2});toggleClock(g,0);advanceClock(g,450000);
  assert.equal(g.freezeout.startedAt,240000);assert.equal(g.index,7);
  const paused=game({freezeoutAfterBreak:1});jumpLevel(paused,6,100);assert.equal(paused.freezeout.level,5);assert.equal(paused.running,false);
});
test('manual freezeout does not overwrite an automatic boundary reached while its dialog was open',()=>{
  const g=game({duration:1,breakEvery:1,breakDuration:1,freezeoutAfterBreak:1});toggleClock(g,0);
  assert.equal(startFreezeout(g,125000,{addonCost:2500,addonStack:30000}),false);
  assert.equal(g.freezeout.automatic,true);assert.equal(g.freezeout.startedAt,120000);
  assert.equal(g.remaining,55);assert.equal(g.deadline,180000);
  assert.equal(g.config.addonCost,500);assert.equal(g.events.filter(e=>e.type==='freezeout').length,1);
});
test('undo of a prior financial action does not undo an automatic freezeout reached meanwhile',()=>{
  const g=game({duration:1,breakEvery:1,breakDuration:1,freezeoutAfterBreak:1});toggleClock(g,0);const before=structuredClone(g);addEntry(g,'a','addon',1000);
  const restored=restoreAction(g,before,121000);assert.equal(restored.freezeout.automatic,true);assert.equal(restored.events.at(-1).type,'freezeout');assert.equal(restored.players[0].addons,0);assert.equal(restored.remaining,59);
});
test('planned freezeout still permits manual reentry and changing addon terms only affects later buys',()=>{
  const g=game({bountyMode:'progressive',freezeoutAfterBreak:1});jumpLevel(g,5,0);addEntry(g,'a','addon',1);
  const first=structuredClone(g.events.at(-1));setAddonTerms(g,2000,30000,2);eliminate(g,'b',3,'a');addEntry(g,'b','reentry',4);addEntry(g,'b','addon',5);
  assert.deepEqual(g.events.find(e=>e.type==='addon'),first);assert.equal(g.events.at(-1).amount,2000);assert.equal(g.events.at(-1).chips,30000);balanced(g);
});
for(const bountyMode of ['off','fixed','progressive'])test(`manual completion does not invent a winner or distribute unresolved ${bountyMode} prizes`,()=>{
  const g=game({bountyMode});toggleClock(g,0);eliminate(g,'c',100,'a');const before=structuredClone(g);
  finishGame(g,1000);assert.equal(g.finished,true);assert.equal(g.completionReason,'manual');assert.equal(g.players.some(p=>p.place===1),false);assert.equal(g.elapsed,1000);
  const result=gameResults(g), third=result.rows.find(p=>p.id==='c');assert.equal(third.prize,Math.floor(poolOf(g)*.2));assert.equal(result.rows.find(p=>p.id==='a').total,null);assert.ok(result.unassignedPrize>0);
  assert.equal(result.rows.reduce((n,p)=>n+(p.prize??0),0)+result.unassignedPrize,poolOf(g));balanced(g);
  const loaded=normalizeGame(JSON.parse(JSON.stringify(g)));assert.deepEqual(gameResults(loaded),result);assert.throws(()=>addEntry(loaded,'c','reentry',2000),/отмените/);
  const restored=restoreAction(loaded,before,2000);assert.equal(restored.finished,false);assert.equal(restored.running,false);assert.deepEqual(restored.players,before.players);
});
test('normal elimination produces complete results conserving main prizes and bounty money',()=>{
  const g=game({bountyMode:'progressive'});eliminate(g,'c',1,'a');eliminate(g,'b',2,'a');
  const r=gameResults(g);assert.equal(g.completionReason,'elimination');assert.equal(g.finishedAt,2);assert.equal(r.unassignedPrize,0);assert.equal(r.liveBounties,0);assert.equal(r.rows[0].place,1);
  assert.equal(r.rows.reduce((n,p)=>n+p.total,0),r.invested);assert.equal(r.rows.reduce((n,p)=>n+p.net,0),0);
  addEntry(g,'b','reentry',3);assert.equal(g.finished,false);assert.equal(g.completionReason,null);assert.equal(g.finishedAt,null);balanced(g);
});
test('cash final results use only recorded cashouts',()=>{
  const g=game({mode:'cash'});assert.throws(()=>finishGame(g,1),/выхода/);
  [1500,1000,500].forEach((amount,i)=>{g.players[i].cashout=amount;g.players[i].active=false;});finishGame(g,2);
  const r=gameResults(g);assert.equal(r.unassignedPrize,0);assert.equal(r.rows.reduce((n,p)=>n+p.net,0),0);assert.equal(r.rows[0].net,500);
});

test('result export keeps money and counters after reentry and addons without exposing profiles',()=>{
  const g=game({bountyMode:'progressive'});
  eliminate(g,'c',1,'a');addEntry(g,'c','reentry',2);addEntry(g,'a','addon',3);
  eliminate(g,'c',4,'b');eliminate(g,'b',5,'a');
  g.players[0].email='private@example.test';g.events.push({text:'Private event content'});
  const before=structuredClone(g), exported=JSON.parse(JSON.stringify(exportGameResults(g)));
  assert.deepEqual(g,before);
  assert.deepEqual(exported.players.map(p=>[p.nick,p.place,p.invested,p.reentries,p.addons,p.knockouts,p.totalWinnings,p.netResult]),[
    ['Fox22',1,1500,0,1,2,2550,1050],['Игрок 2',2,1000,0,0,1,1210,210],['Ace',3,2000,1,0,0,740,-1260],
  ]);
  assert.equal(exported.summary.invested,4500);assert.equal(exported.summary.totalWinnings,4500);
  assert.equal(exported.players.reduce((n,p)=>n+p.netResult,0),0);
  assert.equal(exported.finishedAt,'1970-01-01T00:00:00.005Z');assert.equal(exported.currency,'RUB');
  const json=JSON.stringify(exported);
  for(const privateValue of ['Анна','Максим','Мария','private@example.test','Private event content'])assert.ok(!json.includes(privateValue));
  for(const player of exported.players)for(const key of ['id','name','table','seat','email','events'])assert.ok(!(key in player));
});
test('result export preserves unknown results and does not invent knockout stats without bounty',()=>{
  const g=game();assert.throws(()=>exportGameResults(g),/завершения/);
  eliminate(g,'c',1);finishGame(g,2);
  const result=exportGameResults(g), unresolved=result.players.filter(p=>p.place===null);
  assert.equal(unresolved.length,2);
  assert.ok(unresolved.every(p=>p.prize===null&&p.totalWinnings===null&&p.netResult===null));
  assert.ok(result.players.every(p=>p.knockouts===null));
  assert.equal(result.summary.totalWinnings,null);assert.equal(result.summary.unassignedPrize,2400);
  assert.equal(result.players.find(p=>p.nick==='Ace').totalWinnings,600);
});
test('cash result export uses recorded cashouts, entry counts and net results',()=>{
  const g=game({mode:'cash'});g.players[0].entries++;g.players[0].invested+=500;
  [2000,1000,500].forEach((amount,i)=>{g.players[i].cashout=amount;g.players[i].active=false;});finishGame(g,2);
  const exported=exportGameResults(g), fox=exported.players.find(p=>p.nick==='Fox22');
  assert.equal(fox.entries,2);assert.equal(fox.extraBuyins,1);assert.equal(fox.cashout,2000);assert.equal(fox.netResult,500);
  assert.equal(fox.prize,null);assert.equal(fox.knockouts,null);
  assert.equal(exported.summary.invested,3500);assert.equal(exported.summary.totalWinnings,3500);
  assert.equal(exported.summary.unassignedPrize,0);assert.equal(exported.summary.unclaimedBounties,0);
});
