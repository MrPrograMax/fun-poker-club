import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,createGame,makeLevels,eliminate,addEntry,registerPlayer,registeredPlayer,registrationTables,gameTableNumbers,normalizeGame,rebalanceTables,rememberAction,undoAction,tableViewSeats,poolOf,bountyPoolOf} from '../static/engine.js';

function game() {
  const config={...defaults(),seats:6,tableCapacity:3,bountyMode:'fixed'};
  return createGame(config,makeLevels(config),Array.from({length:6},(_,i)=>({id:String(i+1),name:'',nick:`P${i+1}`})),0);
}
function uniqueSeats(g) {
  const active=g.players.filter(p=>p.active);
  assert.equal(new Set(active.map(p=>`${p.table}:${p.seat}`)).size,active.length);
  assert.ok(g.players.filter(p=>!p.active).every(p=>p.table===null&&p.seat===null));
}

test('reentry takes another vacant seat without moving existing players',()=>{
  const g=game();eliminate(g,'1',1,'2');eliminate(g,'6',2,'4');
  registerPlayer(g,{id:'late',nick:'Late'},{table:1,seat:1},3);
  const others=g.players.filter(p=>p.active).map(p=>[p.id,p.table,p.seat]);
  addEntry(g,'1','reentry',4);
  assert.deepEqual([g.players[0].table,g.players[0].seat],[2,3]);
  assert.deepEqual(g.players.filter(p=>p.active&&p.id!=='1').map(p=>[p.id,p.table,p.seat]),others);
  assert.deepEqual(normalizeGame(JSON.parse(JSON.stringify(g))),g);
  uniqueSeats(g);
});

test('an empty table remains available until explicitly closed by balancing',()=>{
  const g=game();
  for(const id of ['4','5','6']) eliminate(g,id,1,'1',{allowOtherTable:true});
  assert.deepEqual(gameTableNumbers(g),[1,2]);
  assert.deepEqual(registrationTables(g).find(t=>t.table===2),{table:2,isNew:false,seats:[1,2,3]});
  const loaded=normalizeGame(JSON.parse(JSON.stringify(g)));
  rebalanceTables(loaded,2);
  assert.deepEqual(gameTableNumbers(loaded),[1]);
  assert.equal(registrationTables(loaded).find(t=>t.table===2).isNew,true);
  assert.deepEqual(gameTableNumbers(normalizeGame(loaded)),[1]);
});

test('old reserved seats migrate without changing active seats, funds, history or clock',()=>{
  const g=game();eliminate(g,'1',1,'2');delete g.openTables;
  Object.assign(g.players[0],{table:1,seat:1});delete g.players[0].lastTable;delete g.players[0].lastSeat;
  const before=structuredClone(g), pool=poolOf(g), heads=bountyPoolOf(g);
  normalizeGame(g);
  assert.deepEqual(g.players.slice(1),before.players.slice(1));
  assert.deepEqual([g.players[0].lastTable,g.players[0].lastSeat],[1,1]);
  assert.equal(poolOf(g),pool);assert.equal(bountyPoolOf(g),heads);
  assert.deepEqual(g.events,before.events);assert.equal(g.remaining,before.remaining);
  uniqueSeats(g);assert.deepEqual(normalizeGame(structuredClone(g)),g);
});

test('one missing active seat does not reseat the rest of a saved game',()=>{
  const g=game();Object.assign(g.players[0],{table:5,seat:3});delete g.players[1].table;
  const unaffected=g.players.filter(p=>p.id!=='2').map(p=>[p.id,p.table,p.seat]);
  normalizeGame(g);
  assert.deepEqual(g.players.filter(p=>p.id!=='2').map(p=>[p.id,p.table,p.seat]),unaffected);
  uniqueSeats(g);
});

test('undo across elimination, registration and reentry restores each seat owner after reload',()=>{
  const state={game:game()}, initial=structuredClone(state.game);
  rememberAction(state,state.game);eliminate(state.game,'1',1,'2');
  const eliminated=structuredClone(state.game);
  rememberAction(state,state.game);registerPlayer(state.game,{id:'late',nick:'Late'},null,2);
  const registered=structuredClone(state.game);
  rememberAction(state,state.game);addEntry(state.game,'1','reentry',3);
  const loaded=JSON.parse(JSON.stringify(state));loaded.game=normalizeGame(loaded.game);
  for(const expected of [registered,eliminated,initial]) {
    assert.ok(undoAction(loaded,4));
    assert.deepEqual(loaded.game.players,expected.players);
    assert.deepEqual(gameTableNumbers(loaded.game),gameTableNumbers(expected));
    uniqueSeats(loaded.game);
  }
});

test('a returning nickname identifies the existing participant and cannot create a duplicate',()=>{
  const g=game();eliminate(g,'1',1,'2');
  assert.equal(registeredPlayer(g,{name:'Новое имя',nick:'  p1  '}).id,'1');
  const before=structuredClone(g);
  assert.throws(()=>registerPlayer(g,{id:'new',name:'Новое имя',nick:'p1'},null,2),/ре-энтри/);
  assert.deepEqual(g,before);
});

test('table orientation keeps seat numbers, vacancies, participants and game data unchanged',()=>{
  const g=game();eliminate(g,'1',1,'2');const before=structuredClone(g);
  const players=g.players.filter(p=>p.table===1), original=tableViewSeats(players,3);
  const right=tableViewSeats(players,3,1), left=tableViewSeats(players,3,-1);
  assert.equal(original[0].player,null);
  assert.deepEqual(right.map(p=>[p.seat,p.player?.id]),original.map(p=>[p.seat,p.player?.id]));
  assert.deepEqual([right[0].x,right[0].y],[original[1].x,original[1].y]);
  assert.deepEqual([left[0].x,left[0].y],[original[2].x,original[2].y]);
  assert.deepEqual(tableViewSeats(players,3,3),original);
  assert.deepEqual(tableViewSeats(players,3,-3),original);
  assert.deepEqual(g,before);
});
