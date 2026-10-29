import test from "node:test";
import assert from "node:assert/strict";
import { buildMemberDetail } from "../js/member-detail.js";

test("會員詳情整合個人、消費、預約、印花及介紹紀錄", () => {
  const data = {
    profiles: [
      { id: "member-1", role: "member", name: "Amy" },
      { id: "member-2", role: "member", name: "Beth" },
      { id: "member-3", role: "member", name: "Cara" }
    ],
    appointments: [
      { id: "apt-old", member_id: "member-1", start_at: "2026-01-01T03:00:00Z" },
      { id: "apt-new", member_id: "member-1", start_at: "2026-02-01T03:00:00Z" },
      { id: "apt-other", member_id: "member-2", start_at: "2026-03-01T03:00:00Z" }
    ],
    sales: [
      { id: "sale-1", member_id: "member-1", final_amount: 600, completed_at: "2026-01-01T04:00:00Z" },
      { id: "sale-2", member_id: "member-1", final_amount: 800, completed_at: "2026-02-01T04:00:00Z" }
    ],
    saleItems: [
      { id: "line-1", sale_id: "sale-1", name: "剪髮", quantity: 1 },
      { id: "line-2", sale_id: "sale-2", name: "染髮", quantity: 1 }
    ],
    stamps: [
      { id: "stamp-1", member_id: "member-1", delta: 2, created_at: "2026-01-01T05:00:00Z" },
      { id: "stamp-2", member_id: "member-1", delta: -1, created_at: "2026-02-01T05:00:00Z" }
    ],
    referrals: [
      { referrer_id: "member-2", referred_member_id: "member-1" },
      { referrer_id: "member-1", referred_member_id: "member-3", awarded_at: "2026-02-02T05:00:00Z" }
    ]
  };

  const detail = buildMemberDetail(data, "member-1");
  assert.equal(detail.member.name, "Amy");
  assert.equal(detail.appointments[0].id, "apt-new");
  assert.equal(detail.sales[0].items[0].name, "染髮");
  assert.equal(detail.totalSpend, 1400);
  assert.equal(detail.balance, 1);
  assert.equal(detail.referrer.name, "Beth");
  assert.deepEqual(detail.referredMembers.map(item => item.name), ["Cara"]);
  assert.equal(detail.rewardedReferralCount, 1);
  assert.equal(buildMemberDetail(data, "missing"), null);
});
