import test from 'node:test';
import assert from 'node:assert/strict';
import {PRODUCT_PRICE_LIST,PRODUCT_REVISION,buildProductCatalog,prepareProductCatalogUpdate} from '../js/product-catalog.js';
const at='2026-11-19T08:00:00Z';
test('21項產品價格正確、由低至高排序，套裝獨立',()=>{
  const rows=buildProductCatalog('admin-howood',at);
  assert.equal(rows.length,21);assert.equal(new Set(rows.map(p=>p.id)).size,21);
  assert.deepEqual(rows.map(p=>p.price),[80,86,90,100,120,135,135,138,140,165,170,190,210,230,230,230,240,258,290,390,490]);
  assert.equal(rows.find(p=>p.name==='透明質酸噴霧').price,135);
  assert.equal(rows.find(p=>p.name==='K.Hair Studio透明質酸(300ml)').price,140);
  assert.equal(rows.find(p=>p.name==='Milbon Color Preserve shampoo/treatment set').price,490);
  assert.ok(rows.every(p=>p.kind==='product' && p.active && p.duration_minutes===0));
});
test('產品替換只停用舊選項，服務、會員、舊交易及優惠逐字不變',()=>{
  const original={catalog:[{id:'svc',kind:'service',name:'服務',price:168},{id:'old',kind:'product',name:'舊產品',price:200},{id:'inactive',kind:'product',active:false}],profiles:[{id:'m'}],sales:[{id:'sale',final_amount:190}],saleItems:[{catalog_id:'old',name:'舊產品',unit_price:200}],rewardWallets:{m:{stampProgress:3}},stampLedger:[{delta:3}],auditLog:[]};
  const before=JSON.stringify(original),next=prepareProductCatalogUpdate(original,'admin-sally',at);
  assert.equal(JSON.stringify(original),before);
  for(const k of ['profiles','sales','saleItems','rewardWallets','stampLedger'])assert.deepEqual(next[k],original[k]);
  assert.deepEqual(next.catalog[0],original.catalog[0]);assert.equal(next.catalog[1].active,false);
  assert.deepEqual(next.productCatalogBackups[PRODUCT_REVISION],original.catalog.filter(p=>p.kind==='product'));
  assert.equal(next.auditLog.at(-1).actor_id,'admin-sally');
  next.catalog.find(p=>p.id===PRODUCT_PRICE_LIST[0].id).price=137;
  next.catalog.find(p=>p.id===PRODUCT_PRICE_LIST[1].id).active=false;
  assert.equal(prepareProductCatalogUpdate(next,'admin-howood',at),null);
});
test('損壞或重複產品ID停止更新，不覆蓋舊資料',()=>{
  assert.throws(()=>prepareProductCatalogUpdate({},'admin-howood',at));
  const d={catalog:[{id:PRODUCT_PRICE_LIST[0].id,kind:'product'}]};const before=JSON.stringify(d);
  assert.throws(()=>prepareProductCatalogUpdate(d,'admin-howood',at),/版本不一致/);assert.equal(JSON.stringify(d),before);
});
