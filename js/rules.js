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

export function calculateSale(items, stampBalance = 0, requestedRedemption = 0) {
  const normalized = (items || []).map(item => ({
    ...item,
    quantity: Math.max(0, Number(item.quantity) || 0),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    kind: item.kind === "product" ? "product" : "service"
  }));
  const subtotal = roundMoney(normalized.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const productSubtotal = roundMoney(normalized.filter(item => item.kind === "product").reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const redemption = redemptionForBalance(stampBalance, requestedRedemption);
  const stampDiscount = roundMoney(subtotal * redemption.rate);
  const productDiscount = redemption.stamps ? 0 : roundMoney(productSubtotal * 0.05);
  const discount = Math.max(stampDiscount, productDiscount);
  const finalAmount = roundMoney(Math.max(0, subtotal - discount));
  return {
    subtotal,
    productSubtotal,
    discount,
    finalAmount,
    redemption,
    discountLabel: redemption.stamps ? redemption.label : productDiscount > 0 ? "會員產品95折" : "沒有折扣",
    earnedStamps: stampsFromAmount(finalAmount)
  };
}

export function isBirthdayMonth(birthday, saleDate = new Date()) {
  if (!birthday) return false;
  const date = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return date.getMonth() === saleDate.getMonth();
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
  return new Intl.NumberFormat("zh-HK", { style: "currency", currency: "HKD", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
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
