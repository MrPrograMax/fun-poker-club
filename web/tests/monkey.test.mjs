import test from 'node:test';
import assert from 'node:assert/strict';
import {runScenario,runCashScenario} from '../../scripts/monkey-test.mjs';
import {defaults,createGame,makeLevels,addEntry} from '../static/engine.js';
for(const seed of [7,19,41,73])test(`deterministic state-machine monkey seed ${seed}`,()=>runScenario(seed,80));
for(const seed of [7,19,41,73])test(`cash state-machine monkey seed ${seed}`,()=>runCashScenario(seed,100));
test('a long game keeps the full event log for its archive',()=>{
 const c=defaults(),g=createGame(c,makeLevels(c),[{id:'1',name:'One'},{id:'2',name:'Two'},{id:'3',name:'Three'}],0);
 for(let i=0;i<450;i++)addEntry(g,'1','addon',i);
 assert.equal(g.events.length,450);assert.equal(g.events[0].at,0);assert.equal(g.events.at(-1).at,449);
 assert.equal(g.players[0].addons,450);
});
