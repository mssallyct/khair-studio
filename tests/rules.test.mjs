import test from "node:test";
import assert from "node:assert/strict";
import { calculateSale, generateTimeSlots, isBirthdayMonth, isValidBusinessSlot, redemptionForBalance, stampsFromAmount } from "../js/rules.js";

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
