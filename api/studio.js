const MAX_PROMPT = 4000;
function send(res,status,body){res.status(status).setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");return res.end(JSON.stringify(body));}
module.exports = async function handler(req,res){
 if(req.method==="OPTIONS"){res.setHeader("Allow","POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");return res.status(204).end();}
 if(req.method!=="POST")return send(res,405,{error:"Use POST."});
 try{
  const body=req.body||{},action=String(body.action||""),prompt=String(body.prompt||"").trim();
  if(!prompt||prompt.length>MAX_PROMPT)return send(res,400,{error:"Enter a prompt up to 4,000 characters."});
  if(action==="image"){
   const token=process.env.REPLICATE_API_TOKEN;
   if(!token)return send(res,503,{error:"Image generation is not configured. Add REPLICATE_API_TOKEN in Vercel Environment Variables."});
   const model=String(process.env.THINKORA_IMAGE_MODEL||"black-forest-labs/flux-schnell");
   if(!/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(model))return send(res,500,{error:"THINKORA_IMAGE_MODEL must use owner/model format."});
   const created=await fetch("https://api.replicate.com/v1/models/"+model+"/predictions",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({input:{prompt,aspect_ratio:String(body.aspectRatio||"1:1"),num_outputs:1}})});
   const prediction=await created.json().catch(()=>({}));
   if(!created.ok)return send(res,502,{error:prediction.detail||prediction.title||"Image provider request failed."});
   let result=prediction;
   for(let i=0;i<35&&result.status!=="succeeded"&&result.status!=="failed"&&result.status!=="canceled";i++){
    await new Promise(resolve=>setTimeout(resolve,1500));
    const poll=await fetch(result.urls?.get||"https://api.replicate.com/v1/predictions/"+encodeURIComponent(result.id),{headers:{Authorization:"Bearer "+token}});
    result=await poll.json().catch(()=>result);
    if(!poll.ok)break;
   }
   if(result.status==="succeeded")return send(res,200,{ok:true,output:result.output});
   if(result.status==="failed"||result.status==="canceled")return send(res,502,{error:result.error||"Image generation failed."});
   return send(res,202,{ok:false,pending:true,message:"Image is still processing. Please try again in a moment.",predictionId:result.id});
  }
  if(action==="search"){
   const key=process.env.TAVILY_API_KEY;
   if(!key)return send(res,503,{error:"Web research is not configured. Add TAVILY_API_KEY in Vercel Environment Variables."});
   const response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:key,query:prompt,search_depth:"basic",max_results:6,include_answer:true})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)return send(res,502,{error:data.message||"Search provider request failed."});
   return send(res,200,{ok:true,answer:data.answer||"",results:(data.results||[]).map(x=>({title:x.title,url:x.url,content:x.content,score:x.score}))});
  }
  return send(res,400,{error:"Unknown action. Use image or search."});
 }catch(error){return send(res,500,{error:String(error.message||"Studio request failed.").slice(0,240)});}
};