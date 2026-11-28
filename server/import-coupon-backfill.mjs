import {membershipYear,rewardStatus} from '../js/loyalty-v2.js';
import {cleanupChecksum as stateChecksum} from './member-cleanup.mjs';

const POLICY='confirmed-import-opening-stamp4-v1';
function fail(message){const e=new Error(message);e.status=409;throw e;}
function validate(input){
  if(!input || input.policy!==POLICY || !/^[a-f0-9]{64}$/.test(input.sourceHash || '') || !Number.isSafeInteger(input.expectedCount) || input.expectedCount<1)fail('請核對匯入來源、會員數量及補發政策。');
}

// The approved opening balance is not new spending. Restore only its missing
// first-cycle 4-stamp entitlement; never add stamps, reset progress, extend an
// anniversary, reissue used coupons, or infer an unearned 8-stamp entitlement.
export function planImportCouponBackfill(data,input,at=new Date()){
  validate(input);
  const previous=data.importCouponBackfills?.[input.sourceHash];
  if(previous){if(previous.policy!==POLICY || previous.total!==input.expectedCount)fail('已處理來源的政策或數量不符。');return {alreadyApplied:true,result:previous};}
  const members=data.profiles.filter(p=>p.role==='member' && p.import_source?.hash===input.sourceHash);
  if(members.length!==input.expectedCount)fail('匯入會員數量不符，未有補發。');
  const next=structuredClone(data);delete next.__revision;
  const summary={total:members.length,granted:0,alreadyGranted:0,belowFour:0,expired:0,inactive:0};
  const affected=[];
  for(const member of members){
    if(member.active===false){summary.inactive++;continue;}
    const stamps=member.import_opening?.stamps;
    if(stamps!==null && (!Number.isInteger(stamps) || stamps<0 || stamps>7))fail('原表起始印花紀錄不完整，未有補發。');
    if((stamps??0)<4){summary.belowFour++;continue;}
    const wallet=next.rewardWallets?.[member.id],opening=wallet?.opening;
    if(!wallet || wallet.memberId!==member.id || opening?.mode!=='import-activation-v1' || opening.sourceHash!==input.sourceHash || opening.sourceRow!==member.import_source.row || !Number.isFinite(Date.parse(opening.activatedAt)))fail('會員原表與啟用紀錄未能核對，未有補發。');
    const period=membershipYear(wallet.joinedDate,new Date(opening.activatedAt));
    const status=rewardStatus(wallet,at);
    if(period.start!==status.period.start || Date.parse(period.expiresAt)<=at.getTime()){summary.expired++;continue;}
    const cycle=`${period.start}:0`,id=`import-opening-${member.id}-stamp4`;
    // Canonical server wallets include USED coupons too; never use the public
    // projection (which intentionally omits them) for this migration.
    if(wallet.coupons.some(c=>c.id===id || c.kind==='stamp4' && (c.cycle===cycle || c.cycle==='reviewed-opening'))){summary.alreadyGranted++;continue;}
    if(Object.values(wallet.receipts).some(r=>r.couponId===id))fail('舊優惠使用紀錄不完整，需先核對。');
    wallet.coupons.push({id,kind:'stamp4',rate:.1,earnedAt:at.toISOString(),expiresAt:period.expiresAt,cycle,source:POLICY,sourceHash:input.sourceHash});
    affected.push({memberId:member.id,couponId:id});summary.granted++;
  }
  return {checksum:stateChecksum(data),summary,affected,next};
}

export async function handleImportCouponBackfill({repository,principal,input,mode,now}){
  if(principal?.role!=='admin' || principal.active!==true || principal.username!=='howood'){const e=new Error('只有 Howood 可以確認匯入優惠。');e.status=403;throw e;}
  validate(input);
  if(mode==='preview'){
    const plan=planImportCouponBackfill(await repository.read(),input,now);
    return plan.alreadyApplied ? {alreadyApplied:true,...plan.result} : {checksum:plan.checksum,...plan.summary};
  }
  if(mode!=='apply' || input.confirmed!==true || !/^[a-f0-9]{64}$/.test(input.expectedChecksum || '') || typeof repository.saveCleanupBackup!=='function')fail('必須先預覽、確認及保留交易內備份。');
  return repository.transaction(async(data,client)=>{
    const plan=planImportCouponBackfill(data,input,now);
    if(plan.alreadyApplied)return {alreadyApplied:true,...plan.result};
    if(plan.checksum!==input.expectedChecksum)fail('資料剛有更新，請重新預覽；未有補發。');
    const backupId=`import-coupon-v1-${input.sourceHash}`;
    await repository.saveCleanupBackup(client,{id:backupId,document:data,checksum:plan.checksum,actorId:principal.id});
    const result={policy:POLICY,sourceHash:input.sourceHash,...plan.summary,backupId,backupChecksum:plan.checksum,completedAt:now.toISOString()};
    (plan.next.importCouponBackfills ||= {})[input.sourceHash]=result;
    for(const {memberId,couponId} of plan.affected)plan.next.auditLog.push({id:`grant-${couponId}`,actor_id:principal.id,actor_username:principal.username,actor_name:principal.name,action:'member.import_coupon_granted',target_id:memberId,summary:'已確認原表4印花優惠：補回一次9折，印花進度及原到期日不變',created_at:now.toISOString()});
    plan.next.auditLog.push({id:`coupon-backfill-${input.sourceHash}`,actor_id:principal.id,actor_username:principal.username,actor_name:principal.name,action:'members.import_coupons_confirmed',target_id:input.sourceHash,summary:`核對${result.total}位匯入會員，補回${result.granted}張4印花9折優惠；已用或已發不重複、到期不延長；已保留私人備份`,created_at:now.toISOString()});
    Object.assign(data,plan.next);return result;
  });
}
