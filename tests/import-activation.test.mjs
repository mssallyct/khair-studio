import test from 'node:test';
import assert from 'node:assert/strict';
import {activateImportedMembers} from '../js/import-activation.js';
import {createRewardWallet,quoteRewards,rewardStatus,adjustRewardStamps,expiryNotices} from '../js/loyalty-v2.js';
import {membershipInfo} from '../js/rules.js';
import {memberRewardView} from '../js/reward-views.js';
const now=new Date('2026-11-22T04:00:00Z'),sourceHash='b'.repeat(64);
const actor={id:'admin-howood',username:'howood',name:'Howood'};
const input={sourceHash,confirmed:true,policy:'source-balances-zero-blanks-no-retroactive-coupons-v1',missingDateAnchor:'2026-11-21',expectedCount:470};
function fixture(){return {profiles:Array.from({length:470},(_,i)=>({id:`m${i}`,role:'member',active:true,name:`測試會員${i}`,joined_date:i%4?'2020-11-25':null,import_source:{hash:sourceHash,row:i+2},import_opening:{stamps:i%3?i%8:null,hairVisits:i%5?i%10:null},remarks:['保留原文']})),sales:[{id:'old',final_amount:50}],stampLedger:[],auditLog:[],rewardWallets:{}};}
test('全部470位啟用並可結帳、累積、同單兌換、手動加印花；保留原表空白及歷史',()=>{
 const data=fixture(),profiles=structuredClone(data.profiles),sales=structuredClone(data.sales);
 const result=activateImportedMembers(data,input,actor,now);assert.equal(result.activated,470);assert.equal(Object.keys(data.rewardWallets).length,470);
 assert.deepEqual(data.profiles,profiles);assert.deepEqual(data.sales,sales);
 for(const member of data.profiles){
  const w=data.rewardWallets[member.id];assert.equal(w.stampProgress,member.import_opening.stamps??0);assert.equal(w.hairVisits,member.import_opening.hairVisits??0);assert.deepEqual(w.coupons,[]);
  const items=[{kind:'service',name:'洗剪吹',unitPrice:100,quantity:1},{kind:'service',name:'染髮',unitPrice:600,quantity:1},{kind:'product',name:'洗頭水',unitPrice:100,quantity:1}];
  const q=quoteRewards({wallet:w,items,saleId:'test-sale',at:now});assert.equal(q.receipt.earnedStamps,1);assert.equal(q.receipt.productDiscount,5);
  if((member.import_opening.hairVisits??0)===9)assert.equal(q.receipt.hairDiscount,10);
  const coupon=q.addedCoupons.find(c=>c.kind!=='hair10');if(coupon)assert.ok(quoteRewards({wallet:w,items,saleId:'test-sale',at:now,couponId:coupon.id}).receipt.discount>0);
  assert.ok(adjustRewardStamps({wallet:w,delta:1,eventId:'manual-test',at:now}).wallet);
  if(!member.joined_date){assert.equal(membershipInfo(member,now).joinedDate,null);assert.equal(w.joinedDate,'2026-11-21');assert.match(memberRewardView(member,w,now),/入會日期未填/);}
 }
 assert.ok(expiryNotices(data.profiles,data.rewardWallets,now).length>0);
 assert.ok(data.stampLedger.every(s=>s.type==='opening_balance'));
 const before=JSON.stringify(data);assert.equal(activateImportedMembers(data,input,actor,now).activated,0);assert.equal(JSON.stringify(data),before);
});
test('已核對或已開始消費的優惠紀錄永不重設；未同意及錯誤來源數量均拒絕',()=>{
 const data=fixture(),member=data.profiles[1],wallet=createRewardWallet(member,now);wallet.stampProgress=6;wallet.hairVisits=8;
 data.rewardWallets[member.id]=wallet;activateImportedMembers(data,input,actor,now);assert.deepEqual(data.rewardWallets[member.id],wallet);
 for(const bad of [{confirmed:false},{policy:'other'},{expectedCount:471},{sourceHash:'wrong'}])assert.throws(()=>activateImportedMembers(fixture(),{...input,...bad},actor,now));
 assert.equal(rewardStatus(data.rewardWallets[member.id],now).stampProgress,6);
});
