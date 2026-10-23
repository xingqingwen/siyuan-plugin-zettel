import { KERNEL, TOKEN, NOTEBOOK as NB } from "./_env.mjs";
const K=KERNEL, T=TOKEN;
const post=async(u,p)=>(await (await fetch(K+u,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Token "+T},body:JSON.stringify(p||{})})).json());
const cnt=async(id)=>(await post("/api/query/sql",{stmt:`SELECT count(*) c FROM refs WHERE def_block_id='${id}'`})).data?.[0]?.c;
(async()=>{
  const a=(await post("/api/filetree/createDocWithMd",{notebook:NB,path:"/_链接自检/C",markdown:"C 卡\n\n**我的判断**\n\n\n\n---\n\n> 原文\n\n来源：((x))"})).data;
  const b=(await post("/api/filetree/createDocWithMd",{notebook:NB,path:"/_链接自检/D",markdown:"D 卡"})).data;
  // 不做任何等待，模拟用户刚建完就点关联
  await post("/api/block/appendBlock",{parentID:b,dataType:"markdown",data:`- 关联：((${a} "C 卡"))`});
  for (const w of [500,1500,3000,6000]) { await new Promise(r=>setTimeout(r,w)); console.log(`+${w}ms refs:`, await cnt(a)); }
  await post("/api/filetree/removeDocByID",{id:a}); await post("/api/filetree/removeDocByID",{id:b});
})();
