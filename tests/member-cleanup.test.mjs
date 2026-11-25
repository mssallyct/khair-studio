import test from 'node:test';
import assert from 'node:assert/strict';
import {planMemberCleanup,handleMemberCleanup,cleanupChecksum} from '../server/member-cleanup.mjs';
import {createGateway} from '../server/gateway.mjs';
import {PostgresRepository} from '../server/postgres-repository.mjs';
const now=new Date('2026-11-25T04:00:00Z');
const actor={id:'admin-howood',name:'Howood',username:'howood',role:'admin',active:true};
const input={operationId:'cleanup-test-batch-001',members:[{id:'target-1',name:'howood'},{id:'target-2',name:'Test B'}],revokeReferralRewards:true};
function fixture(){return {
 profiles:[actor,{id:'target-1',role:'member',name:'howood'},{id:'target-2',role:'member',name:'Test B'},{id:'real-1',role:'member',name:'Real',phone:'90000001'}],
 sales:[{id:'sale-target',member_id:'target-1',final_amount:600},{id:'sale-real',member_id:'real-1',final_amount:700}],
 saleItems:[{id:'line-target',sale_id:'sale-target'},{id:'line-real',sale_id:'sale-real'}],
 appointments:[{id:'apt-target',member_id:'target-2'},{id:'apt-real',member_id:'real-1'}],
 referrals:[{id:'rel-target',referrer_id:'target-2',referred_member_id:'target-1',awarded_at:now.toISOString()},{id:'rel-real',referrer_id:'target-1',referred_member_id:'real-1',awarded_at:now.toISOString()}],
 stampLedger:[{id:'stamp-target',member_id:'target-1',sale_id:'sale-target',delta:1},{id:'ref-sale-target',member_id:'target-2',sale_id:'sale-target',delta:1},{id:'ref-sale-real',member_id:'target-1',sale_id:'sale-real',delta:1},{id:'stamp-real',member_id:'real-1',sale_id:'sale-real',delta:1}],
 rewardWallets:{'target-1':{receipts:{'sale-target':{}},coupons:[{usedAt:now.toISOString()}]},'target-2':{adjustments:{'ref-sale-target':{delta:1}}},'real-1':{stampProgress:1,receipts:{'sale-real':{}},coupons:[]}},
 checkoutRequests:{'sale-target':{result:{saleId:'sale-target'}},'sale-real':{result:{saleId:'sale-real'}}},
 appointmentRequests:{'new-target':{result:{id:'apt-target',memberId:'target-2'}},'new-real':{result:{id:'apt-real',memberId:'real-1'}}},
 auditLog:[{id:'audit-1',target_id:'target-1'},{id:'audit-2',target_id:'sale-target'},{id:'audit-3',target_id:'rel-real'},{id:'audit-real',actor_id:'admin-howood',target_id:'real-1',summary:'Normal action'}],
 catalog:[{id:'svc-real'}],stylists:[{id:'sty-real'}],assistants:[],legacyImportBackup:{document:{profiles:[{id:'target-1'}]}}
};}
function harness(failBackup=false){
 let data=fixture(),backups=[],writes=0;
 const repository={read:async()=>({...structuredClone(data),__revision:'42'}),saveCleanupBackup:async(client,backup)=>{assert.ok(client);if(failBackup)throw Error('Backup failed');client.backups.push(structuredClone(backup));},transaction:async fn=>{const next=structuredClone(data),client={backups:[]};const result=await fn(next,client);data=next;backups.push(...client.backups);writes++;return result;}};
 return {repository,data:()=>data,backups:()=>backups,writes:()=>writes};
}
test('precise cleanup retains Howood admin, real member/sales/wallet, catalog and historical backup',()=>{
 const data=fixture(),before=structuredClone(data),plan=planMemberCleanup(data,input);
 assert.deepEqual(data,before);assert.equal(plan.summary.counts.profiles,2);assert.equal(plan.summary.removedRevenue,600);assert.equal(plan.summary.removedReferralAwards,2);assert.deepEqual(plan.summary.unresolved,[]);
 assert.deepEqual(plan.next.profiles,[before.profiles[0],before.profiles[3]]);
 for(const key of ['sales','saleItems','appointments','stampLedger','auditLog'])assert.deepEqual(plan.next[key],[before[key].at(-1)]);
 assert.deepEqual(plan.next.rewardWallets,{'real-1':before.rewardWallets['real-1']});assert.deepEqual(plan.next.catalog,before.catalog);assert.deepEqual(plan.next.legacyImportBackup,before.legacyImportBackup);
 assert.deepEqual(Object.keys(plan.next.checkoutRequests),['sale-real']);assert.deepEqual(Object.keys(plan.next.appointmentRequests),['new-real']);assert.deepEqual(plan.next.referrals,[]);
});
test('admin targets, mismatched names, duplicates and unconfirmed referrals cannot be deleted',()=>{
 for(const body of [{...input,members:[{id:actor.id,name:actor.name}]},{...input,members:[{id:'target-1',name:'wrong'}]},{...input,members:[input.members[0],input.members[0]]},{...input,revokeReferralRewards:false},{...input,members:[]},{...input,members:Array(8).fill(input.members[0])}])assert.throws(()=>planMemberCleanup(fixture(),body));
});
test('external awarded rewards block without modifying any member, whether legacy stamps or haircut visits',()=>{
 for(const reward_type of [undefined,'stamp','hair_visit']){
  const data=fixture();data.referrals[0]={...data.referrals[0],referrer_id:'real-1',reward_type};const before=structuredClone(data);assert.throws(()=>planMemberCleanup(data,input),/其他會員/);assert.deepEqual(data,before);
 }
 const data=fixture();data.stampLedger.push({id:'external-stamp',member_id:'real-1',sale_id:'sale-target'});assert.throws(()=>planMemberCleanup(data,input),/其他會員/);
});
test('unknown links to removed entities are surfaced and prevent apply',async()=>{
 const h=harness();h.data().futureCollection=[{related:'ref-sale-target'}];const preview=await handleMemberCleanup({...h,principal:actor,input,mode:'preview',now});assert.equal(preview.unresolved.length,1);
 await assert.rejects(handleMemberCleanup({...h,principal:actor,input:{...input,confirmed:true,expectedChecksum:preview.checksum},mode:'apply',now}),/未處理/);assert.equal(h.writes(),0);assert.equal(h.backups().length,0);
});
test('preview read-only, atomic durable backup before apply, safe retry and narrow audit',async()=>{
 const h=harness(),before=structuredClone(h.data());const preview=await handleMemberCleanup({...h,principal:actor,input,mode:'preview',now});assert.equal(h.writes(),0);assert.equal(h.backups().length,0);assert.deepEqual(h.data(),before);
 const body={...input,confirmed:true,expectedChecksum:preview.checksum};const result=await handleMemberCleanup({...h,principal:actor,input:body,mode:'apply',now});assert.equal(result.counts.profiles,2);assert.equal(h.backups().length,1);assert.deepEqual(h.backups()[0].document,before);assert.equal(h.backups()[0].checksum,cleanupChecksum(before));assert.equal(h.data().auditLog.at(-1).actor_id,actor.id);
 const after=structuredClone(h.data());assert.equal((await handleMemberCleanup({...h,principal:actor,input:body,mode:'apply',now})).alreadyApplied,true);assert.deepEqual(h.data(),after);assert.equal(h.backups().length,1);
 await assert.rejects(handleMemberCleanup({...h,principal:actor,input:{...body,members:[input.members[0]]},mode:'apply',now}),/另一組/);
});
test('backup failure, stale preview and missing confirmation leave business records intact',async()=>{
 for(const scenario of ['backup','stale','confirmation']){
  const h=harness(scenario==='backup');const before=structuredClone(h.data()),checksum=cleanupChecksum(before);
  await assert.rejects(handleMemberCleanup({...h,principal:actor,input:{...input,confirmed:scenario!=='confirmation',expectedChecksum:scenario==='stale'?'0'.repeat(64):checksum},mode:'apply',now}));assert.deepEqual(h.data(),before);assert.equal(h.writes(),0);assert.equal(h.backups().length,0);
 }
});
test('checksum ignores read revision and object key ordering, but includes every business update',()=>{
 const d=fixture();assert.equal(cleanupChecksum(d),cleanupChecksum({...Object.fromEntries(Object.entries(d).reverse()),__revision:'15'}));const changed=structuredClone(d);changed.sales[1].final_amount++;assert.notEqual(cleanupChecksum(d),cleanupChecksum(changed));
});
test('gateway accepts only authenticated Howood; rejects other admins and client spoofing',async()=>{
 for(const username of ['howood','sally','admin135','admin268','admin567','admin889','admin233',null]){
  const h=harness(),gateway=createGateway({repository:h.repository,authenticate:async()=>username?{...actor,username}:null,clock:()=>now});
  const r=await gateway(new Request('https://example.test/api/maintenance/member-cleanup/preview',{method:'POST',body:JSON.stringify({...input,username:'howood'})}));assert.equal(r.status,username==='howood'?200:username?403:401);assert.equal(h.writes(),0);
 }
});
test('Postgres backup uses transaction client and parameter binding, never public auth tables',async()=>{
 const calls=[],repo=new PostgresRepository({query(){throw Error('wrong pool')},connect(){}}),client={query:async(...args)=>calls.push(args)},document=fixture();
 await repo.saveCleanupBackup(client,{id:'backup-1',document,checksum:'abc',actorId:actor.id});assert.match(calls[0][0],/INSERT INTO khair_private.migration_backups/);assert.deepEqual(JSON.parse(calls[0][1][1]),document);assert.equal(calls[0][1][3],actor.id);await assert.rejects(repo.saveCleanupBackup(null,{document}));
});
