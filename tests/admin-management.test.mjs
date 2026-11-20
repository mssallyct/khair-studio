import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGateway } from '../server/gateway.mjs';
import { createAuth } from '../server/auth.mjs';
import { newAdmin } from '../server/admin-management.mjs';
import { verifyPassword, tokenDigest } from '../server/credentials.mjs';
import { can, homeSections } from '../js/access-policy.js';
import { PostgresRepository } from '../server/postgres-repository.mjs';
import { migrationEnabled } from '../scripts/migrate-admin-policy.mjs';

const owner={id:'admin-howood',username:'howood',name:'Howood',role:'admin',active:true};
function harness(){
  const accounts=new Map(),sessions=new Map();
  let data={profiles:[],auditLog:[],sales:[{id:'historic-sale',created_by:'old-admin'}]};
  const repository={
    read:async()=>structuredClone(data),
    transaction:async fn=>{const next=structuredClone(data),result=await fn(next,{});data=next;return result;},
    listAdmins:async()=>[...accounts.values()],
    insertAdmin:async(_,a)=>{if(accounts.has(a.username)){const e=new Error('duplicate');e.status=409;throw e;}accounts.set(a.username,{id:a.id,username:a.username,name:a.name,password_hash:a.passwordHash,active:true});},
    disableAdmin:async(_,id)=>{const row=[...accounts.values()].find(a=>a.id===id);if(!row || row.username==='howood'){const e=new Error('protected');e.status=400;throw e;}row.active=false;for(const [key,s] of sessions)if(s.account_id===id)sessions.delete(key);return row;},
    accountByUsername:async name=>accounts.get(name),accountById:async id=>[...accounts.values()].find(a=>a.id===id),
    attemptLogin:async()=>true,putSession:async s=>sessions.set(s.tokenHash,{account_id:s.accountId,expires_at:s.expiresAt}),sessionByHash:async h=>sessions.get(h),removeSession:async h=>sessions.delete(h)
  };
  const auth=createAuth({repository});
  let principal=owner;
  const gateway=createGateway({repository,auth,authenticate:async()=>principal});
  return {accounts,sessions,auth,data:()=>data,setPrincipal:p=>{principal=p;},call:(path,body={})=>gateway(new Request('https://test.invalid/api'+path,{method:'POST',body:JSON.stringify(body)}))};
}

test('Howood creates dynamic admin, login is DB-backed, disable revokes sessions and preserves history',async()=>{
  const h=harness(),password='synthetic-only-strong-pass';
  const response=await h.call('/admins/create',{username:'New_Stylist',name:'新增管理員',password,role:'owner'});
  assert.equal(response.status,200);
  const id=(await response.json()).id,account=h.accounts.get('new_stylist');
  assert.equal(await verifyPassword(password,account.password_hash),true);
  assert.equal(JSON.stringify(h.data()).includes(password),false);
  const login=await h.auth.login(new Request('https://test.invalid'),{username:'NEW_STYLIST',password});
  assert.equal(login.profile.id,id);assert.equal(can(login.profile,'members'),true);
  for(const permission of ['admins','admins.manage','phone.read','settings','audit','revenue','export'])assert.equal(can(login.profile,permission),false);
  assert.deepEqual(homeSections(login.profile),['pending','today']);
  const req=new Request('https://test.invalid',{headers:{Authorization:'Bearer '+login.accessToken}});
  assert.equal((await h.auth.authenticate(req)).id,id);
  const list=await(await h.call('/query/admins')).text();assert.ok(!list.includes('scrypt$'));assert.ok(!list.includes(password));
  assert.equal((await h.call('/admins/create',{username:'new_stylist',name:'duplicate',password})).status,409);
  assert.equal((await h.call('/admins/disable',{id})).status,200);
  assert.equal(await h.auth.authenticate(req),null);assert.equal(h.sessions.has(tokenDigest(login.accessToken)),false);
  await assert.rejects(()=>h.auth.login(req,{username:'new_stylist',password}),/不正確/);
  assert.deepEqual(h.data().sales,[{id:'historic-sale',created_by:'old-admin'}]);
  assert.equal(h.data().profiles[0].active,false);
  assert.deepEqual(h.data().auditLog.map(a=>a.action),['admin.created','admin.disabled']);
  assert.ok(h.data().auditLog.every(a=>a.actor_username==='howood'));
});

test('admin endpoints reject unauthenticated/Sally/staff, cannot remove Howood or create reserved names',async()=>{
  const h=harness();
  for(const principal of [null,{...owner,id:'sally',username:'sally'},{...owner,id:'staff',username:'staffnew'}]){
    h.setPrincipal(principal);
    for(const path of ['/query/admins','/admins/create','/admins/disable']){
      const r=await h.call(path,{username:'howood',id:'admin-howood',role:'admin'});
      assert.equal(r.status,principal?403:401);
    }
  }
  h.setPrincipal(owner);assert.equal((await h.call('/admins/disable',{id:owner.id})).status,400);
  for(const username of ['howood','HOWOOD','sally','1staff','ab','bad name','x'.repeat(33)])await assert.rejects(()=>newAdmin({username,name:'test',password:'synthetic-only-pass'}));
  await assert.rejects(()=>newAdmin({username:'newstaff',name:'test',password:'short'}));
  assert.equal(h.accounts.size,0);assert.equal(h.data().auditLog.length,0);
});

test('Postgres admin mutations are parameterized, preserve accounts and revoke all target sessions',async()=>{
  const calls=[];
  const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.startsWith('UPDATE')?[{id:'staff-id',username:'staffnew',active:false}]:sql.startsWith('INSERT')?[{id:'staff-id'}]:[]};}};
  const repo=new PostgresRepository({...client,connect:async()=>client});
  await repo.insertAdmin(client,{id:'staff-id',username:'staffnew',name:"name'",passwordHash:'synthetic-hash'});
  await repo.disableAdmin(client,'staff-id');
  assert.equal(calls[0].params[2],"name'");assert.ok(!calls[0].sql.includes("name'"));
  assert.match(calls[1].sql,/username <> 'howood'/);
  assert.equal(calls[2].sql,'DELETE FROM khair_private.sessions WHERE account_id=$1');
  assert.ok(calls.every(c=>!c.sql.includes('DELETE FROM khair_private.admin_accounts')));
});

test('production-only migration changes the username constraint, never account or customer records',async()=>{
  assert.equal(migrationEnabled({}),false);assert.equal(migrationEnabled({VERCEL_ENV:'preview',KHAIR_BACKEND_ENABLED:'true'}),false);
  assert.equal(migrationEnabled({VERCEL_ENV:'production',KHAIR_BACKEND_ENABLED:'true'}),true);
  const sql=await readFile(new URL('../server/admin-policy-migration.sql',import.meta.url),'utf8');
  assert.match(sql,/drop constraint if exists admin_accounts_username_check/);
  assert.doesNotMatch(sql,/\b(delete|truncate|update)\b/i);
});
