import { hongKongDateKey } from "./rules.js";

// Pure, server-recomputed rules. Not enabled by the live v19 checkout.
export const LOYALTY_VERSION = "membership-year-v2";
const HAIR_IDS = new Set(["svc-20261119-01", "svc-20261119-02", "svc-20261119-03", "svc-cut", "svc-style", "svc-trim"]);
const HAIR_NAMES = new Set(["洗剪吹", "洗吹造型", "單剪"]);
const DAY_MS = 86400000;

export function dateOnly(value) {
  const s = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("請填寫有效入會日期。");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error("請填寫有效入會日期。");
  return s;
}

function anniversary(joined, year) {
  const [, month, day] = joined.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function membershipYear(joinedDate, at = new Date()) {
  const joined = dateOnly(joinedDate);
  const today = dateOnly(hongKongDateKey(at));
  if (joined > today) throw new Error("入會日期不能遲於今天。");
  let year = Number(today.slice(0, 4));
  if (today < anniversary(joined, year)) year--;
  const start = anniversary(joined, year);
  const end = anniversary(joined, year + 1);
  const daysRemaining = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  return { start, end, expiresAt: `${end}T00:00:00+08:00`, daysRemaining };
}

export function isHairVisitItem(item) {
  if (item.kind !== "service") return false;
  if (item.reward_group) return item.reward_group === "hair_visit";
  return HAIR_IDS.has(item.catalogId || item.id) || HAIR_NAMES.has(String(item.name || "").trim());
}

export function createRewardWallet(member, at = new Date()) {
  if (!member?.id) throw new Error("缺少會員編號。");
  const period = membershipYear(member.joined_date, at);
  return { version: LOYALTY_VERSION, memberId: member.id, joinedDate: member.joined_date, periodStart: period.start, periodEnd: period.end, stampProgress: 0, stampCycle: 0, hairVisits: 0, coupons: [], receipts: {}, adjustments: {} };
}

function validateWallet(wallet) {
  if (wallet?.version !== LOYALTY_VERSION || !wallet.memberId) throw new Error("會員新制起始紀錄尚未核對。");
  dateOnly(wallet.joinedDate);
  dateOnly(wallet.periodStart);dateOnly(wallet.periodEnd);
  if(wallet.periodEnd<=wallet.periodStart || !Number.isInteger(wallet.stampCycle ?? 0) || (wallet.stampCycle ?? 0)<0)throw new Error("優惠年度紀錄不完整，已停止處理。");
  if (!Number.isInteger(wallet.stampProgress) || wallet.stampProgress < 0 || wallet.stampProgress > 7 || !Number.isInteger(wallet.hairVisits) || wallet.hairVisits < 0 || wallet.hairVisits > 9 || !Array.isArray(wallet.coupons) || !wallet.receipts || typeof wallet.receipts !== "object") throw new Error("優惠紀錄不完整，已停止處理。");
  if (new Set(wallet.coupons.map(c => c.id)).size !== wallet.coupons.length) throw new Error("優惠編號重複，已停止處理。");
  for(const c of wallet.coupons)if(!c.id || !["hair10","stamp4","stamp8"].includes(c.kind) || c.rate!==(c.kind==="stamp8"?.15:.1) || c.kind!=="hair10" && (!c.expiresAt || Number.isNaN(new Date(c.expiresAt).getTime())))throw new Error("優惠內容不完整，已停止處理。");
}

function currentWallet(wallet, at) {
  validateWallet(wallet);
  const next = structuredClone(wallet);
  const period = membershipYear(next.joinedDate, at);
  if (period.start < next.periodStart) throw new Error("不可倒序寫入優惠交易。");
  if (next.periodStart !== period.start) {
    next.stampProgress = 0;
    next.stampCycle = 0;
    next.periodStart = period.start;
    next.periodEnd = period.end;
  }
  const now = new Date(at).getTime();
  for (const coupon of next.coupons) if (!coupon.usedAt && coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= now) coupon.expired = true;
  return { next, period };
}

export function rewardStatus(wallet, at = new Date()) {
  const { next, period } = currentWallet(wallet, at);
  const available = next.coupons.filter(c => !c.usedAt && !c.expired);
  return { stampProgress: next.stampProgress, hairVisits: next.hairVisits, available, period, expiring: period.daysRemaining <= 14 && (next.stampProgress > 0 || available.some(c => c.kind !== "hair10")) };
}

export function saleUnitPrice(value) {
  if ((typeof value!=="number" && typeof value!=="string") || String(value).trim()==="") throw new Error("請填寫有效單價。");
  const price=Number(value);
  if(!Number.isFinite(price) || price<0 || price>1000000 || Math.abs(price*100-Math.round(price*100))>0.000001)throw new Error("單價須為0至1,000,000，最多兩位小數。");
  return Math.round(price*100)/100;
}

// Names/kinds/reward groups come from the server catalog. Authorized admins
// can set a validated per-sale unit price without editing that catalog.
// One completed checkout counts as at most one visit.
export function quoteRewards({ wallet, items, saleId, at = new Date(), couponId = null, birthdayBonus = 0 }) {
  validateWallet(wallet);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(saleId || ""))) throw new Error("缺少有效交易編號。");
  if (wallet.receipts[saleId]) throw new Error("此消費已處理，請勿重複收款。");
  if (!Array.isArray(items) || !items.length) throw new Error("請選擇消費項目。");
  const lines = items.map(item => {
    const quantity = Number(item.quantity), price = saleUnitPrice(item.unitPrice);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isFinite(price) || price < 0 || !["service", "product"].includes(item.kind)) throw new Error("消費項目無效。");
    const cents = Math.round(price * 100) * quantity;
    if (!Number.isSafeInteger(cents) || cents > 100000000) throw new Error("消費金額超出可處理範圍。");
    return { ...item, quantity, cents };
  });
  const total = lines.reduce((sum, item) => sum + item.cents, 0);
  if (!total || total > 100000000) throw new Error("請檢查消費金額。");
  const hairVisit = lines.some(isHairVisitItem);
  const eligible = lines.filter(item => item.kind === "service" && !isHairVisitItem(item));
  const product = lines.filter(item => item.kind === "product").reduce((sum, item) => sum + item.cents, 0);
  const ordinaryDiscount = Math.round(product * .05);
  const earningCents = eligible.length ? eligible.reduce((sum, item) => sum + item.cents, 0) + product - ordinaryDiscount : 0;
  const earned = Math.floor(earningCents / 60000);
  const bonus = eligible.length && birthdayBonus === 1 ? 1 : 0;
  const { next, period } = currentWallet(wallet, at);
  const timestamp = new Date(at).toISOString();
  const addedCoupons = [];
  function award(kind, rate, expiresAt = null) {
    const coupon = { id: `${saleId}-${kind}-${addedCoupons.length + 1}`, kind, rate, earnedAt: timestamp, expiresAt, saleId, cycle: kind === "hair10" ? null : `${next.periodStart}:${next.stampCycle || 0}` };
    next.coupons.push(coupon); addedCoupons.push(coupon);
  }
  for (let i = 0; i < earned + bonus; i++) {
    next.stampProgress++;
    if (next.stampProgress === 4) award("stamp4", .10, period.expiresAt);
    if (next.stampProgress === 8) { award("stamp8", .15, period.expiresAt); next.stampProgress = 0; next.stampCycle = (next.stampCycle || 0) + 1; }
  }
  let automaticHair = null;
  if (hairVisit && ++next.hairVisits === 10) { award("hair10", .10); automaticHair=addedCoupons.at(-1); next.hairVisits = 0; }
  const availableCoupons = next.coupons.filter(c => !c.usedAt && !c.expired && (c.kind === "hair10" ? hairVisit : eligible.length > 0));
  let selected = null;
  if (couponId) {
    selected = availableCoupons.find(c => c.id === couponId);
    if (!selected) throw new Error("優惠未達標、已使用、已到期或不適用於本次消費。");
    selected.usedAt = timestamp;
    selected.usedOnSaleId = saleId;
  }
  // Every tenth visit applies immediately to one haircut/blow-dry service,
  // not to other services/products on the same bill. Product 5% stays separate.
  const hairCoupon=automaticHair || (selected?.kind==='hair10' ? selected : null);
  if(hairCoupon){hairCoupon.usedAt=timestamp;hairCoupon.usedOnSaleId=saleId;}
  const hairDiscount=hairCoupon ? Math.round(Math.round(Number(lines.find(isHairVisitItem).unitPrice)*100)*.1) : 0;
  const ordinaryAndHair=ordinaryDiscount+hairDiscount;
  // Existing optional stamp whole-bill promotions remain non-stacking.
  const discount = selected && selected.kind!=='hair10' ? Math.max(Math.round(total*selected.rate),ordinaryAndHair) : ordinaryAndHair;
  const receipt = { saleId, memberId: next.memberId, policyVersion: LOYALTY_VERSION, completedAt: timestamp, subtotal: total / 100, discount: discount / 100, finalAmount: (total - discount) / 100, stampEarningAmount: earningCents / 100, earnedStamps: earned, bonusStamps: bonus, hairVisitsEarned: hairVisit ? 1 : 0, couponId: selected?.id || null, discountLabel: selected ? ({hair10:"剪吹10次・全單9折",stamp4:"4印花里程碑・全單9折",stamp8:"8印花里程碑・全單85折"})[selected.kind] : ordinaryDiscount ? "會員產品95折" : "沒有折扣", stampProgress: next.stampProgress, hairVisits: next.hairVisits };
  next.receipts[saleId] = receipt;
  Object.assign(receipt,{productDiscount:ordinaryDiscount/100,hairDiscount:hairDiscount/100,automaticHairApplied:Boolean(automaticHair)});
  if(hairCoupon && (!selected || selected.kind==='hair10')){receipt.couponId=hairCoupon.id;receipt.discountLabel='第10次剪吹・該剪吹項目9折'+(ordinaryDiscount?'＋產品95折':'');}
  return { receipt, wallet: next, availableCoupons: availableCoupons.filter(c=>c!==automaticHair).map(c => ({...c})), addedCoupons: addedCoupons.map(c => ({...c})) };
}

export function expiryNotices(members, wallets, at = new Date()) {
  return members.filter(m => m.active !== false).flatMap(member => {
    const wallet = wallets[member.id];
    if (!wallet) return [];
    const status = rewardStatus(wallet, at);
    return status.expiring ? [{ memberId: member.id, name: String(member.name || "").trim(), phone:member.phone || null, daysRemaining: status.period.daysRemaining, expiresAt: status.period.expiresAt, stampProgress: status.stampProgress }] : [];
  });
}

export function adjustRewardStamps({wallet,delta,eventId,at=new Date()}) {
  if(!Number.isInteger(delta) || !delta || Math.abs(delta)>1000 || !/^[a-zA-Z0-9_-]{1,100}$/.test(String(eventId||"")))throw new Error("印花調整無效。");
  const {next,period}=currentWallet(wallet,at);
  next.adjustments ||= {};
  if(next.adjustments[eventId])throw new Error("此印花調整已處理。");
  const cycle=`${next.periodStart}:${next.stampCycle || 0}`;
  if(delta<0 && (next.stampProgress+delta<0 || next.stampProgress>=4 || next.coupons.some(c=>c.cycle===cycle)))throw new Error("本輪餘額不足或已有優惠，請先核對；不能直接扣減。");
  const coupons=[];
  if(delta<0)next.stampProgress+=delta;
  for(let n=0;n<delta;n++){
    next.stampProgress++;
    if([4,8].includes(next.stampProgress)){
      const tier=next.stampProgress;
      const c={id:`${eventId}-stamp${tier}-${coupons.length+1}`,kind:`stamp${tier}`,rate:tier===4?.1:.15,earnedAt:new Date(at).toISOString(),expiresAt:period.expiresAt,cycle:`${next.periodStart}:${next.stampCycle || 0}`,eventId};
      next.coupons.push(c);coupons.push(c);
      if(tier===8){next.stampProgress=0;next.stampCycle=(next.stampCycle || 0)+1;}
    }
  }
  next.adjustments[eventId]={delta,at:new Date(at).toISOString()};
  return {wallet:next,coupons};
}
