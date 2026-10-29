export function normalizePhoneSearch(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 3 && digits.startsWith("852") ? digits.slice(3) : digits;
}

export function findMembersByPhone(members, query, limit = 8) {
  const digits = normalizePhoneSearch(query);
  if (digits.length < 3) return [];

  return (members || [])
    .filter(member => member.role === "member" && member.active !== false)
    .filter(member => normalizePhoneSearch(member.phone).includes(digits))
    .slice(0, Math.max(1, Number(limit) || 8));
}
