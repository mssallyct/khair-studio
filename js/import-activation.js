import {createRewardWallet,dateOnly} from './loyalty-v2.js';

// Explicit, owner-approved activation. Original source fields stay untouched.
export function activateImportedMembers(data,input,actor,at=new Date()){
  if(input.confirmed!==true || input.policy!=='source-balances-zero-blanks-no-retroactive-coupons-v1' || !/^[a-f0-9]{64}$/.test(input.sourceHash || ''))throw new Error('請確認匯入會員啟用政策。');
  const anchor=dateOnly(input.missingDateAnchor);
  const members=data.profiles.filter(p=>p.role==='member' && p.import_source?.hash===input.sourceHash);
  if(!Number.isSafeInteger(input.expectedCount) || input.expectedCount<1 || members.length!==input.expectedCount)throw new Error('匯入會員數量不符，未有啟用或覆蓋。');
  data.rewardWallets ||= {};data.stampLedger ||= [];data.auditLog ||= [];
  let activated=0,retained=0,missingDates=0;
  for(const member of members){
    if(data.rewardWallets[member.id]){retained++;continue;}
    const opening=member.import_opening;
    if(!opening)throw new Error('缺少原表起始紀錄。');
    for(const [key,max] of [['stamps',7],['hairVisits',9]])if(opening[key]!==null && (!Number.isInteger(opening[key]) || opening[key]<0 || opening[key]>max))throw new Error('原表起始數量無效。');
    const wallet=createRewardWallet({...member,joined_date:member.joined_date || anchor},at);
    wallet.stampProgress=opening.stamps ?? 0;wallet.hairVisits=opening.hairVisits ?? 0;
    wallet.opening={mode:'import-activation-v1',sourceHash:input.sourceHash,sourceRow:member.import_source.row,activatedAt:at.toISOString(),activatedBy:actor.id,missingDateAnchor:member.joined_date?null:anchor,policy:input.policy};
    data.rewardWallets[member.id]=wallet;activated++;if(!member.joined_date)missingDates++;
    if(wallet.stampProgress)data.stampLedger.push({id:`opening-${member.id}`,member_id:member.id,delta:wallet.stampProgress,type:'opening_balance',reason:'匯入啟用起始結餘（原表），不是新消費印花',created_by:actor.id,created_at:at.toISOString(),policy_version:wallet.version});
  }
  if(activated)data.auditLog.push({id:`activate-${input.sourceHash}-${at.getTime()}`,actor_id:actor.id,actor_username:actor.username,actor_name:actor.name,action:'members.import_activated',summary:`啟用${activated}位匯入會員；保留${retained}位已核對紀錄；空白數字由0開始，${missingDates}位缺入會日期以${anchor}作印花年度起點，未補發舊優惠`,created_at:at.toISOString()});
  return {activated,retained,total:members.length,missingDates};
}
