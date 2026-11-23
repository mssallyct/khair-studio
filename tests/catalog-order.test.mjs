import test from 'node:test';
import assert from 'node:assert/strict';
import {sortedActiveCatalog,buildServiceCatalog} from '../js/service-catalog.js';

test('新增剪吹移到最上面；同名連續、價錢遞增，不修改或合併資料',()=>{
 const rows=buildServiceCatalog();
 for(const [index,name,price] of [[1,'洗剪吹',198],[2,'洗剪吹',100],[3,'洗剪吹',130],[4,'洗剪吹',150],[5,'洗剪吹',188],[6,'單剪',160],[7,'洗剪吹',208],[8,'洗吹',138]])rows.push({id:`new-${index}`,kind:'service',name,price,active:true,sort_order:300+index*10});
 rows.push({id:'p-high',kind:'product',name:'產品',price:200},{id:'p-low',kind:'product',name:'產品',price:80},{id:'disabled',kind:'service',name:'單剪',price:1,active:false});
 const snapshot=JSON.stringify(rows),sorted=sortedActiveCatalog(rows);
 assert.equal(JSON.stringify(rows),snapshot);assert.equal(sorted.length,40);assert.equal(new Set(sorted.map(x=>x.id)).size,40);
 assert.deepEqual(sorted.slice(0,11).map(x=>[x.name,x.price]),[['單剪',130],['單剪',160],['洗剪吹',100],['洗剪吹',130],['洗剪吹',150],['洗剪吹',168],['洗剪吹',188],['洗剪吹',198],['洗剪吹',208],['洗吹造型',108],['洗吹',138]]);
 const cold=sorted.map((x,i)=>x.name==='電髮（冷燙）'?i:-1).filter(i=>i>=0);assert.deepEqual(cold,[cold[0],cold[0]+1,cold[0]+2]);
 assert.deepEqual(sorted.slice(-2).map(x=>x.price),[80,200]);assert.ok(!sorted.some(x=>x.id==='disabled'));
 for(const item of sorted)assert.strictEqual(item,rows.find(r=>r.id===item.id));
});

test('空白與全半形括號只用作分組，不改原名；相同價格保持原次序',()=>{
 const rows=[{id:'a',name:'染髮',kind:'service',price:500},{id:'b',name:'單剪（長髮）',kind:'service',price:180},{id:'c',name:' 單剪(長髮) ',kind:'service',price:180},{id:'d',name:'染髮',kind:'service',price:300}];
 assert.deepEqual(sortedActiveCatalog(rows).map(r=>r.id),['b','c','d','a']);assert.equal(rows[2].name,' 單剪(長髮) ');assert.deepEqual(sortedActiveCatalog(),[]);
});
