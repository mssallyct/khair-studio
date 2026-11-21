import { randomUUID, createHash } from "node:crypto";
import { accountName, can, requirePermission, memberFor, auditFor, privateText, displayDataFor } from "../js/access-policy.js";
import { createRewardWallet, dateOnly, expiryNotices, membershipYear, quoteRewards, adjustRewardStamps } from "../js/loyalty-v2.js";
import { hongKongDateKey, normalizeBirthday, normalizeHongKongPhone, birthdayStampAward } from "../js/rules.js";
import { summarizeRevenue } from "../js/revenue.js";
import { DemoStore } from "../js/demo-store.js";
import { findMembersByPhone } from "../js/member-search.js";
import { prepareLegacyImport, reviewedOpening } from "./migration.mjs";
import { newAdmin } from "./admin-management.mjs";
import { normalizeRemarks } from "../js/member-remarks.js";
import { importMemberRows } from "./member-import.mjs";

// Adapter contract: authenticate verifies a server-side session, never request
// role/username headers. transaction locks the data, commits atomically on success
// and rolls back on error. A process-local Map is NOT a production database.
// This module is preparation, not a deployed or fully wired backend.
export function createGateway({ repository, authenticate, auth, allowedOrigins = [], clock = () => new Date() } = {}) {
  authenticate ||= auth?.authenticate;
  const ready = repository && typeof repository.read === "function" && typeof repository.transaction === "function" && typeof authenticate === "function";
  return async request => {
    const origin = request.headers.get("origin");
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" };
    if (origin && !allowedOrigins.includes(origin)) return reply(403, {error:"來源未獲授權。"}, headers);
    if (origin) Object.assign(headers, {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"});
    if (request.method === "OPTIONS") return new Response(null, {status:204,headers});
    if (!ready) return reply(503, {error:"後端尚未完成設定，未有讀寫會員資料。"}, headers);
    try {
      const requestUrl=new URL(request.url);
      let path = requestUrl.pathname.replace(/^\/api(?=\/|$)/, "");
      const readPost=request.method==="POST" && path.startsWith("/query/");
      if(readPost)path=path.slice(6);
      if(path==="/login" && request.method==="POST"){
        if(!auth?.login)throw failure(503,"登入後端尚未完成設定。");
        const raw=await request.text();if(raw.length>2048)throw failure(413,"請求內容過大。");
        return reply(200,await auth.login(request,JSON.parse(raw)),headers);
      }
      const principal = await authenticate(request);
      if (!accountName(principal)) throw failure(401,"請先登入獲授權的管理員帳戶。");
      const now = clock();
      if(path==="/admins" && (request.method==="GET" || readPost)){
        requirePermission(principal,"admins.manage");
        const rows=await repository.listAdmins();
        return reply(200,rows.map(({id,username,name,active,created_at})=>({id,username,name,active,created_at})),headers);
      }
      if(["/admins/create","/admins/disable"].includes(path) && request.method==="POST"){
        requirePermission(principal,"admins.manage");
        const raw=await request.text();if(Buffer.byteLength(raw)>4096)throw failure(413,"請求內容過大。");
        let input;try{input=JSON.parse(raw);}catch{throw failure(400,"請求格式錯誤。");}
        if(!input || Array.isArray(input) || typeof input!=="object")throw failure(400,"請求格式錯誤。");
        const account=path==="/admins/create" ? await newAdmin(input) : null;
        if(!account && (typeof input.id!=="string" || input.id.length>100 || input.id===principal.id))throw failure(400,"不能刪除自己的 Howood 帳戶。");
        const result=await repository.transaction(async(data,client)=>{
          let row;
          if(account){
            await repository.insertAdmin(client,account);
            row={id:account.id,username:account.username,name:account.name,role:"admin",active:true};
            data.profiles.push(row);
          }else{
            row=await repository.disableAdmin(client,input.id);
            const profile=data.profiles.find(p=>p.id===row.id);if(profile)profile.active=false;
          }
          audit(data,principal,account?"admin.created":"admin.disabled",row.id,`${account?"新增管理員":"刪除／停用管理員"}：${row.username}（${row.name}）`,now.toISOString());
          return {id:row.id};
        });
        return reply(200,result,headers);
      }
      if(path==='/members/search' && request.method==='POST'){
        requirePermission(principal,'phone.search');
        const raw=await request.text();if(raw.length>512)throw failure(413,'搜尋內容過長。');
        const query=String(JSON.parse(raw).query || '');
        if(query.length>80)throw failure(400,'搜尋內容過長。');
        const data=await repository.read();
        // Lookup uses the private source, but never returns phones to other roles.
        return reply(200,findMembersByPhone(data.profiles,query,50).map(m=>memberFor(principal,m)),headers);
      }
      if(path==="/logout" && request.method==="POST"){if(!auth?.logout)throw failure(503,"登入後端尚未完成設定。");await auth.logout(request);return reply(200,{ok:true},headers);}
      if (request.method === "GET" || readPost) {
        if (path === "/session") return reply(200, {id:principal.id,username:principal.username,name:principal.name,role:"admin",active:true}, headers);
        const collection=requestUrl.searchParams.get("collection");
        const permission = path==="/records" ? collection==="auditLog"?"audit":"dashboard" : ({"/home":"dashboard","/workspace":"dashboard","/members":"members","/catalog":"catalog.read","/settings":"settings","/audit":"audit","/export":"export"})[path];
        if (!permission) throw failure(404,"找不到此功能。");
        requirePermission(principal,permission);
        const data = await repository.read();
        let result;
        if(path==="/records"){
          if(!RECORD_COLLECTIONS.includes(collection))throw failure(404,"找不到資料類別。");
          const revision=String(data.__revision || "0");
          if(requestUrl.searchParams.get("revision")!==revision)throw failure(409,"資料剛有更新，請重新載入完整資料後再匯出。");
          const cursor=Number(requestUrl.searchParams.get("cursor") || 0);
          if(!Number.isSafeInteger(cursor) || cursor<0)throw failure(400,"資料頁碼無效。");
          const workspace=workspaceFor(principal,data);
          const rows=collection==="rewardWallets" ? Object.entries(workspace.rewardWallets).map(([id,wallet])=>({id,wallet})) : workspace[collection] || [];
          const items=rows.slice(cursor,cursor+250);
          result={items,nextCursor:cursor+items.length<rows.length?cursor+items.length:null,revision};
        }
        if (path === "/members") result = data.profiles.filter(p=>p.role==="member").map(p=>memberFor(principal,p));
        if (path === "/catalog") result = data.catalog.filter(c=>c.active!==false);
        if (path === "/settings") result = {catalog:data.catalog,stylists:data.stylists,assistants:data.assistants};
        if (path === "/audit") result = auditFor(principal,data.auditLog || []);
        if (path === "/home") {
          const appointment = row => ({id:row.id,memberId:row.member_id,memberName:privateText(principal,data.profiles.find(p=>p.id===row.member_id)?.name),startAt:row.start_at,status:row.status,serviceId:row.service_id,stylistId:row.stylist_id,note:privateText(principal,row.note)});
          result = {pending:data.appointments.filter(a=>a.status==="pending").map(appointment),today:data.appointments.filter(a=>hongKongDateKey(a.start_at)===hongKongDateKey(now)).map(appointment)};
          if (can(principal,"revenue")) Object.assign(result,{revenue:summarizeRevenue(data.sales,now),expiry:expiryNotices(data.profiles.filter(p=>p.role==="member"),data.rewardWallets || {},now)});
        }
        if (path === "/export") result = exportFor(principal,data);
        if (path === "/workspace") result = {paged:true,revision:String(data.__revision || "0"),collections:RECORD_COLLECTIONS.filter(name=>name!=="auditLog" || can(principal,"audit"))};
        return reply(200,protectOutput(principal,result),headers);
      }
      if (request.method !== "POST") throw failure(405,"不支援此操作。");
      const actionName=path.startsWith("/actions/") ? path.slice(9) : null;
      const permission = ({"/members":"members.create","/members/import":"migration","/members/remarks":"members.remarks","/members/joined-date":"members.joined-date","/members/rewards/opening":"members.joined-date","/migration/import":"migration","/sales":"sales.create"})[path] || ACTIONS[actionName];
      if (!permission) throw failure(404,"找不到此功能。");
      requirePermission(principal,permission);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > (path==="/migration/import" ? 5*1024*1024 : 65536)) throw failure(413,"請求內容過大。");
      let body; try { body = JSON.parse(raw); } catch { throw failure(400,"請求格式錯誤。"); }
      if (!body || Array.isArray(body) || typeof body !== "object") throw failure(400,"請求格式錯誤。");
      const result = await repository.transaction(async data => {
        try {
        const timestamp = now.toISOString();
        if(path==="/members/import")return importMemberRows(data,body,principal,now);
        if(path==="/members/remarks"){
          const member=data.profiles.find(p=>p.id===body.memberId && p.role==="member");
          if(!member)throw failure(404,"找不到會員。");
          const version=member.remarks_version || 0;
          if(body.expectedVersion!==version)throw failure(409,"備註剛有更新，請重新整理後再操作。");
          const remarks=normalizeRemarks(member.remarks);
          if(body.operation==="append"){
            const added=normalizeRemarks(body.remarks);if(!added.length)throw failure(400,"請填寫備註。");
            member.remarks=normalizeRemarks([...remarks,...added]);
          }else if(body.operation==="delete"){
            if(!Number.isInteger(body.index) || body.index<0 || body.index>=remarks.length)throw failure(400,"找不到指定備註。");
            remarks.splice(body.index,1);member.remarks=remarks;
          }else throw failure(400,"不支援此備註操作。");
          member.remarks_version=version+1;
          audit(data,principal,body.operation==="append"?"member.remark_added":"member.remark_deleted",member.id,`${body.operation==="append"?"新增":"刪除"}備註（餘下${member.remarks.length}點）`,timestamp);
          return {id:member.id};
        }
        if(path==="/migration/import"){
          if(body.confirmed!==true)throw failure(400,"請先備份及確認匯入來源。");
          const imported=prepareLegacyImport(data,body.snapshot,principal,now);
          Object.assign(data,imported.data);
          return {checksum:imported.checksum,alreadyImported:imported.alreadyImported};
        }
        if(path==="/members/rewards/opening"){
          const member=data.profiles.find(p=>p.id===body.memberId && p.role==="member");
          if(!member)throw failure(404,"找不到會員。");
          if(data.rewardWallets?.[member.id])throw failure(409,"此會員已核對，不能重設優惠紀錄。");
          const wallet=reviewedOpening(member,body,now);wallet.opening.reviewedBy=principal.id;
          member.joined_date=body.joinedDate;(data.rewardWallets ||= {})[member.id]=wallet;
          audit(data,principal,"member.rewards_opening",member.id,`核對起始紀錄：${body.stampProgress}印、${body.hairVisits}次；${body.reason}`,timestamp);
          return {id:member.id};
        }
        if(actionName){
          if(!Array.isArray(body.args) || body.args.length>2)throw failure(400,"請求格式錯誤。");
          if(actionName==="updateAppointmentStatus" && !["pending","confirmed","completed","cancelled","no_show"].includes(body.args[1]))throw failure(400,"預約狀態無效。");
          if(actionName==="adjustStamps"){
            const input=body.args[0],wallet=data.rewardWallets?.[input?.memberId];
            if(!wallet || !String(input.reason||"").trim())throw failure(400,"請選擇已核對會員並填寫原因。");
            const id=randomUUID(),change=adjustRewardStamps({wallet,delta:Number(input.delta),eventId:id,at:now});
            data.rewardWallets[input.memberId]=change.wallet;
            data.stampLedger.push({id,member_id:input.memberId,delta:Number(input.delta),type:"admin_adjustment",reason:input.reason,created_by:principal.id,created_at:timestamp,policy_version:change.wallet.version});
            audit(data,principal,"stamps.adjusted",input.memberId,`${input.delta} · ${input.reason}`,timestamp);return {id};
          }
          // Reuse mutation validations only. No constructor, localStorage,
          // demo login, seeding or migration ever runs in the backend.
          const store=Object.create(DemoStore.prototype);
          store.data=data;store.actor=()=>principal;store.save=()=>{};
          const row=await store[actionName](...body.args);
          return {id:row.id};
        }
        if (path === "/members") {
          const joined = dateOnly(body.joinedDate); membershipYear(joined,now);
          const name = String(body.name || "").trim();
          if (!name || name.length>80) throw failure(400,"請填寫有效會員姓名。");
          const phone = normalizeHongKongPhone(body.phone), birthday = normalizeBirthday(body.birthday);
          if (data.profiles.some(p=>String(p.phone || "").replace(/\D/g,"")===phone.replace(/\D/g,""))) throw failure(409,"會員資料已登記。");
          const member = {id:`member-${randomUUID()}`,name,phone,birthday,email:String(body.email||"").trim(),remarks:normalizeRemarks(body.remarks),joined_date:joined,role:"member",active:true,created_at:timestamp,created_by:principal.id};
          data.profiles.push(member);
          (data.rewardWallets ||= {})[member.id] = createRewardWallet(member,now);
          if(body.referrerId){
            if(!data.profiles.some(p=>p.id===body.referrerId && p.role==="member" && p.active!==false))throw failure(400,"請選擇有效介紹人。");
            data.referrals.push({id:randomUUID(),referrer_id:body.referrerId,referred_member_id:member.id,awarded_at:null});
          }
          audit(data,principal,"member.created",member.id,"新增會員",timestamp);
          return {id:member.id};
        }
        if (path === "/members/joined-date") {
          const member = data.profiles.find(p=>p.id===body.memberId && p.role==="member");
          if (!member) throw failure(404,"找不到會員。");
          const joined = dateOnly(body.joinedDate); membershipYear(joined,now);
          const wallet=data.rewardWallets?.[member.id];
          if (wallet && (Object.keys(wallet.receipts || {}).length || Object.keys(wallet.adjustments || {}).length || wallet.stampProgress || wallet.hairVisits || wallet.coupons?.length)) throw failure(409,"已有新制優惠，請先核對印花有效期，不能直接改期。");
          // Recording a date does not import balances or grant retroactive rewards.
          const previous = member.joined_date || null;
          member.joined_date = joined;
          if (data.rewardWallets?.[member.id]) data.rewardWallets[member.id] = createRewardWallet(member,now);
          audit(data,principal,"member.joined_date_updated",member.id,`入會日期：${previous || "未記錄"} → ${joined}`,timestamp);
          return {id:member.id,joinedDate:joined};
        }
        const requestId = String(body.requestId || "");
        if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw failure(400,"缺少交易防重複編號。");
        const fingerprint = createHash("sha256").update(JSON.stringify([body.memberId,body.items,body.couponId || null,body.stylistId,body.assistantId || null,body.appointmentId || null])).digest("hex");
        const previous = data.checkoutRequests?.[requestId];
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw failure(409,"此交易編號已用於另一宗消費。");
          return previous.result;
        }
        const member = data.profiles.find(p=>p.id===body.memberId && p.role==="member" && p.active!==false);
        if (!member) throw failure(404,"找不到有效會員。");
        const wallet = data.rewardWallets?.[member.id];
        if (!wallet) throw failure(409,"請先核對此會員的新制起始紀錄；舊紀錄未有改動。");
        if(wallet.memberId!==member.id)throw failure(409,"會員優惠紀錄不一致，已停止交易。");
        if (!data.stylists.some(p=>p.id===body.stylistId && p.active!==false) || body.assistantId && !data.assistants.some(p=>p.id===body.assistantId && p.active!==false)) throw failure(400,"請選擇有效跟進人員。");
        if (!Array.isArray(body.items) || body.items.length>100) throw failure(400,"消費項目無效。");
        const items = body.items.map(line=>{
          const catalog = data.catalog.find(c=>c.id===line.catalogId && c.active!==false);
          if (!catalog) throw failure(400,"請選擇現行項目。");
          return {catalogId:catalog.id,name:catalog.name,kind:catalog.kind,reward_group:catalog.reward_group,unitPrice:Number(catalog.price),quantity:Number(line.quantity)};
        });
        const appointment=body.appointmentId ? data.appointments.find(a=>a.id===body.appointmentId && a.member_id===member.id && ["pending","confirmed"].includes(a.status)) : null;
        if(body.appointmentId && !appointment)throw failure(409,"此預約已處理或不屬於此會員。");
        const calculated = quoteRewards({wallet,items,saleId:requestId,couponId:body.couponId || null,at:now,birthdayBonus:birthdayStampAward(member,data.stampLedger,now)});
        const r = calculated.receipt;
        if(body.expectedFinalAmount!=null && Math.round(Number(body.expectedFinalAmount)*100)!==Math.round(r.finalAmount*100))throw failure(409,"項目價格或優惠狀態已更新，請重新載入及確認實收金額。");
        const sale = {id:requestId,member_id:member.id,appointment_id:appointment?.id || null,stylist_id:body.stylistId,assistant_id:body.assistantId || null,subtotal:r.subtotal,discount:r.discount,final_amount:r.finalAmount,discount_label:r.discountLabel,completed_at:timestamp,completed_by:principal.id,policy_version:r.policyVersion};
        data.sales.push(sale);
        for (const line of items) data.saleItems.push({id:randomUUID(),sale_id:requestId,catalog_id:line.catalogId,name:line.name,kind:line.kind,quantity:line.quantity,unit_price:line.unitPrice});
        data.rewardWallets[member.id] = calculated.wallet;
        for(const [type,delta,reason] of [["spending",r.earnedStamps,`新制消費印花；計印花金額HK$${r.stampEarningAmount}`],["birthday",r.bonusStamps,`${hongKongDateKey(now).slice(0,4)} 生日月份獎賞`]])if(delta)data.stampLedger.push({id:randomUUID(),member_id:member.id,delta,type,reason,sale_id:requestId,created_by:principal.id,created_at:timestamp,policy_version:r.policyVersion});
        const referral=data.referrals.find(row=>row.referred_member_id===member.id && !row.awarded_at);
        if(referral && r.stampEarningAmount>0){
          const referrerWallet=data.rewardWallets?.[referral.referrer_id];
          if(!referrerWallet)throw failure(409,"介紹人的新制起始紀錄尚未核對；本次消費未有寫入。");
          const id=`ref-${requestId}`;
          data.rewardWallets[referral.referrer_id]=adjustRewardStamps({wallet:referrerWallet,delta:1,eventId:id,at:now}).wallet;
          referral.awarded_at=timestamp;
          data.stampLedger.push({id,member_id:referral.referrer_id,delta:1,type:"referral",reason:`成功介紹 ${member.name}`,sale_id:requestId,created_by:principal.id,created_at:timestamp,policy_version:r.policyVersion});
        }
        if(appointment)appointment.status="completed";
        audit(data,principal,"sale.completed",requestId,`完成消費 HK$${r.finalAmount}`,timestamp);
        const result = {saleId:requestId,receipt:r};
        (data.checkoutRequests ||= {})[requestId] = {fingerprint,result};
        return result;
        } catch(error) { if(!error.status)error.status=400;throw error; }
      });
      return reply(200,protectOutput(principal,result),headers);
    } catch (error) {
      return reply(error.status || 500,{error:error.status ? error.message : "未能確認操作結果；請保留同一交易編號重試或重新整理核對，請勿重複收款。"},headers);
    }
  };
}

function reply(status,data,headers) { return new Response(JSON.stringify(data),{status,headers}); }
function failure(status,message) { const e=new Error(message);e.status=status;return e; }
function audit(data,actor,action,id,summary,at) { (data.auditLog ||= []).push({id:randomUUID(),actor_id:actor.id,actor_username:actor.username,actor_name:actor.name,action,target_id:id,summary,created_at:at}); }

function exportFor(principal,data) {
  requirePermission(principal,"export");
  // Explicit collection allowlist: never serialize session/credential tables.
  return workspaceFor(principal,data);
}

const ACTIONS=Object.freeze({createAppointment:"appointments.write",updateAppointmentStatus:"appointments.write",cancelAppointment:"appointments.write",createCatalogItem:"catalog.write",updateCatalogItem:"catalog.write",deleteCatalogItem:"catalog.write",createStylist:"team.write",deleteStylist:"team.write",createAssistant:"team.write",deleteAssistant:"team.write",adjustStamps:"stamps.adjust"});
const RECORD_COLLECTIONS=Object.freeze(["profiles","appointments","sales","saleItems","stamps","referrals","catalog","stylists","assistants","auditLog","rewardWallets"]);
function workspaceFor(principal,data){
  const wallets=Object.fromEntries(Object.entries(data.rewardWallets || {}).map(([id,w])=>[id,{version:w.version,memberId:w.memberId,joinedDate:w.joinedDate,periodStart:w.periodStart,periodEnd:w.periodEnd,stampProgress:w.stampProgress,stampCycle:w.stampCycle,hairVisits:w.hairVisits,coupons:w.coupons.filter(c=>!c.usedAt && !c.expired),receipts:{},adjustments:{}}]));
  const newest=(rows,key)=>[...rows].sort((a,b)=>(Date.parse(b[key])||0)-(Date.parse(a[key])||0) || String(a.id).localeCompare(String(b.id)));
  return {profiles:data.profiles.map(p=>p.role==="member" ? memberFor(principal,p) : {id:p.id,name:p.name,username:p.username,role:p.role,active:p.active}),appointments:newest(data.appointments,"start_at"),sales:newest(data.sales,"completed_at"),saleItems:data.saleItems,stamps:newest(data.stampLedger,"created_at"),referrals:data.referrals,catalog:data.catalog,stylists:data.stylists,assistants:data.assistants,rewardWallets:wallets,auditLog:can(principal,"audit") ? auditFor(principal,newest(data.auditLog || [],"created_at")) : []};
}

export function protectOutput(principal,value) {
  return displayDataFor(principal,{payload:value}).payload;
}
