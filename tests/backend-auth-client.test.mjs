import test from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../server/auth.mjs";
import { hashPassword, tokenDigest } from "../server/credentials.mjs";
import { BackendApi } from "../js/backend-api.js";
import { PostgresRepository } from "../server/postgres-repository.mjs";
import { createGateway } from "../server/gateway.mjs";
import { createRewardWallet } from "../js/loyalty-v2.js";
import { databaseOptions, configuredGateway } from "../server/runtime.mjs";

test("後端登入正常驗證第二次密碼，session不接受自報角色、可撤銷及到期",async()=>{
  let now=new Date("2026-11-19T00:00:00Z");
  const record={id:"admin135",username:"admin135",name:"Admin135",active:true,password_hash:await hashPassword("synthetic-only-pass")};
  const sessions=new Map();let permit=true;
  const repository={attemptLogin:async()=>permit,accountByUsername:async n=>n===record.username?record:null,accountById:async id=>id===record.id?record:null,putSession:async s=>sessions.set(s.tokenHash,{account_id:s.accountId,expires_at:s.expiresAt}),sessionByHash:async h=>sessions.get(h),removeSession:async h=>sessions.delete(h)};
  const auth=createAuth({repository,clock:()=>now});
  const req=token=>new Request("https://backend.test/api/session",{headers:{Authorization:`Bearer ${token}`,"x-username":"howood","x-role":"admin"}});
  const first=await auth.login(req("none"),{username:"Admin135",password:"synthetic-only-pass"});
  assert.equal(first.profile.username,"admin135");assert.equal(Object.hasOwn(first.profile,"password_hash"),false);assert.ok(sessions.has(tokenDigest(first.accessToken)));
  assert.equal((await auth.authenticate(req(first.accessToken))).username,"admin135");assert.equal(await auth.authenticate(req("x".repeat(43))),null);
  await assert.rejects(()=>auth.login(req("none"),{username:"Admin135",password:"wrong"}),/不正確/);
  const second=await auth.login(req("none"),{username:"Admin135",password:"synthetic-only-pass"});assert.notEqual(second.accessToken,first.accessToken);
  await auth.logout(req(first.accessToken));assert.equal(await auth.authenticate(req(first.accessToken)),null);
  record.active=false;assert.equal(await auth.authenticate(req(second.accessToken)),null);record.active=true;
  now=new Date("2026-11-19T08:00:00Z");assert.equal(await auth.authenticate(req(second.accessToken)),null);
  permit=false;await assert.rejects(()=>auth.login(req("none"),{username:"admin135",password:"synthetic-only-pass"}),/過多/);
});

test("後端前端client完整讀取／消費流程；讀取使用POST，舊SW不能快取；離線不轉本機",async()=>{
  const originalFetch=globalThis.fetch;
  const now=new Date("2026-11-19T04:00:00Z"),member={id:"m1",role:"member",name:"測試",phone:"9123 4567",joined_date:"2026-01-01",active:true};
  let data={profiles:[member],catalog:[{id:"svc",kind:"service",name:"染髮",price:600,active:true}],stylists:[{id:"sty",active:true}],assistants:[],appointments:[],sales:[],saleItems:[],stampLedger:[],referrals:[],auditLog:[],rewardWallets:{m1:createRewardWallet(member,now)}};
  const actor={id:"sally",username:"sally",name:"Sally",role:"admin",active:true};
  const handler=createGateway({repository:{read:async()=>structuredClone(data),transaction:async fn=>{const copy=structuredClone(data);const result=await fn(copy);data=copy;return result;}},auth:{authenticate:async r=>r.headers.get("Authorization")==="Bearer session"?actor:null,login:async()=>({accessToken:"session",profile:actor}),logout:async()=>{}},allowedOrigins:["https://mssallyct.github.io"],clock:()=>now});
  const requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return handler(new Request(url,{...options,headers:{...options.headers,Origin:"https://mssallyct.github.io"}}));};
  try{
    const client=new BackendApi({backendUrl:"https://backend.test/api"});assert.equal(await client.getSession(),null);
    await client.signIn("sally","unused-synthetic");assert.equal((await client.getProfile()).username,"sally");
    const workspace=await client.getAdminDashboard();assert.equal(Object.hasOwn(workspace.profiles[0],"phone"),false);
    const r=await client.completeSale({requestId:"stable-checkout-123",memberId:"m1",stylistId:"sty",items:[{catalogId:"svc",quantity:1,unitPrice:0,name:"fake"}],expectedFinalAmount:600});assert.equal(r.receipt.finalAmount,600);
    assert.ok(requests.every(r=>r.options.method==="POST"));assert.ok(requests.every(r=>r.options.cache==="no-store"));
    globalThis.fetch=async()=>{throw new Error("offline");};await assert.rejects(()=>client.getAdminDashboard(),/offline/);assert.equal(client.demoMode,false);
  }finally{globalThis.fetch=originalFetch;}
});

test("PostgreSQL adapter用鎖及參數化寫入；錯誤回滾且釋放連線",async()=>{
  const queries=[];let released=0;
  const client={query:async(sql,params)=>{queries.push({sql,params});return {rows:sql.startsWith("SELECT")?[{document:{profiles:[],count:1}}]:[]};},release:()=>released++};
  const repository=new PostgresRepository({connect:async()=>client,query:client.query});
  const result=await repository.transaction(data=>{data.count++;return data.count;});assert.equal(result,2);
  assert.ok(queries.some(q=>q.sql.includes("FOR UPDATE")));assert.ok(queries.some(q=>q.sql.includes("$1::jsonb") && JSON.parse(q.params[0]).count===2));assert.equal(queries.at(-1).sql,"COMMIT");assert.equal(released,1);
  queries.length=0;await assert.rejects(()=>repository.transaction(()=>{throw new Error("stop");}),/stop/);assert.equal(queries.at(-1).sql,"ROLLBACK");assert.ok(!queries.some(q=>q.sql.startsWith("UPDATE")));assert.equal(released,2);
});

test("資料分頁讀齊超過1000筆，不截短歷史；讀到不同版本則停止",async()=>{
  const previousFetch=globalThis.fetch;const rows=Array.from({length:1203},(_,i)=>({id:`s${i}`,final_amount:i}));let drift=false;
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.pathname.endsWith("/workspace"))return Response.json({paged:true,revision:"v1",collections:["sales"]});
    const cursor=Number(u.searchParams.get("cursor"));
    return Response.json({items:rows.slice(cursor,cursor+250),nextCursor:cursor+250<rows.length?cursor+250:null,revision:drift && cursor>0?"v2":"v1"});
  };
  try{const client=new BackendApi({backendUrl:"https://backend.test/api"});assert.deepEqual((await client.getAdminDashboard()).sales,rows);drift=true;await assert.rejects(()=>client.getAdminDashboard(),/不完整/);}finally{globalThis.fetch=previousFetch;}
});

test("資料庫TLS必須驗證憑證，URL不能關閉驗證；缺設定永遠不連資料庫",async()=>{
  const options=databaseOptions("postgres://test:synthetic@db.example.test/khair?sslmode=no-verify&ssl=false&host=elsewhere");
  assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(new URL(options.connectionString).search,"");
  const handler=await configuredGateway({});assert.equal((await handler(new Request("https://backend.test/api/members"))).status,503);
});
