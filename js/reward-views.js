import { expiryNotices, rewardStatus } from "./loyalty-v2.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export function expiryNoticeView(members, wallets = {}, at = new Date(), {showEmpty=false,canSeePhone=false,noticeRows=null} = {}) {
  const notices = noticeRows ?? expiryNotices(members, wallets, at);
  if (!notices.length) return showEmpty ? `<section class="card" aria-label="印花到期通知"><div class="card-head"><h2>30天內印花到期</h2><span>0 位會員</span></div><p class="muted">暫時沒有30天內到期的印花或未使用印花優惠。</p></section>` : "";
  return `<section class="card" aria-label="印花到期通知"><div class="card-head"><h2>30天內印花到期</h2><span>${notices.length} 位會員</span></div><div class="list">${notices.map(n => `<div class="list-item"><div><strong>${esc(n.displayName ?? (n.name || (canSeePhone ? n.phone : "") || "未填姓名會員"))}</strong><p class="muted">${n.daysRemaining}天後到期 · ${esc(n.expiresAt.slice(0,10))} 00:00</p></div><button class="button small" data-action="view-member" data-member="${esc(n.memberId)}">查看會員</button></div>`).join("")}</div></section>`;
}

export function memberRewardView(member, wallet, at = new Date()) {
  if(!wallet && member.import_opening)return `<section class="card"><h2>匯入優惠紀錄</h2><div class="grid cols-2"><div><h3>印花數量：${esc(member.import_opening.stamps)}</h3></div><div><h3>剪吹累積次數：${esc(member.import_opening.hairVisits)}</h3></div></div><p class="muted small">空白代表原表未填，並非0。消費前請核對起始資料及未使用優惠；備註不會自動計入營業額。</p></section>`;
  if (!wallet) return `<section class="card"><h2>新制優惠</h2><p class="muted">入會日期及新制起始紀錄待核對；舊消費與印花未有改動。</p></section>`;
  const status = rewardStatus(wallet, at);
  return `<section class="card"><div class="card-head"><h2>會員優惠進度</h2><span>${member.import_opening && !member.joined_date ? `印花年度起點：${esc(wallet.joinedDate)}（入會日期未填）` : `入會：${esc(wallet.joinedDate)}`}</span></div>
    ${status.expiring ? `<p class="demo-note" role="status">印花將於 ${status.period.daysRemaining} 天內到期（${esc(status.period.end)} 00:00）。</p>` : ""}
    <div class="grid cols-2"><div><h3>剪吹累積 ${status.hairVisits}／10 次</h3><p class="muted small">洗剪吹、洗吹造型及單剪合計；每10次獲一次9折，不計印花。</p></div><div><h3>本輪印花 ${status.stampProgress}／8 個</h3><p class="muted small">4印花獲一次9折，進度繼續累積；8印花獲85折後重新計算。</p></div></div>
    <p>印花年度：${esc(status.period.start)} 至 ${esc(status.period.end)} 00:00 前</p><p>未使用優惠：${status.available.length} 張</p></section>`;
}
