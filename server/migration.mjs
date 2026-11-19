import { createHash } from "node:crypto";
import { createRewardWallet, membershipYear } from "../js/loyalty-v2.js";
import { prepareServiceCatalogUpdate } from "../js/service-catalog.js";

const COLLECTIONS=["profiles","catalog","stylists","assistants","appointments","sales","saleItems","stampLedger","referrals","auditLog"];
export function prepareLegacyImport(current,snapshot,actor,at=new Date()) {
  if(!snapshot || typeof snapshot!=="object" || Array.isArray(snapshot))throw new Error("備份格式不正確。");
  if(Object.keys(snapshot.rewardWallets || {}).length)throw new Error("此備份已有新制優惠，不能使用舊版本機匯入程序。");
  for(const name of COLLECTIONS)if(!Array.isArray(snapshot[name]))throw new Error(`備份缺少${name}，已停止匯入。`);
  if(!snapshot.profiles.length)throw new Error("備份沒有會員或管理員資料。");
  for(const name of COLLECTIONS){
    const ids=snapshot[name].map(row=>row?.id);
    if(ids.some(id=>typeof id!=="string" || !id) || new Set(ids).size!==ids.length)throw new Error(`備份${name}編號有誤，已停止匯入。`);
  }
  const raw=JSON.stringify(snapshot),checksum=createHash("sha256").update(raw).digest("hex");
  if(current.migration?.checksum===checksum)return {data:current,checksum,alreadyImported:true};
  if(current.migration || current.sales?.length || current.profiles?.some(p=>p.role==="member"))throw new Error("後端已有會員資料，不能覆蓋；請先核對及合併不同裝置的紀錄。");
  let next=structuredClone(current);
  for(const name of COLLECTIONS)next[name]=structuredClone(snapshot[name]);
  // The exact full source is retained privately, including extra legacy fields.
  // It is never returned by workspace/export endpoints or put in the repository.
  next.legacyImportBackup={document:structuredClone(snapshot),checksum};
  next.migration={checksum,imported_at:at.toISOString(),imported_by:actor.id};
  next.rewardWallets={};next.checkoutRequests={};
  if(snapshot.catalogUpdates)next.catalogUpdates=structuredClone(snapshot.catalogUpdates);
  const catalogUpdate=prepareServiceCatalogUpdate(next,actor.id,at.toISOString());
  if(catalogUpdate)next=catalogUpdate.data;
  next.auditLog.push({id:`migration-${checksum.slice(0,16)}`,actor_id:actor.id,actor_username:actor.username,action:"legacy.imported",summary:`匯入 ${snapshot.profiles.filter(p=>p.role==="member").length} 位會員及 ${snapshot.sales.length} 宗消費；舊金額原樣保留，新制起始紀錄待核對`,created_at:at.toISOString()});
  return {data:next,checksum,alreadyImported:false};
}

export function reviewedOpening(member,input,at=new Date()) {
  if(input.confirmed!==true || !String(input.reason || "").trim())throw new Error("請核對並確認新制起始紀錄及填寫原因。");
  const wallet=createRewardWallet({...member,joined_date:input.joinedDate},at);
  for(const [field,max] of [["stampProgress",7],["hairVisits",9],["stamp4Coupons",50],["stamp8Coupons",50],["hairCoupons",50]])if(!Number.isInteger(input[field]) || input[field]<0 || input[field]>max)throw new Error("請填寫有效起始次數及優惠數量，不能估算或留空。");
  wallet.stampProgress=input.stampProgress;wallet.hairVisits=input.hairVisits;
  const period=membershipYear(input.joinedDate,at);
  for(const [key,kind,rate] of [["stamp4Coupons","stamp4",.1],["stamp8Coupons","stamp8",.15],["hairCoupons","hair10",.1]])for(let i=0;i<input[key];i++)wallet.coupons.push({id:`opening-${member.id}-${kind}-${i}`,kind,rate,earnedAt:at.toISOString(),expiresAt:kind==="hair10"?null:period.expiresAt,cycle:"reviewed-opening"});
  wallet.opening={reviewedAt:at.toISOString(),reason:input.reason};
  return wallet;
}
