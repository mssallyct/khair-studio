export const PRODUCT_REVISION='2026-11-19-products-v1';
export const PRODUCT_PRICE_LIST=Object.freeze([
  ['透明質酸噴霧',135],['透明質酸彈力素',135],['Hair Spray',80],['Hairchitect GEL',90],['IDA鹽水',86],
  ['Fiole Shampoo',165],['K.Hair Studio洗頭水',100],['K.Hair Studio透明質酸(300ml)',140],['Shampoo/ treatment set',210],
  ['Milbon 洗頭水',170],['Milbon Treatment',240],['Milbon shampoo/treatment set',390],
  ['Milbon Color Preserve 洗頭水',230],['Milbon Color Preserve 焗油',290],['Milbon Color Preserve shampoo/treatment set',490],
  ['Feeling Emo 造型產品',120],['Milbon 護理液',230],['Milbon 髮尾油',190],['Milbon Color Preserve 護理',230],
  ['頭皮治療Shampoo(細)',138],['頭皮治療Shampoo(大)',258]
].map(([name,price],i)=>Object.freeze({id:`prd-20261119-${String(i+1).padStart(2,'0')}`,name,price})));
export function buildProductCatalog(actorId,at){
  return PRODUCT_PRICE_LIST.map(p=>({...p,kind:'product',active:true,duration_minutes:0,created_by:actorId,created_at:at,catalog_revision:PRODUCT_REVISION})).sort((a,b)=>a.price-b.price);
}
// One-time replacement: archive old options; preserve invoices, items and rewards.
export function prepareProductCatalogUpdate(data,actorId,at){
  if(data.catalogUpdates?.[PRODUCT_REVISION])return null;
  if(!Array.isArray(data.catalog))throw new Error('產品資料不完整，已停止更新。');
  const added=buildProductCatalog(actorId,at);
  if(added.some(p=>data.catalog.some(old=>old.id===p.id)))throw new Error('產品版本不一致，未有覆蓋紀錄。');
  const next=structuredClone(data),oldProducts=next.catalog.filter(p=>p.kind==='product');
  (next.productCatalogBackups ||= {})[PRODUCT_REVISION]=structuredClone(oldProducts);
  let count=0;
  for(const p of oldProducts)if(p.active!==false){Object.assign(p,{active:false,archived_at:at,archived_by:actorId,archived_reason:PRODUCT_REVISION});count++;}
  next.catalog.push(...added);
  (next.catalogUpdates ||= {})[PRODUCT_REVISION]={applied_at:at,applied_by:actorId,archived_count:count,added_count:added.length};
  (next.auditLog ||= []).push({id:`catalog-${PRODUCT_REVISION}`,actor_id:actorId,actor_username:String(actorId).replace(/^admin-/,''),action:'catalog.products_replaced',summary:`更新21項產品；舊產品只停用，過往交易不變`,created_at:at});
  return next;
}
