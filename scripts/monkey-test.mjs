import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as E from '../web/static/engine.js';

export function randomFor(seed) {
  let n=seed>>>0;
  return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
}
const sum=(rows,key)=>rows.reduce((n,row)=>n+(row[key]||0),0);
export function assertGame(g) {
  const active=g.players.filter(p=>p.active), out=g.players.filter(p=>!p.active);
  assert.equal(new Set(g.players.map(p=>p.id)).size,g.players.length,'duplicate participant IDs');
  assert.equal(new Set(active.map(p=>`${p.table}:${p.seat}`)).size,active.length,'two active players share a seat');
  assert.ok(active.every(p=>Number.isInteger(p.table)&&p.table>0&&Number.isInteger(p.seat)&&p.seat>=1&&p.seat<=g.config.tableCapacity),'invalid active seat');
  assert.ok(out.every(p=>p.table===null&&p.seat===null),'eliminated player reserves a seat');
  assert.equal(g.config.seats,g.players.length,'participant count drift');
  assert.equal(sum(g.players,'invested'),E.poolOf(g)+E.bountyPoolOf(g),'money created or lost');
  assert.equal(E.bountyPoolOf(g),sum(g.players,'bounty')+sum(g.players,'earnedBounty'),'bounty created or lost');
  for(const p of g.players) {
    for(const key of ['invested','mainContribution','bountyPaid','bounty','earnedBounty','entries','reentries','addons','knockouts']) assert.ok(Number.isSafeInteger(p[key])&&p[key]>=0,`invalid ${key} for ${p.id}`);
    assert.equal(p.entries,1+p.reentries+p.rebuys,'entry counters drift');
    if(!p.active) assert.equal(p.bounty,0,'out player retains a live bounty');
  }
  const placements=g.players.filter(p=>p.place!==null).map(p=>p.place);
  assert.equal(new Set(placements).size,placements.length,'duplicate finishing places');
  assert.ok(placements.every(n=>n>=1&&n<=g.players.length),'invalid finishing place');
  assert.deepEqual(new Set(g.eliminationOrder),new Set(out.map(p=>p.id)),'elimination order diverged');
  assert.equal(new Set(g.eliminationOrder).size,g.eliminationOrder.length,'duplicate eliminations');
  assert.ok(g.index>=0&&g.index<g.levels.length&&Number.isInteger(g.index),'invalid current level');
  assert.ok(Number.isFinite(g.remaining)&&g.remaining>=0,'invalid remaining time');
  assert.ok(Number.isFinite(g.elapsed)&&g.elapsed>=0,'invalid elapsed time');
  if(g.running) {assert.ok(!g.finished&&!g.structureEnded);assert.ok(Number.isFinite(g.deadline)&&g.deadline>=g.lastTick,'invalid deadline');}
  if(g.finished||g.structureEnded) assert.equal(g.running,false,'ended game still ticking');
  const results=E.gameResults(g);
  assert.equal(results.unassignedPrize+sum(results.rows,'prize'),E.poolOf(g),'prize accounting drift');
  assert.ok(results.unassignedPrize>=0,'prizes overpaid');
  if(g.finished) assert.equal(E.exportGameResults(g).summary.invested,sum(g.players,'invested'));
}

export function runScenario(seed,steps=300) {
  const random=randomFor(seed), pick=xs=>xs[Math.floor(random()*xs.length)], int=(a,b)=>a+Math.floor(random()*(b-a+1));
  const count=pick([2,3,6,9,15,30,80,200]);
  const config={...E.defaults(),seats:count,tableCapacity:int(2,10),duration:int(1,5),breakEvery:pick([0,3,4]),breakDuration:1,bountyMode:pick(['off','fixed','progressive']),bountyImmediate:int(1,99),prizes:count===2?[65,35]:[50,30,20],freezeoutAfterBreak:0};
  if(config.breakEvery&&random()<.5) config.freezeoutAfterBreak=1;
  const seats=Array.from({length:count},(_,i)=>({id:`p${i}`,name:'',nick:`Player ${i}`}));
  let state={version:1,config,seats,library:seats,step:'board',game:E.createGame(config,E.makeLevels(config),seats,0)}, now=0, nextId=count;
  const trace=[], counts={};
  const record=(name,details)=>{trace.push({step:trace.length,now,action:name,...details});counts[name]=(counts[name]||0)+1;};
  const mutate=(fn,kind='operation')=>{const before=structuredClone(state.game);fn();E.rememberAction(state,before,kind);};
  try {
    for(let step=0;step<steps;step++) {
      now+=int(0,180000);
      const g=state.game, active=g.players.filter(p=>p.active), out=g.players.filter(p=>!p.active);
      const actions=['reload','advance','undo','view'];
      if(!g.finished) {
        actions.push('toggle','jump');
        if(g.players.length<E.MAX_PLAYERS) actions.push('register','invalid-register');
        if(active.length>1) actions.push('eliminate','eliminate','eliminate','addon','addon','balance');
        if(!g.freezeout&&!g.structureEnded) actions.push('freezeout');
        actions.push('terms','finish','extend','structure');
      }
      if(out.length&&g.config.reentry&&g.completionReason!=='manual') actions.push('reentry','reentry');
      const action=pick(actions); record(action);
      switch(action) {
        case 'reload': state=JSON.parse(JSON.stringify(state));E.normalizeGame(state.game);E.actionHistory(state);break;
        case 'advance': E.advanceClock(g,now);break;
        case 'toggle': E.toggleClock(g,now);break;
        case 'jump': E.jumpLevel(g,int(0,g.levels.length-1),now);break;
        case 'undo': E.undoAction(state,now);break;
        case 'eliminate': {const p=pick(active),killer=pick(active.filter(x=>x.id!==p.id));Object.assign(trace.at(-1),{id:p.id,killer:killer.id});mutate(()=>E.eliminate(g,p.id,now,killer.id,{allowOtherTable:true}));break;}
        case 'addon': {const p=pick(active);trace.at(-1).id=p.id;mutate(()=>E.addEntry(g,p.id,'addon',now));break;}
        case 'reentry': {const p=pick(out);trace.at(-1).id=p.id;mutate(()=>E.addEntry(g,p.id,'reentry',now));break;}
        case 'register': {const profile={id:`p${nextId++}`,name:'',nick:`Late ${nextId}`};mutate(()=>E.registerPlayer(g,profile,null,now));break;}
        case 'invalid-register': {const before=structuredClone(g),p=pick(g.players);assert.throws(()=>E.registerPlayer(g,{id:'duplicate',name:p.name,nick:p.nick},null,now));assert.deepEqual(g,before);break;}
        case 'balance': {const plan=E.planTableBalance(g);if(plan.needsChange)mutate(()=>E.rebalanceTables(g,now,plan));break;}
        case 'freezeout': mutate(()=>E.startFreezeout(g,now,{addonCost:int(1,3000),addonStack:int(1,30000)}),'clock');break;
        case 'terms': mutate(()=>E.setAddonTerms(g,int(1,3000),int(1,30000),now));break;
        case 'finish': mutate(()=>E.finishGame(g,now));break;
        case 'extend': {
          E.advanceClock(g,now);
          if(g.levels[g.index].duration<10000)mutate(()=>E.extendLevel(g,1,now,g.index),'clock');break;
        }
        case 'structure': {
          E.advanceClock(g,now);
          const rows=structuredClone(g.levels);
          if(rows.length<E.MAX_STRUCTURE_ROWS) {
            const last=rows.at(-1);rows.push({...last,number:(last.number||1)+1});
            mutate(()=>E.editFutureStructure(g,rows,now),'clock');
          }break;
        }
        case 'view': {
          const before=JSON.stringify(g),table=pick(E.gameTableNumbers(g));
          E.tableViewSeats(active.filter(p=>p.table===table),g.config.tableCapacity,int(-40,40));
          assert.equal(JSON.stringify(g),before,'view mutated game');break;
        }
      }
      assertGame(state.game);
      // Reload is a normal operation and must be financially and temporally idempotent.
      assert.deepEqual(E.normalizeGame(structuredClone(state.game)),state.game,'reload changes valid game');
      assert.ok(Buffer.byteLength(JSON.stringify({revision:123456,state}))<1048576,'save exceeds server limit');
    }
    return {seed,steps,counts,players:state.game.players.length};
  } catch(error) {
    error.monkey={seed,step:trace.length-1,trace,state,message:error.message};throw error;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2), opt=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
  const seeds=Number(opt('--seeds',100)), steps=Number(opt('--steps',300)), first=Number(opt('--seed',1));
  const output=opt('--output','.local/monkey-report.json');
  assert.ok([seeds,steps,first].every(Number.isSafeInteger)&&seeds>0&&steps>0&&seeds<=10000&&steps<=10000);
  const report={startedAt:new Date().toISOString(),firstSeed:first,seeds,stepsPerSeed:steps,totalActions:0,counts:{},failures:[]};
  const start=performance.now();
  for(let seed=first;seed<first+seeds;seed++) {
    try {const run=runScenario(seed,steps);report.totalActions+=run.steps;for(const [k,n]of Object.entries(run.counts))report.counts[k]=(report.counts[k]||0)+n;}
    catch(error){report.failures.push(error.monkey||{seed,message:error.message});console.error(`FAIL seed=${seed} step=${error.monkey?.step}: ${error.message}`);break;}
    if((seed-first+1)%20===0) console.log(`${seed-first+1}/${seeds} scenarios; ${report.totalActions} actions`);
  }
  report.durationMs=Math.round(performance.now()-start);report.passed=!report.failures.length;
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,failures:report.failures.map(({seed,step,message})=>({seed,step,message}))},null,2));
  if(!report.passed)process.exitCode=1;
}
