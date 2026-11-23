import test from "node:test";
import assert from "node:assert/strict";
import { createRewardWallet, dateOnly, membershipYear, quoteRewards, rewardStatus, expiryNotices, isHairVisitItem } from "../js/loyalty-v2.js";

const at = new Date("2026-11-19T04:00:00Z");
const member = {id:"m1",name:"測試會員",joined_date:"2026-01-01",active:true};
const hair = (name="洗剪吹",price=168) => ({kind:"service",name,quantity:1,unitPrice:price});
const service = (price=600) => ({kind:"service",name:"染髮",quantity:1,unitPrice:price});
const product = price => ({kind:"product",name:"產品",quantity:1,unitPrice:price});
const fresh = () => createRewardWallet(member,at);
const quote = (wallet,items,saleId="sale-1",more={}) => quoteRewards({wallet,items,saleId,at,...more});

test('產品95折只計產品；第10次剪吹自動只折一個剪吹項目，其他服務原價',()=>{
  const normal=quote(fresh(),[hair(),product(200)]);assert.equal(normal.receipt.finalAmount,358);assert.equal(normal.receipt.productDiscount,10);assert.equal(normal.receipt.hairDiscount,0);
  for(const [name,price]of [['洗剪吹',168],['洗吹造型',108],['單剪',130]]){
    const wallet=fresh();wallet.hairVisits=9;
    const q=quote(wallet,[hair(name,price),product(200),service(650)]);
    assert.equal(q.receipt.finalAmount,price*.9+190+650);assert.equal(q.receipt.automaticHairApplied,true);
    assert.equal(q.receipt.hairVisits,0);assert.ok(q.addedCoupons.find(c=>c.kind==='hair10').usedAt);
    assert.equal(q.availableCoupons.some(c=>c.kind==='hair10'),false);
    assert.equal(rewardStatus(q.wallet,at).available.some(c=>c.kind==='hair10'),false);
    assert.equal(quote(q.wallet,[hair(name,price)],'next').receipt.finalAmount,price);
  }
  const wallet=fresh();wallet.hairVisits=9;
  assert.equal(quote(wallet,[hair(),product(200)]).receipt.finalAmount,341.2);
  assert.equal(quote(wallet,[product(200)]).receipt.hairVisits,9);
});

test("三款剪吹加產品滿600均零印花、零生日印花；每張單最多計一次",()=>{
  for(const name of ["洗剪吹","洗吹造型","單剪"]){
    const q=quote(fresh(),[hair(name),product(1000)],"test",{birthdayBonus:1});
    assert.equal(q.receipt.earnedStamps,0); assert.equal(q.receipt.bonusStamps,0); assert.equal(q.receipt.hairVisits,1);
    assert.equal(q.receipt.stampEarningAmount,0);
  }
  const q=quote(fresh(),[{...hair(),quantity:3},hair("單剪")]);
  assert.equal(q.receipt.hairVisits,1);
});

test("三款共同第10次即時9折，重新計次數，同一優惠不可重用",()=>{
  let wallet=fresh();
  for(let i=1;i<10;i++) wallet=quote(wallet,[hair(["洗剪吹","洗吹造型","單剪"][i%3])],`sale-${i}`).wallet;
  const before=JSON.stringify(wallet);
  const preview=quote(wallet,[hair()],"sale-10");
  const coupon=preview.addedCoupons.find(c=>c.kind==="hair10");
  assert.ok(coupon);assert.equal(preview.receipt.hairVisits,0);
  const paid=quote(wallet,[hair()],"sale-10",{couponId:coupon.id});
  assert.equal(paid.receipt.finalAmount,151.2);assert.equal(paid.receipt.earnedStamps,0);
  assert.equal(JSON.stringify(wallet),before);
  assert.throws(()=>quote(paid.wallet,[hair()],"sale-11",{couponId:coupon.id}),/已使用/);
});

test("其他服務每滿600一印、產品按95折計、剪吹金額不充數",()=>{
  for(const [items,earned,basis] of [[[service(599)],0,599],[[service(600)],1,600],[[service(1200)],2,1200],[[service(400),product(400)],1,780],[[hair(),service(500)],0,500],[[product(12000)],0,0]]){
    const q=quote(fresh(),items);assert.equal(q.receipt.earnedStamps,earned);assert.equal(q.receipt.stampEarningAmount,basis);
  }
});

test("4印9折不扣進度，繼續至8印85折後歸零，9折僅能用一次",()=>{
  let wallet=fresh();wallet.stampProgress=3;
  const preview=quote(wallet,[service()],"four");
  const four=preview.addedCoupons[0];assert.equal(four.kind,"stamp4");
  const paid=quote(wallet,[service()],"four",{couponId:four.id});
  assert.equal(paid.receipt.stampProgress,4);assert.equal(paid.receipt.finalAmount,540);
  assert.throws(()=>quote(paid.wallet,[service()],"reuse",{couponId:four.id}),/已使用/);
  wallet=paid.wallet;
  for(let i=5;i<8;i++)wallet=quote(wallet,[service()],`next-${i}`).wallet;
  const eighth=quote(wallet,[service()],"eight");const eight=eighth.addedCoupons.find(c=>c.kind==="stamp8");
  const final=quote(wallet,[service()],"eight",{couponId:eight.id});
  assert.equal(final.receipt.finalAmount,510);assert.equal(final.receipt.stampProgress,0);
  assert.equal(final.wallet.coupons.filter(c=>c.usedAt).length,2);
});

test("一次跨多個里程碑保留餘數，每券唯一，不疊加產品折扣",()=>{
  const wallet=fresh();const items=[service(6000),product(100)];
  const preview=quote(wallet,items);assert.equal(preview.receipt.earnedStamps,10);assert.equal(preview.receipt.stampProgress,2);
  assert.deepEqual(preview.addedCoupons.map(c=>c.kind),["stamp4","stamp8"]);
  const q=quote(wallet,items,"sale-1",{couponId:preview.addedCoupons[1].id});assert.equal(q.receipt.finalAmount,5185);
  assert.throws(()=>quote(q.wallet,items,"sale-1"),/已處理/);
});

test("印花券不可用於淨產品或淨剪吹；剪吹券不可用於純其他服務",()=>{
  const wallet=fresh();wallet.stampProgress=3;wallet.hairVisits=9;
  const q=quote(wallet,[hair(),service()]);
  const four=q.addedCoupons.find(c=>c.kind==="stamp4"),hair10=q.addedCoupons.find(c=>c.kind==="hair10");
  for(const items of [[hair()],[product(600)]])assert.throws(()=>quote(q.wallet,items,"later",{couponId:four.id}),/不適用/);
  assert.throws(()=>quote(q.wallet,[service()],"later",{couponId:hair10.id}),/不適用/);
});

test("香港入會周年一年到期、30天提示、周年自動新年度；剪吹計數不受印花年度影響",()=>{
  const m={...member,joined_date:"2026-12-01"},date=new Date("2027-11-17T04:00:00Z");
  let wallet=createRewardWallet(m,date);wallet.stampProgress=3;wallet.hairVisits=9;
  wallet=quoteRewards({wallet,items:[hair(),service()],saleId:"ending",at:date}).wallet;
  assert.equal(rewardStatus(wallet,date).expiring,true);
  assert.equal(rewardStatus(wallet,new Date("2027-11-16T04:00:00Z")).expiring,true);
  assert.equal(rewardStatus(wallet,new Date("2027-11-01T04:00:00Z")).period.daysRemaining,30);
  assert.equal(rewardStatus(wallet,new Date("2027-11-01T04:00:00Z")).expiring,true);
  assert.equal(rewardStatus(wallet,new Date("2027-10-31T04:00:00Z")).expiring,false);
  assert.equal(expiryNotices([m],{m1:wallet},date).length,1);
  const before=JSON.stringify(wallet);
  const after=rewardStatus(wallet,new Date("2027-11-30T16:00:00Z"));
  assert.equal(after.stampProgress,0);assert.deepEqual(after.available.map(c=>c.kind),[]);
  assert.equal(after.period.start,"2027-12-01");assert.equal(after.expiring,false);assert.equal(JSON.stringify(wallet),before);
  const next=quoteRewards({wallet,items:[service()],saleId:"new-year",at:new Date("2027-11-30T16:00:00Z")});
  assert.equal(next.receipt.stampProgress,1);assert.ok(next.wallet.coupons.find(c=>c.kind==="stamp4").expired);
});

test("滿8印不延長年度；閏年、未知日期及未來日期處理",()=>{
  assert.equal(membershipYear("2024-02-29",new Date("2027-02-27T16:00:00Z")).start,"2027-02-28");
  assert.equal(membershipYear("2024-02-29",new Date("2028-02-28T16:00:00Z")).start,"2028-02-29");
  for(const input of ["","2026-02-29","2026-13-01"])assert.throws(()=>dateOnly(input),/有效入會/);
  assert.throws(()=>membershipYear("2027-01-01",at),/不能遲於/);
  const q=quote(fresh(),[service(4800)]);assert.equal(q.wallet.periodEnd,"2027-01-01");
});

test("未核對舊會員起始資料、損壞進度及無效金額停止，不修改輸入",()=>{
  assert.throws(()=>quote(null,[hair()]),/尚未核對/);
  const wallet=fresh();const before=JSON.stringify(wallet);
  for(const items of [[],[{...hair(),quantity:0}],[{...hair(),unitPrice:Infinity}],[{...hair(),quantity:1.5}]])assert.throws(()=>quote(wallet,items));
  assert.equal(JSON.stringify(wallet),before);
  assert.throws(()=>quote({...wallet,stampProgress:8},[hair()]),/不完整/);
  assert.equal(isHairVisitItem({kind:"service",catalogId:"svc-20261119-01",name:"已修改名稱"}),true);
});
