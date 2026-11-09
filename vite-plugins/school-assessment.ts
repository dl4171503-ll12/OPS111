import type { Plugin, Connect } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
export function schoolAssessmentPlugin():Plugin{
 const attach=(app:Connect.Server,root:string)=>app.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/assessment-record')return next();
  const send=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(req.method!=='POST')return send(405,{error:'POST required'});
  const host=req.headers.host||'';
  if(!/^(localhost|127\.0\.0\.1):\d+$/.test(host)||req.headers.origin!==`http://${host}`||req.headers['x-assessment-record']!=='1')return send(403,{error:'本机同源请求限定'});
  try{
   let body='',size=0;for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>8*1024*1024)return send(413,{error:'记录过大'});body+=chunk.toString();}
   const data=JSON.parse(body);
   if(!/^[a-f0-9-]{36}$/.test(data.examId)||!Number.isInteger(data.gradeYear)||data.gradeYear<1||data.gradeYear>12||!data.answers||Array.isArray(data.answers)||Object.keys(data.answers).length>40||!Array.isArray(data.adjustments)||data.adjustments.length>40)return send(400,{error:'记录无效'});
   for(const [id,a] of Object.entries(data.answers) as [string,any][]){if(!/^admission-v2-\d+-(math|chinese|english|science|reflection)-\d+$/.test(id)||typeof a.value!=='string'||typeof a.reasoning!=='string'||!Number.isFinite(a.durationMs)||a.durationMs<0||!Array.isArray(a.steps)||!Array.isArray(a.strokes))return send(400,{error:'答案无效'});}
   const savedAt=new Date().toISOString(),dir=path.join(root,'.ops-data','assessment');await fs.mkdir(dir,{recursive:true});
   // 每次写独立快照，避免重试或不同请求完成顺序覆盖更完整的记录。
   const filename=`${data.examId}-${Object.keys(data.answers).length}-${crypto.randomUUID()}.json`;
   await fs.writeFile(path.join(dir,filename),JSON.stringify({examId:data.examId,gradeYear:data.gradeYear,answers:data.answers,adjustments:data.adjustments,completedAt:data.completedAt,savedAt}),{mode:0o600});
   send(200,{savedAt});
  }catch{send(500,{error:'本机服务保存失败'});}
 });
 return {name:'school-assessment',configureServer(s){attach(s.middlewares,s.config.root);},configurePreviewServer(s){attach(s.middlewares,s.config.root);}};
}
