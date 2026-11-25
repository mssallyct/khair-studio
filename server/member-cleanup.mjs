import { createHash } from 'node:crypto';

function fail(message){const error=new Error(message);error.status=409;throw error;}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>k!=='__revision').map(k=>[k,canonical(value[k])]));
  return value;
}
export const cleanupChecksum=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function validateCleanupInput(input){
  if(!input || !/^[a-zA-Z0-9_-]{12,100}$/.test(input.operationId || '') || !Array.isArray(input.members) || !input.members.length || input.members.length>7)fail('清理範圍或操作編號無效。');
  for(const m of input.members)if(!m || typeof m.id!=='string' || !m.id || m.id.length>100 || typeof m.name!=='string' || !m.name || m.name.length>120)fail('必須提供每位會員的確實編號及姓名。');
  if(new Set(input.members.map(m=>m.id)).size!==input.members.length || input.revokeReferralRewards!==true)fail('必須核對會員及確認撤回相關介紹獎賞。');
  return cleanupChecksum(input.members.map(({id,name})=>({id,name})).sort((a,b)=>a.id.localeCompare(b.id)));
}

// Fail closed for external reward dependencies: never guess a surviving
// member's balance or rewrite a completed real transaction. This maintenance
// operation is intentionally limited to small, precisely identified batches.
export function planMemberCleanup(data,input){
  const scopeChecksum=validateCleanupInput(input);
  const previous=data.memberCleanupOperations?.[input.operationId];
  if(previous){if(previous.scopeChecksum!==scopeChecksum)fail('操作編號已用於另一組會員。');return {alreadyApplied:true,result:previous};}
  for(const expected of input.members){
    const matches=data.profiles.filter(p=>p.id===expected.id);
    if(matches.length!==1 || matches[0].role!=='member' || matches[0].name!==expected.name)fail('會員編號／姓名不相符，或目標不是會員；未有刪除。');
  }
  const ids=new Set(input.members.map(m=>m.id));
  const sales=data.sales.filter(s=>ids.has(s.member_id)),saleIds=new Set(sales.map(s=>s.id));
  const appointments=data.appointments.filter(a=>ids.has(a.member_id)),appointmentIds=new Set(appointments.map(a=>a.id));
  const referrals=data.referrals.filter(r=>ids.has(r.referrer_id)||ids.has(r.referred_member_id));
  if(referrals.some(r=>r.awarded_at&&!ids.has(r.referrer_id)) || data.stampLedger.some(r=>saleIds.has(r.sale_id)&&!ids.has(r.member_id)))fail('有其他會員已取得相關獎賞，需要先核對其兌換記錄；未有刪除。');
  const next=structuredClone(data);delete next.__revision;
  const removedIds=new Set([...ids,...saleIds,...appointmentIds,...referrals.map(r=>r.id)]),counts={};
  function remove(collection,predicate){
    const rows=next[collection] || [],removed=rows.filter(predicate);
    counts[collection]=removed.length;
    for(const row of removed)if(row.id)removedIds.add(row.id);
    next[collection]=rows.filter(row=>!predicate(row));
  }
  remove('profiles',p=>ids.has(p.id));
  remove('sales',s=>saleIds.has(s.id));
  remove('saleItems',s=>saleIds.has(s.sale_id));
  remove('appointments',a=>appointmentIds.has(a.id));
  remove('referrals',r=>ids.has(r.referrer_id)||ids.has(r.referred_member_id));
  remove('stampLedger',s=>ids.has(s.member_id)||saleIds.has(s.sale_id));
  remove('auditLog',r=>removedIds.has(r.target_id)||removedIds.has(r.targetId));
  counts.rewardWallets=0;
  for(const id of ids)if(Object.hasOwn(next.rewardWallets || {},id)){delete next.rewardWallets[id];counts.rewardWallets++;}
  for(const [key,predicate] of [
    ['checkoutRequests',(id,r)=>saleIds.has(id)||saleIds.has(r.result?.saleId)||ids.has(r.result?.receipt?.memberId)],
    ['appointmentRequests',(_id,r)=>appointmentIds.has(r.result?.id)||ids.has(r.result?.memberId)]
  ]){
    counts[key]=0;
    for(const [id,r] of Object.entries(next[key] || {}))if(predicate(id,r)){delete next[key][id];counts[key]++;}
  }
  // Surface unhandled live links, including unknown future collections. Private
  // historical backups and cleanup receipts are deliberately retained.
  const unresolved=[];
  function scan(value,path){
    if(typeof value==='string' && [...removedIds].some(id=>value.includes(id)))unresolved.push(path);
    else if(value && typeof value==='object')for(const [key,v] of Object.entries(value)){
      if(removedIds.has(key))unresolved.push(`${path}.${key}`);
      scan(v,`${path}.${key}`);
    }
  }
  for(const [key,value] of Object.entries(next))if(!['legacyImportBackup','memberCleanupOperations'].includes(key))scan(value,key);
  const summary={counts,removedRevenue:Math.round(sales.reduce((n,s)=>n+Math.round(Number(s.final_amount)*100),0))/100,removedReferralAwards:referrals.filter(r=>r.awarded_at).length,remainingMembers:next.profiles.filter(p=>p.role==='member').length,unresolved};
  return {scopeChecksum,checksum:cleanupChecksum(data),summary,next};
}

export async function handleMemberCleanup({repository,principal,input,mode,now}){
  if(principal?.role!=='admin' || principal.active!==true || principal.username!=='howood'){const error=new Error('只有 Howood 可以清理會員。');error.status=403;throw error;}
  validateCleanupInput(input);
  if(mode==='preview'){
    const plan=planMemberCleanup(await repository.read(),input);
    return plan.alreadyApplied ? {alreadyApplied:true,...plan.result} : {checksum:plan.checksum,scopeChecksum:plan.scopeChecksum,...plan.summary};
  }
  if(mode!=='apply' || input.confirmed!==true || !/^[a-f0-9]{64}$/.test(input.expectedChecksum || '') || typeof repository.saveCleanupBackup!=='function')fail('必須先核對預覽及設定交易內備份；未有刪除。');
  return repository.transaction(async(data,client)=>{
    const plan=planMemberCleanup(data,input);
    if(plan.alreadyApplied)return {alreadyApplied:true,...plan.result};
    if(plan.checksum!==input.expectedChecksum)fail('資料剛有更新，請重新預覽；未有刪除。');
    if(plan.summary.unresolved.length)fail('仍有未處理的相關記錄，已停止刪除。');
    const backupId=`member-cleanup-${input.operationId}`;
    await repository.saveCleanupBackup(client,{id:backupId,document:data,checksum:plan.checksum,actorId:principal.id});
    const result={operationId:input.operationId,scopeChecksum:plan.scopeChecksum,backupId,backupChecksum:plan.checksum,...plan.summary,completedAt:now.toISOString()};
    (plan.next.memberCleanupOperations ||= {})[input.operationId]=result;
    plan.next.auditLog.push({id:`cleanup-${input.operationId}`,actor_id:principal.id,actor_username:principal.username,actor_name:principal.name,action:'members.cleaned',target_id:input.operationId,summary:`清理${plan.summary.counts.profiles}位會員、${plan.summary.counts.sales}筆消費及相關獎賞；已保留私人復原備份`,created_at:now.toISOString()});
    Object.assign(data,plan.next);
    return result;
  });
}
