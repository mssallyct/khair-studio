export const SERVICE_CATALOG_REVISION = "2026-11-19-services-v1";
export const SERVICE_CATALOG_BACKUP_KEY = `khair-catalog-backup-${SERVICE_CATALOG_REVISION}`;

// The supplied price list is authoritative. Duplicate descriptions at different
// prices are separate options with stable IDs, never a reason to merge rows.
export const SERVICE_PRICE_LIST = Object.freeze([
  ["洗剪吹", "", 168],
  ["洗吹造型", "", 108],
  ["單剪", "", 130],
  ["染髮", "加長收費", 175],
  ["染髮", "IDA", 398],
  ["染髮", "Shiseido", 658],
  ["染髮", "Milbon", 758],
  ["漂染", "挑染", 150],
  ["漂染", "漂髮", 200],
  ["漂染", "漂髮/漸變", 250],
  ["漂染", "漂髮", 300],
  ["電髮", "髮根燙/上直下曲", 200],
  ["電髮", "冷燙", 498],
  ["電髮", "拉直", 598],
  ["電髮", "基本熱燙", 698],
  ["電髮", "冷燙", 708],
  ["電髮", "冷燙", 808],
  ["電髮", "ATS拉直", 798],
  ["電髮", "Shiseido拉直/ATS熱燙", 898],
  ["電髮", "Shiseido 熱燙", 998],
  ["電髮", "直療", 1098],
  ["電髮", "熱療", 1198],
  ["頭髮護理", "強韌劑", 180],
  ["頭髮護理", "電前護理", 190],
  ["頭髮護理", "髮膜", 200],
  ["頭髮護理", "補水焗油", 350],
  ["頭髮護理", "頭皮護理", 370],
  ["頭髮護理", "Milbon", 650],
  ["頭髮護理", "Milbon Color Preserve", 780],
  ["頭髮護理", "角蛋白修護", 1098]
].map(([category, variant, price], index) => Object.freeze({
  id: `svc-20261119-${String(index + 1).padStart(2, "0")}`,
  category,
  name: variant ? `${category}（${variant}）` : category,
  price
})));

const DEFAULT_DURATIONS = { "洗剪吹": 60, "洗吹造型": 60, "單剪": 30, "染髮": 120, "漂染": 120, "電髮": 150, "頭髮護理": 60 };
function serviceDuration(category, catalog) {
  const categories = category === "漂染" ? ["漂染", "染髮"] : [category];
  for (const name of categories) {
    const old = catalog.find(item => item.kind === "service" && item.active !== false && item.name === name && Number.isInteger(Number(item.duration_minutes)) && Number(item.duration_minutes) >= 30 && Number(item.duration_minutes) % 30 === 0);
    if (old) return Number(old.duration_minutes);
  }
  return DEFAULT_DURATIONS[category];
}

export function buildServiceCatalog(previousCatalog = [], { createdAt, createdBy = null } = {}) {
  return SERVICE_PRICE_LIST.map((item, index) => ({
    ...item,
    kind: "service",
    duration_minutes: serviceDuration(item.category, previousCatalog),
    active: true,
    sort_order: (index + 1) * 10,
    catalog_revision: SERVICE_CATALOG_REVISION,
    created_at: createdAt,
    created_by: createdBy
  }));
}

export function prepareServiceCatalogUpdate(data, actorId, updatedAt) {
  if (data.catalogUpdates?.[SERVICE_CATALOG_REVISION]) return null;
  if (!Array.isArray(data.catalog)) throw new Error("原有項目資料無法讀取，已停止價目更新；原有紀錄未被覆蓋。");
  const added = buildServiceCatalog(data.catalog, { createdAt: updatedAt, createdBy: actorId });
  if (added.some(item => data.catalog.some(old => old.id === item.id))) throw new Error("服務價目版本不一致，已停止更新以保護原有紀錄。");
  const next = JSON.parse(JSON.stringify(data));
  let archived = 0;
  for (const item of next.catalog) {
    if (item.kind !== "service" || item.active === false) continue;
    Object.assign(item, { active: false, archived_at: updatedAt, archived_by: actorId, archived_reason: SERVICE_CATALOG_REVISION });
    archived++;
  }
  next.catalog.push(...added);
  const update = { applied_at: updatedAt, applied_by: actorId, archived_count: archived, added_count: added.length };
  next.catalogUpdates = { ...next.catalogUpdates, [SERVICE_CATALOG_REVISION]: update };
  return { data: next, update };
}
