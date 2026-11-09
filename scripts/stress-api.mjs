import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {randomFor} from './monkey-test.mjs';

const binary=resolve(process.argv[2]||'.local/until-morning-monkey');
const dir=await mkdtemp(join(tmpdir(),'until-morning-api-monkey-'));
const child=spawn(binary,[],{env:{...process.env,LISTEN_ADDR:'127.0.0.1:0',DATA_DIR:dir},stdio:['ignore','ignore','pipe']});
let logs='';child.stderr.on('data',data=>{logs+=data.toString();});
const base=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),10000);
  child.on('error',reject);child.on('exit',code=>{if(code)reject(new Error(`Server exited: ${code}`));});
  child.stderr.on('data',()=>{const found=logs.match(/Until Morning: (http:\/\/127\.0\.0\.1:\d+)\//);if(found){clearTimeout(timeout);resolve(found[1]);}});
});
const report={base,requests:0,statuses:{},failures:[],latenciesMs:[]}, random=randomFor(0xabc123);
const valid={version:1,config:{name:'API Monkey test'},seats:[],library:[],step:'settings',game:null};
const request=async(method,path,body,headers={})=>{
  const start=performance.now();
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const text=await response.text();report.requests++;report.statuses[response.status]=(report.statuses[response.status]||0)+1;report.latenciesMs.push(performance.now()-start);
  return {status:response.status,text};
};
try {
  // Concurrent writers must yield exactly one successful commit for each revision.
  for(let revision=0;revision<40;revision++) {
    const writes=await Promise.all(Array.from({length:16},(_,writer)=>request('PUT','/api/state',{revision,state:{...valid,config:{name:`Round ${revision}, writer ${writer}`}}})));
    assert.equal(writes.filter(r=>r.status===200).length,1);
    assert.equal(writes.filter(r=>r.status===409).length,15);
    const saved=JSON.parse((await request('GET','/api/state')).text);
    assert.equal(saved.revision,revision+1);
    assert.deepEqual(JSON.parse(await readFile(join(dir,'state.json'),'utf8')),saved);
  }
  for(let batch=0;batch<50;batch++) await Promise.all(Array.from({length:16},async()=>{
    const path=['/','/app.js','/engine.js','/styles.css','/api/state','/api/health'][Math.floor(random()*6)];
    assert.equal((await request('GET',path)).status,200);
  }));
  let revision=40;
  const malformed=[];
  for(const key of ['config','seats','library','game'])for(const value of [null,false,17,'broken',[],{}]) {
    if(key==='game'&&value===null)continue;
    if(['seats','library'].includes(key)&&Array.isArray(value))continue;
    if(key==='config'&&value!==null&&!Array.isArray(value)&&typeof value==='object')continue;
    malformed.push({key,value,state:{...valid,[key]:value}});
  }
  for(const {key,value,state} of malformed.sort(()=>random()-.5)) {
    const before=JSON.parse((await request('GET','/api/state')).text);
    const response=await request('PUT','/api/state',{revision,state});
    if(response.status!==400) {
      report.failures.push({kind:'invalid-state-accepted',key,value,status:response.status});
      if(response.status===200)revision++;
    } else assert.deepEqual(JSON.parse((await request('GET','/api/state')).text),before);
  }
  for(let i=0;i<40;i++) {
    const game={id:`stress-${i}`,config:{name:`Stress match ${i}`,mode:'tournament'},players:[],levels:[{kind:'level',duration:60}],index:0,finished:true,startedAt:1000,elapsed:12000,events:Array.from({length:300},(_,n)=>({type:'addon',at:n,amount:500}))};
    assert.equal((await request('PUT','/api/state',{revision,state:{...valid,game}})).status,200);revision++;
    const archived=JSON.parse((await request('GET',`/api/archives/${game.id}`)).text);
    assert.deepEqual(archived.game,game);
  }
  assert.equal(JSON.parse((await request('GET','/api/archives')).text).games.length,40);
  for(const headers of [{'Origin':'https://untrusted.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await request('PUT','/api/state',{revision,state:valid},headers)).status,403);
  assert.equal((await request('PUT','/api/state',{revision,state:valid},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await request('PUT','/api/state',{revision,state:{...valid,padding:'x'.repeat(8*1024*1024)}})).status,400);
} catch(error) {report.failures.push({kind:'assertion',message:error.message});}
finally {
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  const sorted=report.latenciesMs.toSorted((a,b)=>a-b);
  report.latency={p50Ms:Math.round(sorted[Math.floor(sorted.length*.5)]),p95Ms:Math.round(sorted[Math.floor(sorted.length*.95)]),maxMs:Math.round(sorted.at(-1))};delete report.latenciesMs;
  report.passed=!report.failures.length;report.serverStopped=true;
  await writeFile('.local/api-monkey-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  if(!report.passed)process.exitCode=1;
}
