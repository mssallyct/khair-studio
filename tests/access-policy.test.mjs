import test from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_NAMES, can, homeSections, visibleViews, memberFor, auditFor, displayDataFor } from "../js/access-policy.js";
import { buildAdminWorkbook } from "../js/excel-export.js";
const principal = username => ({id:`admin-${username}`,username,role:"admin",active:true});

test("七個管理員的權限矩陣，只有Howood可讀電話",()=>{
  for(const name of ACCOUNT_NAMES){
    const p=principal(name),owner=["sally","howood"].includes(name);
    for(const action of ["settings","audit","export","revenue","catalog.write","team.write"])assert.equal(can(p,action),owner,`${name} ${action}`);
    assert.equal(can(p,"phone.read"),name==="howood");assert.equal(can(p,"phone.search"),name==="howood");
    if(!owner){assert.deepEqual(homeSections(p),["pending","today"]);assert.deepEqual(visibleViews(p),["dashboard","appointments","members","sales"]);}
    for(const action of ["members","appointments","sales","members.create","sales.create"])assert.equal(can(p,action),true);
  }
  for(const p of [null,{username:"howood"},{...principal("howood"),active:false},principal("unlisted")])assert.equal(can(p,"phone.read"),false);
});

test("會員輸出、搜尋資料、舊審計自由文字及Excel不洩露電話",()=>{
  const member={id:"m1",role:"member",name:"測試會員",phone:"9123 4567",email:"test@example.test",private_notes:"91234567",password_hash:"never"};
  const data={profiles:[member],appointments:[{member_id:"m1",note:"舊電話 +852 9234-5678"}],auditLog:[{summary:"新增：91234567；舊電話 92345678",created_at:"2026-11-19T04:00:00Z"}],extras:{phone:"91234567",text:["9123 4567"]}};
  const before=JSON.stringify(data);
  for(const name of ACCOUNT_NAMES.filter(n=>n!=="howood")){
    const p=principal(name);assert.equal(Object.hasOwn(memberFor(p,member),"phone"),false);
    const filtered=displayDataFor(p,data);const encoded=JSON.stringify(filtered);
    for(const v of ["9123","9234","never"])assert.ok(!encoded.includes(v),`${name}: ${v}`);
    if(name==="sally"){
      assert.equal(auditFor(p,data.auditLog)[0].created_at,"2026-11-19T04:00:00Z");
      const xlsx=new TextDecoder().decode(buildAdminWorkbook(filtered));assert.ok(!xlsx.includes("9123"));assert.ok(!xlsx.includes("9234"));
    }else assert.deepEqual(filtered.auditLog,[]);
  }
  assert.equal(memberFor(principal("howood"),member).phone,"9123 4567");assert.equal(JSON.stringify(data),before);
});
