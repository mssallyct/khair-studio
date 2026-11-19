import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createTestingApi,TEST_KEY} from '../dist/test/js/testing-api.js';
import {quoteRewards} from '../dist/test/js/loyalty-v2.js';
const values=new Map(),accessed=[];
const storage={getItem(k){accessed.push(k);return values.get(k)??null;},setItem(k,v){accessed.push(k);values.set(k,v);}};
const clock=()=>new Date('2026-11-19T04:00:00Z');
const api=await createTestingApi({storage,clock});
for(const name of ['howood','sally','Admin135','Admin268','Admin567','Admin889','Admin233']){
  await api.signIn(name);const d=await api.getAdminDashboard();
  assert.equal(JSON.stringify(d).includes('90000001'),name==='howood');
  const matches=await api.searchMembers('90000001');assert.equal(matches[0].id,'test-member-0');assert.equal(Object.hasOwn(matches[0],'phone'),name==='howood');
  if(name.startsWith('Admin'))await assert.rejects(api.createStylist('不應新增'));
  await api.signOut();
}
await api.signIn('howood');
for(const [memberId,kind] of [['test-member-0','hair10'],['test-member-1','stamp4'],['test-member-2','stamp8']]){
  const d=await api.getAdminDashboard(),catalog=d.catalog.find(c=>kind==='hair10'?c.name==='洗剪吹':c.kind==='service'&&Number(c.price)===650);
  assert.ok(catalog);const requestId=`sandbox-transaction-${kind}`,items=[{catalogId:catalog.id,name:catalog.name,kind:catalog.kind,reward_group:catalog.reward_group,unitPrice:catalog.price,quantity:1}];
  const q=quoteRewards({wallet:d.rewardWallets[memberId],items,saleId:requestId,at:clock()});
  const coupon=q.wallet.coupons.find(c=>c.kind===kind);assert.ok(coupon);
  const input={requestId,memberId,stylistId:'test-stylist',items,couponId:kind==='hair10'?null:coupon.id};
  await api.completeSale(input);await api.completeSale(input);
}
const d=await api.getAdminDashboard();assert.equal(d.sales.length,3);assert.equal(d.rewardWallets['test-member-0'].hairVisits,0);assert.equal(d.rewardWallets['test-member-1'].stampProgress,4);assert.equal(d.rewardWallets['test-member-2'].stampProgress,0);
await assert.rejects(api.importLegacy({}));
const restored=await createTestingApi({storage,clock});await restored.signIn('sally');assert.equal((await restored.getAdminDashboard()).sales.length,3);
assert.deepEqual([...new Set(accessed)],[TEST_KEY]);
const ref=process.env.KHAIR_STABLE_REF||'2469ba7';
for(const file of ['js/app.js','js/api.js','js/demo-store.js','config.example.js'])assert.equal(await readFile(`dist/${file}`,'utf8'),execFileSync('git',['show',`${ref}:${file}`],{encoding:'utf8'}));
assert.match(await readFile('dist/test/index.html','utf8'),/功能測試版/);
assert.doesNotMatch(await readFile('dist/test/server/gateway.mjs','utf8'),/node:crypto|createHash/);
console.log('PASS: 7 test roles, 4/8/10 same-bill discounts, idempotence, storage isolation, reload, original app preserved.');
