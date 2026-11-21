import { createHash, randomUUID } from "node:crypto";
import { normalizeBirthday, normalizeHongKongPhone } from "../js/rules.js";
import { dateOnly, membershipYear } from "../js/loyalty-v2.js";
import { normalizeRemarks } from "../js/member-remarks.js";

// Insert-only, transaction-scoped spreadsheet import. No guessed dates, balances,
// sales, or retroactive discount coupons. Source blanks remain null.
export function importMemberRows(data,input,actor,at=new Date()){
  if(!/^[a-f0-9]{64}$/.test(input.sourceHash || "") || !Array.isArray(input.rows) || !input.rows.length || input.rows.length>50)throw new Error("匯入來源或批次格式錯誤。");
  const timestamp=at.toISOString(),added=[],skipped=[];
  const imports=(data.memberImports ||= {}),source=(imports[input.sourceHash] ||= {rows:{},created_at:timestamp});
  const seen=new Set();
  for(const row of input.rows){
    if(!Number.isInteger(row.sourceRow) || row.sourceRow<2 || seen.has(row.sourceRow))throw new Error("Excel行號重複或無效。");
    seen.add(row.sourceRow);
    const name=String(row.name || "").trim();if(!name || name.length>80)throw new Error(`第${row.sourceRow}行：姓名無效。`);
    const phone=row.phone==null || row.phone==="" ? null : normalizeHongKongPhone(row.phone);
    const birthday=normalizeBirthday(row.birthday);
    const joined=row.joinedDate==null || row.joinedDate==="" ? null : dateOnly(row.joinedDate);
    if(joined)membershipYear(joined,at);
    for(const [key,max] of [["stamps",7],["hairVisits",9]])if(row[key]!==null && (!Number.isInteger(row[key]) || row[key]<0 || row[key]>max))throw new Error(`第${row.sourceRow}行：優惠數量無效；未填須留空。`);
    const remarks=normalizeRemarks(row.remarks);
    const normalized={name,phone,birthday,joined,stamps:row.stamps,hairVisits:row.hairVisits,remarks};
    const fingerprint=createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const prior=source.rows[row.sourceRow];
    if(prior){if(prior.fingerprint!==fingerprint)throw new Error(`第${row.sourceRow}行已匯入，但內容不同；禁止覆蓋。`);skipped.push(prior.id);continue;}
    if(phone && data.profiles.some(p=>p.role==="member" && String(p.phone || "").replace(/\D/g,"")===phone.replace(/\D/g,"")))throw new Error(`第${row.sourceRow}行：電話已存在，未有合併或覆蓋。`);
    if(!phone && data.profiles.some(p=>p.role==="member" && p.name.trim().toLowerCase()===name.toLowerCase()))throw new Error(`第${row.sourceRow}行：缺電話且姓名已存在，請先核對。`);
    const id=`member-${randomUUID()}`;
    data.profiles.push({id,role:"member",active:true,name,phone,email:null,birthday,joined_date:joined,referral_code:null,remarks,created_at:timestamp,created_by:actor.id,import_opening:{stamps:row.stamps,hairVisits:row.hairVisits},import_source:{hash:input.sourceHash,row:row.sourceRow}});
    source.rows[row.sourceRow]={id,fingerprint};added.push(id);
  }
  if(added.length)(data.auditLog ||= []).push({id:randomUUID(),actor_id:actor.id,actor_username:actor.username,actor_name:actor.name,action:"members.spreadsheet_imported",summary:`Excel匯入${added.length}位會員；空白原樣保留，備註未轉成消費，優惠起始資料待核對`,created_at:timestamp});
  return {added:added.length,skipped:skipped.length,ids:[...added,...skipped]};
}
