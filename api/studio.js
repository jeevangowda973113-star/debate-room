const { guardRequest } = require("./_lib/guard.js");
const MAX_PROMPT = 4000;
function send(res,status,body){res.status(status).setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");return res.end(JSON.stringify(body));}
module.exports = async function handler(req,res){
 if(req.method==="OPTIONS"){res.setHeader("Allow","POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");return res.status(204).end();}
 if(req.method!=="POST")return send(res,405,{error:"Use POST."});
 const guard=await guardRequest(req,{name:"studio",limit:8,windowMs:60_000,maxBytes:20_000});
 if(!guard.ok)return send(res,guard.status,{error:guard.error});
 try{
  const body=req.body||{},action=String(body.action||""),prompt=String(body.prompt||"").trim();
  if(!prompt||prompt.length>MAX_PROMPT)return send(res,400,{error:"Enter a prompt up to 4,000 characters."});
  if(action==="image"){
   const key=process.env.GEMINI_API_KEY||process.env.GOOGLE_GEMINI_API_KEY;
   if(!key)return send(res,503,{error:"Gemini image generation is not configured. Add GEMINI_API_KEY in Vercel Environment Variables."});
   const model=String(process.env.THINKORA_GEMINI_IMAGE_MODEL||"gemini-nano-banana-2.1");
   const allowed=["1:1","16:9","9:16","4:3","3:4","4:5","5:4","3:2","2:3","21:9"];
   const aspect=allowed.includes(String(body.aspectRatio||"1:1"))?String(body.aspectRatio||"1:1"):"1:1";
   const response=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
    method:"POST",
    headers:{"x-goog-api-key":key,"Content-Type":"application/json"},
    body:JSON.stringify({model,input:[{type:"text",text:prompt}],response_format:{type:"image",mime_type:"image/png",aspect_ratio:aspect,image_size:"1K"}}),
    signal:AbortSignal.timeout(55_000)
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)return send(res,response.status===429?429:502,{error:data.error?.message||data.message||"Gemini image generation failed."});
   const imageData=data.output_image?.data;
   if(!imageData)return send(res,502,{error:"Gemini returned no image. Try a different prompt."});
   const mime=["image/png","image/jpeg","image/webp"].includes(data.output_image.mime_type)?data.output_image.mime_type:"image/png";
   if(typeof imageData!=="string"||imageData.length>12_000_000||!/^[A-Za-z0-9+/]+=*$/.test(imageData))return send(res,502,{error:"Gemini returned an invalid or oversized image."});
   return send(res,200,{ok:true,provider:"Gemini",output:["data:"+mime+";base64,"+imageData]});
  }
  if(action==="search"){
   const key=process.env.TAVILY_API_KEY;
   if(!key)return send(res,503,{error:"Web research is not configured. Add TAVILY_API_KEY in Vercel Environment Variables."});
   const response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:key,query:prompt,search_depth:"basic",max_results:6,include_answer:true}),signal:AbortSignal.timeout(20_000)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)return send(res,502,{error:data.message||"Search provider request failed."});
   const results=Array.isArray(data.results)?data.results.slice(0,6).map(x=>({title:String(x.title||"").slice(0,300),url:typeof x.url==="string"&&/^https:\/\//i.test(x.url)?x.url:"",content:String(x.content||"").slice(0,1800),score:Number.isFinite(x.score)?x.score:0})): [];
   return send(res,200,{ok:true,answer:String(data.answer||"").slice(0,5000),results});
  }
  return send(res,400,{error:"Unknown action. Use image or search."});
 }catch(error){return send(res,500,{error:String(error.message||"Studio request failed.").slice(0,240)});}
};