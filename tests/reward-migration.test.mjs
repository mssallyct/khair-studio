import test from "node:test";
import assert from "node:assert/strict";
import { prepareLegacyImport, reviewedOpening } from "../server/migration.mjs";
import { rewardStatus, adjustRewardStamps } from "../js/loyalty-v2.js";
const at=new Date("2026-11-19T04:00:00Z"),actor={id:"howood",username:"howood"};
function snapshot(){return {profiles:[{id:"m1",name:"會員",role:"member",phone:"91234567",created_at:"2020-01-01T00:00:00Z"}],sales:[{id:"old",member_id:"m1",final_amount:252}],saleItems:[{id:"line",sale_id:"old",name:"洗剪吹",unit_price:280}],stampLedger:[{id:"stamp",member_id:"m1",delta:3}],catalog:[],stylists:[],assistants:[],appointments:[],referrals:[],auditLog:[],customLegacyField:{preserve:true}};}

test("匯入整份舊資料先保留原始私有備份、不重算消費、不猜新制結餘",()=>{
  const old=snapshot(),before=JSON.stringify(old);const result=prepareLegacyImport({profiles:[],sales:[]},old,actor,at);
  assert.equal(JSON.stringify(old),before);assert.equal(JSON.stringify(result.data.legacyImportBackup.document),before);
  for(const key of ["profiles","sales","saleItems","stampLedger"])assert.deepEqual(result.data[key],old[key]);
  assert.deepEqual(result.data.rewardWallets,{});assert.equal(result.data.auditLog.at(-1).actor_username,"howood");
  assert.equal(prepareLegacyImport(result.data,old,actor,at).alreadyImported,true);
  assert.throws(()=>prepareLegacyImport(result.data,{...old,sales:[{id:"other"}]},actor,at),/不能覆蓋/);
});

test("損壞或不完整來源不能覆蓋；核對開戶不修改舊建立日期",()=>{
  const old=snapshot();delete old.saleItems;assert.throws(()=>prepareLegacyImport({profiles:[]},old,actor,at),/缺少/);
  const member=snapshot().profiles[0],before=JSON.stringify(member),input={joinedDate:"2026-01-01",stampProgress:3,hairVisits:9,stamp4Coupons:1,stamp8Coupons:0,hairCoupons:1,reason:"按原有帳簿核對",confirmed:true};
  const wallet=reviewedOpening(member,input,at);assert.equal(JSON.stringify(member),before);
  assert.equal(rewardStatus(wallet,at).available.length,2);assert.equal(wallet.stampProgress,3);assert.equal(wallet.hairVisits,9);
  assert.throws(()=>reviewedOpening(member,{...input,confirmed:false},at),/確認/);assert.throws(()=>reviewedOpening(member,{...input,hairVisits:null},at),/不能估算/);
});

test("手動加印可達4／8里程碑；負數不能重發已獲優惠",()=>{
  const wallet=reviewedOpening(snapshot().profiles[0],{joinedDate:"2026-01-01",stampProgress:3,hairVisits:0,stamp4Coupons:0,stamp8Coupons:0,hairCoupons:0,reason:"核對",confirmed:true},at);
  const first=adjustRewardStamps({wallet,delta:1,eventId:"adjust-1",at});assert.equal(first.wallet.stampProgress,4);assert.equal(first.coupons[0].kind,"stamp4");
  assert.throws(()=>adjustRewardStamps({wallet:first.wallet,delta:-1,eventId:"adjust-2",at}),/不能直接扣減/);
  const second=adjustRewardStamps({wallet:first.wallet,delta:4,eventId:"adjust-3",at});assert.equal(second.wallet.stampProgress,0);assert.equal(second.coupons[0].kind,"stamp8");
});
