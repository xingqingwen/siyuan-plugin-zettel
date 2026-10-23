import { KERNEL, TOKEN, NOTEBOOK as NB } from "./_env.mjs";
const K=KERNEL, T=TOKEN;
const post=async(u,p)=>(await (await fetch(K+u,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Token "+T},body:JSON.stringify(p||{})})).json());
(async()=>{
  const a=(await post("/api/filetree/createDocWithMd",{notebook:NB,path:"/_链接自检/A",markdown:"A 卡"})).data;
  const b=(await post("/api/filetree/createDocWithMd",{notebook:NB,path:"/_链接自检/B",markdown:"B 卡"})).data;
  await new Promise(r=>setTimeout(r,2500));
  const ap=await post("/api/block/appendBlock",{parentID:b,dataType:"markdown",data:`- 关联：((${a} "A 卡"))`});
  console.log("append resp code:", ap.code, "ops:", JSON.stringify(ap.data?.[0]?.doOperations?.map(o=>o.id)));
  const kd=await post("/api/block/getBlockKramdown",{id:b});
  console.log("B 正文:", JSON.stringify(kd.data?.kramdown).slice(0,300));
  for (const wait of [1000, 3000, 5000]) {
    await new Promise(r=>setTimeout(r,wait));
    const q=await post("/api/query/sql",{stmt:`SELECT count(*) c FROM refs WHERE def_block_id='${a}'`});
    console.log(`等待后 refs 计数(${wait}ms):`, q.data?.[0]?.c);
  }
  const all=await post("/api/query/sql",{stmt:`SELECT def_block_id, block_id FROM refs ORDER BY rowid DESC LIMIT 5`});
  console.log("最近 refs 行:", JSON.stringify(all.data));
  await post("/api/filetree/removeDocByID",{id:a}); await post("/api/filetree/removeDocByID",{id:b});
  console.log("已清理");
})();
