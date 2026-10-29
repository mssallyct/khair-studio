export function buildMemberDetail(data, memberId) {
  const profiles = data?.profiles || [];
  const member = profiles.find(item => item.id === memberId && item.role === "member");
  if (!member) return null;

  const appointments = newestFirst(
    (data.appointments || []).filter(item => item.member_id === memberId),
    "start_at"
  );
  const sales = newestFirst(
    (data.sales || []).filter(item => item.member_id === memberId),
    "completed_at"
  );
  const stamps = newestFirst(
    (data.stamps || []).filter(item => item.member_id === memberId),
    "created_at"
  );
  const saleItems = data.saleItems || [];
  const referrals = data.referrals || [];
  const introducedBy = referrals.find(item => item.referred_member_id === memberId);
  const referrer = introducedBy
    ? profiles.find(item => item.id === introducedBy.referrer_id && item.role === "member") || null
    : null;
  const referredRecords = referrals.filter(item => item.referrer_id === memberId);
  const referredMembers = referredRecords
    .map(item => profiles.find(profile => profile.id === item.referred_member_id && profile.role === "member"))
    .filter(Boolean);

  return {
    member,
    appointments,
    sales: sales.map(sale => ({
      ...sale,
      items: saleItems.filter(item => item.sale_id === sale.id)
    })),
    stamps,
    balance: stamps.reduce((sum, item) => sum + Number(item.delta || 0), 0),
    totalSpend: sales.reduce((sum, item) => sum + Number(item.final_amount || 0), 0),
    referrer,
    referredMembers,
    rewardedReferralCount: referredRecords.filter(item => item.awarded_at).length
  };
}

function newestFirst(items, key) {
  return [...items].sort((a, b) => new Date(b[key]) - new Date(a[key]));
}
