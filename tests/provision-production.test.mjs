import test from 'node:test';
import assert from 'node:assert/strict';
import { provisioningInput } from '../scripts/provision-production.mjs';
import { ACCOUNT_NAMES } from '../js/access-policy.js';
import { initializeBusinessState } from '../server/setup.mjs';
const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),KHAIR_BOOTSTRAP_COMMIT:'a'.repeat(40),POSTGRES_URL:'postgres://synthetic:synthetic@db.example.test/test',KHAIR_ALLOWED_ORIGINS:'https://khair.example.test',KHAIR_BOOTSTRAP_PASSWORDS:JSON.stringify(Object.fromEntries(ACCOUNT_NAMES.map(n=>[n,'synthetic-test-only'])))};
test('provisioning is off without a secret and pinned to exact production source',()=>{
  assert.equal(provisioningInput({}),null);
  assert.throws(()=>provisioningInput({...env,VERCEL_ENV:'preview'}));
  assert.throws(()=>provisioningInput({...env,VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)}));
  assert.throws(()=>provisioningInput({...env,KHAIR_BOOTSTRAP_PASSWORDS:'{}'}));
  assert.throws(()=>provisioningInput({...env,KHAIR_ALLOWED_ORIGINS:'*'}));
  assert.equal(provisioningInput(env).url,env.POSTGRES_URL);
});
test('production starts with 30 services and 21 products but no sample people or sales',async()=>{
  let data;await initializeBusinessState({query:async(sql,args)=>{assert.match(sql,/ON CONFLICT \(singleton\) DO NOTHING/);data=JSON.parse(args[0]);}});
  assert.equal(data.catalog.filter(p=>p.kind==='service').length,30);
  assert.equal(data.catalog.filter(p=>p.kind==='product').length,21);
  for(const k of ['profiles','sales','saleItems','stampLedger','appointments'])assert.equal(data[k].length,0);
});
