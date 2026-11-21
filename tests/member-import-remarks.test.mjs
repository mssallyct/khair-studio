import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from '../server/gateway.mjs';
import {normalizeRemarks} from '../js/member-remarks.js';
import {membershipInfo} from '../js/rules.js';
import {memberFor} from '../js/access-policy.js';
const actor=username=>({id:`admin-${username}`,username,name:username,role:'admin',active:true});
const hash='a'.repeat(64);
const row=(sourceRow=2)=>({sourceRow,name:`匯入測試${sourceRow}`,phone:null,birthday:null,joinedDate:null,stamps:null,hairVisits:null,remarks:['第一點','第二點']});
function harness(username='howood'){
 let data={profiles:[{id:'old',role:'member',name:'原有會員',phone:'9123 4567',remarks:['原有 9123 4567','保留備註']}],sales:[{id:'old-sale',final_amount:600}],saleItems:[],stampLedger:[],appointments:[],referrals:[],rewardWallets:{},auditLog:[],catalog:[],stylists:[],assistants:[]};
 let queue=Promise.resolve();
 const gateway=createGateway({clock:()=>new Date('2026-11-21T04:00:00Z'),authenticate:async req=>req.headers.get('Authorization')==='Bearer test'?actor(username):null,repository:{read:async()=>structuredClone(data),transaction:fn=>{const job=queue.then(async()=>{const copy=structuredClone(data),result=await fn(copy);data=copy;return result;});queue=job.catch(()=>{});return job;}}});
 const call=(path,body,authenticated=true)=>gateway(new Request(`https://example.test/api${path}`,{method:body?'POST':'GET',headers:authenticated?{Authorization:'Bearer test'}:{},...(body?{body:JSON.stringify(body)}:{})}));
 return {call,data:()=>data};
}
test('備註空白、逐點文字及長度驗證',()=>{
 assert.deepEqual(normalizeRemarks(null),[]);assert.deepEqual(normalizeRemarks(' 甲\n\n乙 '),['甲','乙']);
 assert.deepEqual(normalizeRemarks(['一格\n兩行','第二格']),['一格\n兩行','第二格']);
 for(const bad of [12,[null],['x'.repeat(2001)],Array(101).fill('x')])assert.throws(()=>normalizeRemarks(bad));
});
test('所有已登入管理員可新增及逐點刪除，保留原備註、消費並記實際操作者',async()=>{
 for(const username of ['howood','sally','admin135','newstaff']){
  const h=harness(username),before=structuredClone(h.data().sales);
  assert.equal((await h.call('/members/remarks',{memberId:'old',operation:'append',remarks:'新一點\n新二點',expectedVersion:0})).status,200);
  assert.deepEqual(h.data().profiles[0].remarks,['原有 9123 4567','保留備註','新一點','新二點']);
  assert.equal(h.data().auditLog.at(-1).actor_username,username);
  assert.equal((await h.call('/members/remarks',{memberId:'old',operation:'delete',index:1,expectedVersion:1})).status,200);
  assert.deepEqual(h.data().profiles[0].remarks,['原有 9123 4567','新一點','新二點']);
  assert.equal(h.data().auditLog.at(-1).action,'member.remark_deleted');assert.deepEqual(h.data().sales,before);
  const displayed=memberFor(actor(username),h.data().profiles[0]);assert.equal(JSON.stringify(displayed).includes('9123'),username==='howood');
 }
});
test('備註競爭更新只容許一個版本成功，過期刪除及無登入不寫入',async()=>{
 const h=harness(),body={memberId:'old',operation:'append',remarks:'新點',expectedVersion:0};
 const results=await Promise.all([h.call('/members/remarks',body),h.call('/members/remarks',body)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const before=JSON.stringify(h.data());
 for(const [payload,status] of [[{operation:'delete',index:0,expectedVersion:0},409],[{operation:'delete',index:99,expectedVersion:1},400],[{operation:'append',remarks:' ',expectedVersion:1},400]])assert.equal((await h.call('/members/remarks',{memberId:'old',...payload})).status,status);
 assert.equal((await h.call('/members/remarks',body,false)).status,401);assert.equal(JSON.stringify(h.data()),before);
});
test('匯入保留空白、月份及原始結餘，不猜入會日期、不產生消費或優惠券',async()=>{
 const h=harness(),before=structuredClone(h.data());
 const input={sourceHash:hash,rows:[row(),{...row(3),phone:'61234567',birthday:'03',joinedDate:'2026-01-01',stamps:3,hairVisits:9}]};
 const response=await h.call('/members/import',input);assert.equal(response.status,200);assert.equal((await response.json()).added,2);
 const blank=h.data().profiles[1],filled=h.data().profiles[2];
 for(const key of ['phone','email','birthday','joined_date','referral_code'])assert.equal(blank[key],null);
 assert.deepEqual(blank.import_opening,{stamps:null,hairVisits:null});assert.equal(membershipInfo(blank).joinedDate,null);
 assert.equal(filled.birthday,'03');assert.equal(filled.phone,'6123 4567');assert.deepEqual(filled.import_opening,{stamps:3,hairVisits:9});
 for(const key of ['sales','saleItems','stampLedger','rewardWallets','appointments','referrals'])assert.deepEqual(h.data()[key],before[key]);
 assert.deepEqual(h.data().profiles[0],before.profiles[0]);assert.deepEqual(blank.remarks,['第一點','第二點']);
 const retry=await(await h.call('/members/import',input)).json();assert.equal(retry.added,0);assert.equal(retry.skipped,2);assert.equal(h.data().profiles.length,3);
 const snapshot=JSON.stringify(h.data());
 assert.equal((await h.call('/members/import',{sourceHash:hash,rows:[{...row(),name:'改名'}]})).status,400);assert.equal(JSON.stringify(h.data()),snapshot);
});
test('只有Howood可匯入，重複電話／錯誤欄位整批回滾，不覆蓋舊資料',async()=>{
 for(const username of ['sally','admin135']){const h=harness(username);assert.equal((await h.call('/members/import',{sourceHash:hash,rows:[row()]})).status,403);assert.equal(h.data().profiles.length,1);}
 for(const bad of [{phone:'91234567'},{phone:'1234'},{name:'原有會員'},{joinedDate:'2026-02-30'},{stamps:'4,'},{hairVisits:10}]){
  const h=harness(),before=JSON.stringify(h.data());assert.equal((await h.call('/members/import',{sourceHash:hash,rows:[row(),{...row(3),...bad}]})).status,400);assert.equal(JSON.stringify(h.data()),before);
 }
});
