export const STAMP_THRESHOLD = 600;
export const BUSINESS_OPEN = "11:00";
export const BUSINESS_CLOSE = "21:00";
export const SLOT_MINUTES = 30;

export const APPOINTMENT_LABELS = {
  pending: "待確認",
  confirmed: "已確認",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "沒有出席"
};

export function stampsFromAmount(amount) {
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 ? Math.floor(value / STAMP_THRESHOLD) : 0;
}

export function redemptionForBalance(balance, requested) {
  const stamps = Math.max(0, Number(balance) || 0);
  const tier = Number(requested) === 8 ? 8 : Number(requested) === 4 ? 4 : 0;
  if (tier > stamps) return { stamps: 0, rate: 0, label: "不使用印花" };
  if (tier === 8) return { stamps: 8, rate: 0.15, label: "8印花・全單85折" };
  if (tier === 4) return { stamps: 4, rate: 0.10, label: "4印花・全單9折" };
  return { stamps: 0, rate: 0, label: "不使用印花" };
}

export function calculateSale(items, stampBalance = 0, requestedRedemption = 0, birthdayStamps = 0) {
  const normalized = (items || []).map(item => ({
    ...item,
    quantity: Math.max(0, Number(item.quantity) || 0),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    kind: item.kind === "product" ? "product" : "service"
  }));
  const subtotal = roundMoney(normalized.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const productSubtotal = roundMoney(normalized.filter(item => item.kind === "product").reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const stampEligible = normalized.some(item => item.kind === "service" && item.quantity > 0);
  const balance = Math.max(0, Math.floor(Number(stampBalance) || 0));
  const bonusStamps = stampEligible && birthdayStamps === 1 && subtotal > 0 ? 1 : 0;
  // Earn once before redeeming this bill's stamps. The ordinary product member
  // price is retained as the earning basis; redeeming stamps must not remove
  // stamps that this checkout has just earned. Product-only bills earn none.
  const subtotalCents = Math.round(subtotal * 100);
  const ordinaryProductDiscountCents = Math.round(Math.round(productSubtotal * 100) * 5 / 100);
  const stampEarningAmount = stampEligible ? Math.max(0, subtotalCents - ordinaryProductDiscountCents) / 100 : 0;
  const earnedStamps = stampsFromAmount(stampEarningAmount);
  const quote = tier => {
    const redemption = redemptionForBalance(tier, tier);
    const productDiscountCents = redemption.stamps ? 0 : ordinaryProductDiscountCents;
    const discountCents = redemption.stamps ? Math.round(subtotalCents * (tier === 8 ? 15 : 10) / 100) : productDiscountCents;
    const productDiscount = productDiscountCents / 100;
    const discount = discountCents / 100;
    const finalAmount = Math.max(0, subtotalCents - discountCents) / 100;
    return { redemption, discount, finalAmount, discountLabel: redemption.stamps ? redemption.label : productDiscount > 0 ? "會員產品95折" : "沒有折扣" };
  };
  const availableRedemptions = [4, 8].filter(tier => stampEligible && subtotal > 0 && balance + earnedStamps + bonusStamps >= tier);
  const requested = Number(requestedRedemption);
  const selected = quote([4, 8].includes(requested) ? requested : 0);
  const redemptionAllowed = requested === 0 || availableRedemptions.includes(requested);
  return {
    subtotal,
    productSubtotal,
    ...selected,
    stampEligible,
    stampEarningAmount,
    earnedStamps,
    bonusStamps,
    availableRedemptions,
    redemptionAllowed,
    redemptionError: redemptionAllowed ? "" : stampEligible ? "原有印花加本次消費所得印花仍不足，請重新選擇印花優惠。" : "淨產品消費不適用印花優惠，請選擇不使用印花。",
    remainingStamps: balance + earnedStamps + bonusStamps - selected.redemption.stamps
  };
}

export function hongKongDateKey(value) {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function birthdayStampAward(profile, ledger = [], saleDate = new Date()) {
  if (!profile || !isBirthdayMonth(profile.birthday, saleDate)) return 0;
  const year = hongKongDateKey(saleDate).slice(0, 4);
  return ledger.some(item => item.member_id === profile.id && item.type === "birthday" && hongKongDateKey(item.created_at).slice(0, 4) === year) ? 0 : 1;
}

export function isBirthdayMonth(birthday, saleDate = new Date()) {
  if (!birthday) return false;
  const match = /^\d{4}-(\d{2})-\d{2}$/.exec(String(birthday));
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return false;
  const saleMonth = Number(new Intl.DateTimeFormat("en", { month: "numeric", timeZone: "Asia/Hong_Kong" }).format(saleDate));
  return Number(match[1]) === saleMonth;
}

export function normalizeHongKongPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("852")) digits = digits.slice(3);
  if (!/^[2-9]\d{7}$/.test(digits)) throw new Error("請輸入有效的香港 8 位電話號碼。");
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

export function generateTimeSlots(durationMinutes = 30) {
  const duration = Math.max(SLOT_MINUTES, Number(durationMinutes) || SLOT_MINUTES);
  const open = 11 * 60;
  const close = 21 * 60;
  const slots = [];
  for (let minute = open; minute + duration <= close; minute += SLOT_MINUTES) {
    slots.push(minutesToTime(minute));
  }
  return slots;
}

export function isValidBusinessSlot(time, durationMinutes = 30) {
  const minute = timeToMinutes(time);
  const duration = Math.max(SLOT_MINUTES, Number(durationMinutes) || SLOT_MINUTES);
  return Number.isFinite(minute) && minute >= 11 * 60 && minute % SLOT_MINUTES === 0 && minute + duration <= 21 * 60;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("zh-HK", { style: "currency", currency: "HKD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Hong_Kong" }).format(date);
}

export function toHongKongIso(date, time) {
  return `${date}T${time}:00+08:00`;
}

function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ""));
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
