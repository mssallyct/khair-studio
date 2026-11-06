import test from "node:test";
import assert from "node:assert/strict";
import { birthdayStampAward, calculateSale, generateTimeSlots, isBirthdayMonth, isValidBusinessSlot, normalizeHongKongPhone, redemptionForBalance, stampsFromAmount } from "../js/rules.js";

test("每張單按實收每滿600元給一個印花，餘額不累積", () => {
  assert.equal(stampsFromAmount(599),0);
  assert.equal(stampsFromAmount(600),1);
  assert.equal(stampsFromAmount(1199),1);
  assert.equal(stampsFromAmount(1200),2);
  assert.equal(stampsFromAmount(1350),2);
});

test("4個印花是9折，8個印花是85折", () => {
  assert.deepEqual(redemptionForBalance(4,4),{stamps:4,rate:.1,label:"4印花・全單9折"});
  assert.deepEqual(redemptionForBalance(8,8),{stamps:8,rate:.15,label:"8印花・全單85折"});
  assert.equal(redemptionForBalance(3,4).stamps,0);
});

test("印花優惠和產品95折不疊加，取最高折扣", () => {
  const items=[{kind:"service",name:"染髮",quantity:1,unitPrice:780},{kind:"product",name:"洗髮水",quantity:1,unitPrice:220}];
  const productOnly=calculateSale(items,0,0);
  assert.equal(productOnly.subtotal,1000);
  assert.equal(productOnly.discount,11);
  assert.equal(productOnly.finalAmount,989);
  const stampDiscount=calculateSale(items,8,8);
  assert.equal(stampDiscount.discount,150);
  assert.equal(stampDiscount.finalAmount,850);
  assert.equal(stampDiscount.earnedStamps,1);
});

test("新印花按折扣後實收計算", () => {
  const summary=calculateSale([{kind:"service",name:"服務",quantity:1,unitPrice:1350}],4,4);
  assert.equal(summary.finalAmount,1215);
  assert.equal(summary.earnedStamps,2);
});

test("同一單新印花可即時使用，4印及8印均按該折扣後金額判斷", () => {
  for (const [balance, price, tier, final, earned] of [[3,800,4,720,1],[7,800,8,680,1],[0,3000,4,2700,4],[0,6000,8,5100,8]]) {
    const summary = calculateSale([{kind:"service",quantity:1,unitPrice:price}],balance,tier);
    assert.equal(summary.redemptionAllowed,true);
    assert.equal(summary.finalAmount,final);
    assert.equal(summary.earnedStamps,earned);
    assert.equal(summary.remainingStamps,balance+earned-tier);
  }
});

test("折扣後不足600不能用未賺到的印花，金額邊界以分計算", () => {
  for (const [price, balance, tier, allowed] of [[600,3,4,false],[666.66,3,4,false],[666.67,3,4,true],[705.87,7,8,false],[705.88,7,8,true]]) {
    const summary = calculateSale([{kind:"service",quantity:1,unitPrice:price}],balance,tier);
    assert.equal(summary.redemptionAllowed,allowed,`${price} / ${tier}`);
    assert.equal(summary.availableRedemptions.includes(tier),allowed);
  }
});

test("純產品只享95折，不賺印花、不兌換印花、不發生日印花", () => {
  const items = [{kind:"product",quantity:1,unitPrice:12000}];
  const summary = calculateSale(items,8,0,1);
  assert.equal(summary.finalAmount,11400);
  assert.equal(summary.stampEligible,false);
  assert.equal(summary.earnedStamps,0);
  assert.equal(summary.bonusStamps,0);
  assert.equal(summary.remainingStamps,8);
  assert.deepEqual(summary.availableRedemptions,[]);
  assert.equal(calculateSale(items,8,8,1).redemptionAllowed,false);
});

test("有服務才可合併產品金額計印花，不累積不同單的餘額", () => {
  const items = [{kind:"service",quantity:1,unitPrice:400},{kind:"product",quantity:1,unitPrice:400}];
  const summary = calculateSale(items,3,4);
  assert.equal(summary.finalAmount,720);
  assert.equal(summary.earnedStamps,1);
  assert.equal(summary.redemptionAllowed,true);
  assert.equal(summary.remainingStamps,0);
  const less = calculateSale([{kind:"service",quantity:1,unitPrice:300},{kind:"product",quantity:1,unitPrice:300}]);
  assert.equal(less.finalAmount,585);
  assert.equal(less.earnedStamps,0);
});

test("生日獎賞按香港年份只發一次，服務消費可在本單使用", () => {
  const now = new Date("2026-12-31T16:30:00Z"); // 2027-01-01 Hong Kong
  const profile = {id:"m1",birthday:"1990-01-02"};
  assert.equal(birthdayStampAward(profile,[],now),1);
  assert.equal(birthdayStampAward(profile,[{member_id:"m1",type:"birthday",created_at:"2026-12-31T16:00:00Z"}],now),0);
  const summary = calculateSale([{kind:"service",quantity:1,unitPrice:300}],3,4,1);
  assert.equal(summary.earnedStamps,0);
  assert.equal(summary.bonusStamps,1);
  assert.equal(summary.redemptionAllowed,true);
  assert.equal(summary.remainingStamps,0);
});

test("營業時間為11:00至21:00，每30分鐘一節", () => {
  assert.equal(generateTimeSlots(150)[0],"11:00");
  assert.equal(generateTimeSlots(150).at(-1),"18:30");
  assert.equal(isValidBusinessSlot("18:30",150),true);
  assert.equal(isValidBusinessSlot("19:00",150),false);
  assert.equal(isValidBusinessSlot("11:15",30),false);
});

test("生日月份判斷", () => {
  assert.equal(isBirthdayMonth("1990-09-16",new Date("2026-09-02T00:00:00")),true);
  assert.equal(isBirthdayMonth("1990-10-16",new Date("2026-09-02T00:00:00")),false);
});

test("香港電話統一為8位格式", () => {
  assert.equal(normalizeHongKongPhone("91234567"),"9123 4567");
  assert.equal(normalizeHongKongPhone("+852 2123 4567"),"2123 4567");
  assert.throws(()=>normalizeHongKongPhone("1234567"),/香港 8 位電話號碼/);
});
