import test from 'node:test';
import assert from 'node:assert/strict';
import {planImportCouponBackfill,handleImportCouponBackfill} from '../server/import-coupon-backfill.mjs';
import {activateImportedMembers} from '../js/import-activation.js';
import {quoteRewards} from '../js/loyalty-v2.js';
import {createGateway} from '../server/gateway.mjs';
const at=new Date('2026-11-28T04:00:00Z'),activation=new Date('2026-11-21T04:00:00Z'),hash='b'.repeat(64);
const actor={id:'admin-howood',username:'howood',name:'Howood',role:'admin',active:true};
const input={sourceHash:hash,expectedCount:8,policy:'confirmed-import-opening-stamp4-v1'};
function fixture(){
 const data={profiles:Array.from({length:8},(_,i)=>({id:`m${i}`,role:'member',name:`Sample ${i}`,active:true,joined_date:'2026-01-01',import_source:{hash,row:i+2},import_opening:{stamps:i,hairVisits:2}})),sales:[],saleItems:[],stampLedger:[],auditLog:[],rewardWallets:{},referrals:[],appointments:[],catalog:[{id:'svc',name:'染髮',kind:'service',price:600,active:true}],stylists:[{id:'sty',name:'Stylist',active:true}],assistants:[]};
 activateImportedMembers(data,{sourceHash:hash,expectedCount:8,confirmed:true,policy:'source-balances-zero-blanks-no-retroactive-coupons-v1',missingDateAnchor:'2026-11-21'},actor,activation);return data;
}
const items=[{catalogId:'svc',kind:'service',name:'染髮',unitPrice:600,quantity:1}];
function harness(failBackup=false){
 let data=fixture(),backups=[];
 const repository={read:async()=>({...structuredClone(data),__revision:'42'}),saveCleanupBackup:async(client,b)=>{if(failBackup)throw Error('backup failed');client.push(structuredClone(b));},transaction:async fn=>{const next=structuredClone(data),client=[];const result=await fn(next,client);data=next;backups.push(...client);return result;}};
 return {repository,data:()=>data,backups:()=>backups};
}
test('original balances 4–7 receive exactly one first-cycle 10% discount; all counters, receipts, profiles and history preserved',()=>{
 const data=fixture(),before=structuredClone(data),plan=planImportCouponBackfill(data,input,at);assert.deepEqual(data,before);assert.equal(plan.summary.granted,4);assert.equal(plan.summary.belowFour,4);
 for(const key of ['profiles','sales','saleItems','stampLedger','auditLog','appointments','referrals'])assert.deepEqual(plan.next[key],before[key]);
 for(let i=0;i<8;i++){
  const w=plan.next.rewardWallets[`m${i}`],old=before.rewardWallets[`m${i}`];assert.deepEqual({...w,coupons:[]},old);
  assert.equal(w.coupons.length,i>=4?1:0);
  if(i>=4){assert.equal(w.coupons[0].rate,.1);assert.equal(w.coupons[0].kind,'stamp4');assert.equal(w.coupons[0].expiresAt,'2027-01-01T00:00:00+08:00');}
 }
});
test('backfilled 4 and newly earned 8 coupons are selectable on same bill; 8 resets progress, each coupon only once',()=>{
 const data=planImportCouponBackfill(fixture(),input,at).next,w=data.rewardWallets.m7;
 const base=quoteRewards({wallet:w,items,saleId:'eighth-stamp',at});assert.equal(base.receipt.stampProgress,0);assert.deepEqual(base.availableCoupons.map(c=>c.kind),['stamp4','stamp8']);
 const four=quoteRewards({wallet:w,items,saleId:'eighth-stamp',at,couponId:w.coupons[0].id});assert.equal(four.receipt.finalAmount,540);
 const eight=quoteRewards({wallet:w,items,saleId:'eighth-stamp',at,couponId:base.addedCoupons[0].id});assert.equal(eight.receipt.finalAmount,510);
 assert.throws(()=>quoteRewards({wallet:four.wallet,items,saleId:'next-sale',at,couponId:w.coupons[0].id}),/已使用/);
 assert.equal(planImportCouponBackfill({...data,rewardWallets:{...data.rewardWallets,m7:four.wallet}},input,at).summary.granted,0);
});
test('used, existing, expired and inactive opening entitlements are never reissued; original <4 follows normal milestone logic',()=>{
 const data=fixture();data.rewardWallets.m4.coupons.push({id:'existing-used',kind:'stamp4',rate:.1,cycle:'2026-01-01:0',earnedAt:activation.toISOString(),expiresAt:'2027-01-01T00:00:00+08:00',usedAt:at.toISOString(),usedOnSaleId:'old-sale'});
 data.profiles[5].active=false;
 data.rewardWallets.m6.joinedDate='2025-11-25';data.rewardWallets.m6.periodStart='2025-11-25';data.rewardWallets.m6.periodEnd='2026-11-25';
 const plan=planImportCouponBackfill(data,input,at);assert.equal(plan.summary.granted,1);assert.equal(plan.summary.alreadyGranted,1);assert.equal(plan.summary.inactive,1);assert.equal(plan.summary.expired,1);assert.deepEqual(plan.next.rewardWallets.m4,data.rewardWallets.m4);
 const q=quoteRewards({wallet:plan.next.rewardWallets.m3,items,saleId:'natural-four',at});assert.equal(q.addedCoupons[0].kind,'stamp4');
});
test('missing membership date keeps approved anchor and source blanks unchanged',()=>{
 const data=fixture(),m=data.profiles[7];m.joined_date=null;data.rewardWallets.m7.joinedDate='2026-11-21';data.rewardWallets.m7.periodStart='2026-11-21';data.rewardWallets.m7.periodEnd='2027-11-21';
 const plan=planImportCouponBackfill(data,input,at);assert.equal(plan.next.profiles[7].joined_date,null);assert.equal(plan.next.rewardWallets.m7.coupons[0].expiresAt,'2027-11-21T00:00:00+08:00');
});
test('uncertain source, unsupported opening count, wallet mismatch or missing activation metadata fail closed',()=>{
 for(const mutate of [d=>d.profiles[7].import_opening.stamps=8,d=>d.rewardWallets.m7.memberId='other',d=>delete d.rewardWallets.m7.opening,d=>d.rewardWallets.m7.opening.sourceRow=500]){
  const d=fixture();mutate(d);const before=structuredClone(d);assert.throws(()=>planImportCouponBackfill(d,input,at));assert.deepEqual(d,before);
 }
 for(const change of [{expectedCount:7},{sourceHash:'x'},{policy:'other'}])assert.throws(()=>planImportCouponBackfill(fixture(),{...input,...change},at));
});
test('preview read only; apply atomically backs up and audits; retries remain idempotent even after redemption',async()=>{
 const h=harness(),before=structuredClone(h.data());const preview=await handleImportCouponBackfill({...h,principal:actor,input,mode:'preview',now:at});assert.deepEqual(h.data(),before);assert.equal(h.backups().length,0);
 const body={...input,confirmed:true,expectedChecksum:preview.checksum};const result=await handleImportCouponBackfill({...h,principal:actor,input:body,mode:'apply',now:at});assert.equal(result.granted,4);assert.deepEqual(h.backups()[0].document,before);assert.equal(h.data().auditLog.length-before.auditLog.length,5);
 h.data().rewardWallets.m4.coupons[0].usedAt=at.toISOString();const after=structuredClone(h.data());assert.equal((await handleImportCouponBackfill({...h,principal:actor,input:body,mode:'apply',now:at})).alreadyApplied,true);assert.deepEqual(h.data(),after);assert.equal(h.backups().length,1);
});
test('backup failure, concurrent change and absent confirmation cannot partially grant coupons',async()=>{
 for(const scenario of ['backup','stale','confirmation']){
  const h=harness(scenario==='backup'),before=structuredClone(h.data());const p=await handleImportCouponBackfill({...h,principal:actor,input,mode:'preview',now:at});
  await assert.rejects(handleImportCouponBackfill({...h,principal:actor,input:{...input,confirmed:scenario!=='confirmation',expectedChecksum:scenario==='stale'?'0'.repeat(64):p.checksum},mode:'apply',now:at}));assert.deepEqual(h.data(),before);assert.equal(h.backups().length,0);
 }
});
test('only authenticated Howood can backfill, but all seven admins can select redeemed opening coupons at checkout',async()=>{
 for(const username of ['howood','sally','admin135','admin268','admin567','admin889','admin233',null]){
  const h=harness();Object.assign(h.data(),planImportCouponBackfill(h.data(),input,at).next);
  const gateway=createGateway({repository:h.repository,authenticate:async()=>username?{...actor,username}:null,clock:()=>at});
  const call=(path,body)=>gateway(new Request(`https://example.test/api${path}`,{method:'POST',body:JSON.stringify(body)}));
  assert.equal((await call('/maintenance/import-coupons/preview',input)).status,username==='howood'?200:username?403:401);
  if(!username)continue;
  const couponId=h.data().rewardWallets.m4.coupons[0].id;
  const r=await call('/sales',{requestId:'verified-opening-sale',memberId:'m4',stylistId:'sty',couponId,expectedFinalAmount:540,items:[{catalogId:'svc',quantity:1,unitPrice:600}]});assert.equal(r.status,200);assert.equal((await r.json()).receipt.finalAmount,540);
 }
});
