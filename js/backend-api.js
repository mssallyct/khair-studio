// Token stays in memory. No phone data or credentials are written into browser
// storage by this client. A lost connection never falls back to DemoStore.
export class BackendApi {
  constructor(config) {
    const url=new URL(config.backendUrl,globalThis.location?.href);
    if(url.protocol!=="https:" && !["localhost","127.0.0.1"].includes(url.hostname))throw new Error("後端必須使用HTTPS。");
    this.base=url.href.replace(/\/$/,"");this.token=null;this.profile=null;this.demoMode=false;this.backendMode=true;
  }
  async request(path,{method="GET",body}={}){
    // Use POST for authenticated reads as well: an older installed v19 worker
    // cached arbitrary GET responses regardless of Cache-Control.
    if(method==="GET"){method="POST";path=`/query${path}`;body={};}
    const response=await fetch(`${this.base}${path}`,{method,headers:{"Content-Type":"application/json",...(this.token?{Authorization:`Bearer ${this.token}`}:{})},credentials:"omit",cache:"no-store",...(body?{body:JSON.stringify(body)}:{})});
    let result;try{result=await response.json();}catch{throw new Error("後端回覆無法讀取，請勿重複收款。");}
    if(!response.ok){if(response.status===401){this.token=null;this.profile=null;}throw new Error(result.error || "未能連接後端；沒有切換至本機資料。");}
    return result;
  }
  async signIn(username,password){const r=await this.request("/login",{method:"POST",body:{username,password}});this.token=r.accessToken;this.profile=r.profile;return {user:{id:r.profile.id},expires_at:r.expiresAt};}
  async signOut(){try{await this.request("/logout",{method:"POST",body:{}});}finally{this.token=null;this.profile=null;}}
  async getSession(){return this.token?{user:{id:this.profile.id}}:null;}
  async getProfile(){return this.token?this.request("/session"):null;}
  async getAdminDashboard(){
    const meta=await this.request("/workspace");
    if(!meta.paged || !Array.isArray(meta.collections))throw new Error("後端資料版本不相符，已停止載入。");
    const result={auditLog:[],rewardWallets:{}};
    await Promise.all(meta.collections.map(async name=>{
      if(!["profiles","appointments","sales","saleItems","stamps","referrals","catalog","stylists","assistants","auditLog","rewardWallets"].includes(name))throw new Error("未知資料類別。");
      const rows=[];let cursor=0;
      while(cursor!==null){
        const page=await this.request(`/records?collection=${name}&revision=${encodeURIComponent(meta.revision)}&cursor=${cursor}`);
        if(!Array.isArray(page.items) || page.revision!==meta.revision || page.nextCursor!==null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor<=cursor))throw new Error("資料讀取不完整，請重新載入。");
        rows.push(...page.items);cursor=page.nextCursor;
      }
      result[name]=name==="rewardWallets" ? Object.fromEntries(rows.map(row=>[row.id,row.wallet])) : rows;
    }));
    return result;
  }
  async getCatalog(){return this.request("/catalog");}
  async searchMembers(query){return this.request('/members/search',{method:'POST',body:{query}});}
  async createMember(input){return this.request("/members",{method:"POST",body:input});}
  async updateMemberJoinedDate(memberId,joinedDate){return this.request("/members/joined-date",{method:"POST",body:{memberId,joinedDate}});}
  async reviewRewardOpening(input){return this.request("/members/rewards/opening",{method:"POST",body:input});}
  async importLegacy(snapshot){return this.request("/migration/import",{method:"POST",body:{snapshot,confirmed:true}});}
  async completeSale(input){return this.request("/sales",{method:"POST",body:{requestId:input.requestId,memberId:input.memberId,appointmentId:input.appointmentId,stylistId:input.stylistId,assistantId:input.assistantId,couponId:input.couponId || null,expectedFinalAmount:input.expectedFinalAmount,items:input.items.map(i=>({catalogId:i.catalogId,quantity:Number(i.quantity)}))}});}
  async action(name,args){return this.request(`/actions/${name}`,{method:"POST",body:{args}});}
  createAppointment(input){return this.action("createAppointment",[input]);}
  updateAppointmentStatus(id,status){return this.action("updateAppointmentStatus",[id,status]);}
  cancelAppointment(id,memberId){return this.action("cancelAppointment",[id,memberId]);}
  createCatalogItem(input){return this.action("createCatalogItem",[input]);}
  updateCatalogItem(id,input){return this.action("updateCatalogItem",[id,input]);}
  deleteCatalogItem(id){return this.action("deleteCatalogItem",[id]);}
  createStylist(name){return this.action("createStylist",[name]);}
  deleteStylist(id){return this.action("deleteStylist",[id]);}
  createAssistant(name){return this.action("createAssistant",[name]);}
  deleteAssistant(id){return this.action("deleteAssistant",[id]);}
  adjustStamps(input){return this.action("adjustStamps",[input]);}
}
