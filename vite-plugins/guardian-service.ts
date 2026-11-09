import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {DEFAULT_GUARDIAN_CONTROL,timePolicy,chinaDate,type GuardianControl,type LearningSnapshot} from '../src/lib/guardian-contract';
import {normalizeStudyTimePlan} from '../src/lib/study-time';
import {normalizeDaySchedule} from '../src/lib/day-schedule';
import {admissionComplete} from '../src/lib/admission-stage';
type Identity={id:string;phone:string};
type Binding={id:string;guardianId:string;studentId:string;studentPhone:string;relation:string;status:'active'|'revoked';createdAt:string;updatedAt:string};
type Student={phone:string;snapshot:LearningSnapshot;control:GuardianControl;usage:Record<string,number>;syncedAt:string;lastSeen?:number;lastActive?:boolean;codeHash?:string;codeExpires?:number};
type DB={guardians:Record<string,{id:string;username:string;salt:string;hash:string}>;sessions:Record<string,{guardianId:string;expires:number}>;students:Record<string,Student>;bindings:Binding[]};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const validPhone=(p:string)=>/^1\d{10}$/.test(p);
const normalizePhone=(p:string)=>p.replace(/^\+?86/,'');
function cleanControl(raw:any):GuardianControl{
 const c={...DEFAULT_GUARDIAN_CONTROL};
 for(const k of ['cultureEnabled','enableTimeLimit','enableWindow','allowSocial','cloudHistory','sound','showStreak'] as const)if(typeof raw?.[k]==='boolean')c[k]=raw[k];
 if(raw?.dailyLimitMinutes!==undefined){if(!Number.isInteger(raw.dailyLimitMinutes)||raw.dailyLimitMinutes<10||raw.dailyLimitMinutes>480)throw Error('每日上限须为10至480分钟');c.dailyLimitMinutes=raw.dailyLimitMinutes;}
 for(const k of ['allowedStart','allowedEnd'] as const){if(raw?.[k]!==undefined){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw[k]))throw Error('时段格式无效');c[k]=raw[k];}}
 if(c.enableWindow&&c.allowedStart===c.allowedEnd)throw Error('起止时间不能相同');
 if(['formal','balanced','cute'].includes(raw?.teacherTone))c.teacherTone=raw.teacherTone;
 if(['full','summary'].includes(raw?.socialView))c.socialView=raw.socialView;
 c.encourageMsg=String(raw?.encourageMsg||'').slice(0,500);
 if(raw?.editionPrefs&&['chinese','math','english'].every(k=>typeof raw.editionPrefs[k]==='string'&&raw.editionPrefs[k].length<100))c.editionPrefs={chinese:raw.editionPrefs.chinese,math:raw.editionPrefs.math,english:raw.editionPrefs.english};
 if(Array.isArray(raw?.daySchedule)&&raw.daySchedule.length<=30)c.daySchedule=normalizeDaySchedule(raw.daySchedule.map((x:any)=>({id:String(x.id||randomUUID()).slice(0,80),subjectLabel:String(x.subjectLabel||'').slice(0,40),start:String(x.start||''),end:String(x.end||''),subjectId:null}))); 
 if(raw?.studyTimePlan&&Number.isFinite(raw.studyTimePlan.dailyMinutes))c.studyTimePlan=normalizeStudyTimePlan(raw.studyTimePlan);
 return c;
}
function cleanSnapshot(s:any):LearningSnapshot{
 if(!s||!admissionComplete(s.admission)||typeof s.studentId!=='string'||s.studentId.length>100||!Number.isInteger(s.gradeYear)||s.gradeYear<1||s.gradeYear>12)throw Error('请先完成40项入学测评');
 return {studentId:s.studentId,name:String(s.name||'同学').slice(0,80),gradeYear:s.gradeYear,admission:s.admission,plans:s.plans||{},practices:(Array.isArray(s.practices)?s.practices:[]).slice(0,300).map((p:any)=>({createdAt:String(p.createdAt),subject:String(p.subject),knowledge:String(p.knowledge).slice(0,100),correct:Boolean(p.correct)})),mastery:(s.mastery||[]).slice(0,20).map((x:any)=>({label:String(x.label).slice(0,60),score:Math.min(100,Math.max(0,Number(x.score)||0))})),badges:(s.badges||[]).slice(0,100).map(String),studyDays:Math.max(0,Number(s.studyDays)||0),wrongBook:(s.wrongBook||[]).slice(0,50).map((x:any)=>({subject:String(x.subject),knowledge:String(x.knowledge),question:String(x.question),userAnswer:String(x.userAnswer)}))};
}
export function createGuardianService({dataFile,verifyStudent}:{dataFile:string;verifyStudent:(token:string)=>Promise<Identity>}){
 let queue=Promise.resolve();const attempts=new Map<string,{n:number;until:number}>();
 const limited=(key:string,max:number)=>{const now=Date.now(),old=attempts.get(key);const r=old&&old.until>now?old:{n:0,until:now+15*60*1000};r.n++;attempts.set(key,r);return r.n>max;};
 const load=async():Promise<DB>=>{try{return JSON.parse(await fs.readFile(dataFile,'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;return {guardians:{},sessions:{},students:{},bindings:[]};}};
 const save=async(db:DB)=>{await fs.mkdir(path.dirname(dataFile),{recursive:true});const temp=dataFile+'.tmp';await fs.writeFile(temp,JSON.stringify(db),{mode:0o600});await fs.rename(temp,dataFile);};
 const handle=async(req:IncomingMessage,res:ServerResponse)=>{
  const url=req.url?.split('?')[0]||'',host=req.headers.host||'';
  const send=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
  if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))return send(403,{error:'仅支持本机访问'});
  if(req.method!=='POST')return send(405,{error:'使用POST请求'});
  const origin=req.headers.origin;
  if(origin!==`http://${host}`||req.headers['x-ops-guardian']!=='1')return send(403,{error:'拒绝跨站请求'});
  let body='';let size=0;
  try{for await(const part of req){size+=Buffer.byteLength(part);if(size>6*1024*1024)return send(413,{error:'学情记录过大'});body+=part.toString();}const input=JSON.parse(body||'{}');const db=await load();
   if(url.startsWith('/api/student-link/')){
    const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)return send(401,{error:'请使用已验证手机号重新登录学生账号'});
    let identity:Identity;try{identity=await verifyStudent(token);}catch{return send(401,{error:'学生登录验证失败，请使用手机号登录后重试'});}
    const phone=normalizePhone(identity.phone||'');if(!validPhone(phone))return send(403,{error:'绑定需要已验证的学生手机号；邮箱账号请先验证手机号'});
    let student=db.students[identity.id];
    if(url.endsWith('/sync')){
     const snapshot=cleanSnapshot(input.snapshot);
     if(!student){if(Object.entries(db.students).some(([id,s])=>id!==identity.id&&s.phone===phone))return send(409,{error:'手机号归属不一致，请联系管理员'});student=db.students[identity.id]={phone,snapshot,control:cleanControl(input.snapshot.initialControl),usage:{},syncedAt:new Date().toISOString()};}
     if(!db.bindings.some(b=>b.studentId===identity.id))student.control=cleanControl(input.snapshot.initialControl);
     student.snapshot=snapshot;student.phone=phone;student.syncedAt=new Date().toISOString();
     const now=Date.now(),date=chinaDate();if(input.active===true&&student.lastActive&&student.lastSeen){const elapsed=Math.min(20,Math.max(0,(now-student.lastSeen)/1000));student.usage[date]=(student.usage[date]||0)+elapsed;}
     student.lastSeen=now;student.lastActive=input.active===true;
     await save(db);
    }
    if(!student)return send(409,{error:'请先在学生端完成测评并同步学情'});
    if(url.endsWith('/code')){
     if(limited('code:'+identity.id,10))return send(429,{error:'生成次数过多，请15分钟后重试'});
     const code=randomBytes(6).toString('hex').toUpperCase();student.codeHash=hash(code);student.codeExpires=Date.now()+10*60*1000;await save(db);return send(200,{code,expiresAt:new Date(student.codeExpires).toISOString(),phone});
    }
    if(!['/api/student-link/sync','/api/student-link/status'].includes(url))return send(404,{error:'接口不存在'});
    const binding=db.bindings.find(b=>b.studentId===identity.id&&b.status==='active');
    return send(200,{bound:Boolean(binding),control:student.control,seconds:student.usage[chinaDate()]||0,blocked:timePolicy(student.control,student.usage[chinaDate()]||0),syncedAt:student.syncedAt});
   }
   const cookie=req.headers.cookie?.match(/(?:^|; )ops_guardian=([^;]+)/)?.[1];const session=cookie?db.sessions[hash(cookie)]:undefined;
   let guardian=session&&session.expires>Date.now()?db.guardians[session.guardianId]:undefined;
   if(url.endsWith('/register')||url.endsWith('/login')){
    if(limited('auth:'+req.socket.remoteAddress,30))return send(429,{error:'尝试过于频繁，请15分钟后再试'});
    const username=String(input.username||'').trim().toLowerCase(),password=String(input.password||'');
    if(!/^[a-z0-9_-]{3,32}$/.test(username)||password.length<12||password.length>128)return send(400,{error:'用户名为3至32位字母数字，密码为12至128位'});
    guardian=Object.values(db.guardians).find(g=>g.username===username);
    if(url.endsWith('/register')){if(guardian)return send(409,{error:'该用户名已注册'});const salt=randomBytes(16).toString('hex');guardian={id:randomUUID(),username,salt,hash:scryptSync(password,salt,64).toString('hex')};db.guardians[guardian.id]=guardian;}
    else {const computed=scryptSync(password,guardian?.salt||'invalid-login-salt',64);if(!guardian||!timingSafeEqual(computed,Buffer.from(guardian.hash,'hex')))return send(401,{error:'用户名或密码不正确'});}
    const token=randomBytes(32).toString('hex');db.sessions[hash(token)]={guardianId:guardian.id,expires:Date.now()+7*86400000};for(const [k,s] of Object.entries(db.sessions))if(s.expires<Date.now())delete db.sessions[k];await save(db);res.setHeader('Set-Cookie',`ops_guardian=${token}; HttpOnly; SameSite=Strict; Path=/api/guardian; Max-Age=604800`);return send(200,{ok:true});
   }
   if(!guardian)return send(401,{error:'请先登录家长账号'});
   let binding=db.bindings.find(b=>b.guardianId===guardian!.id&&b.status==='active');
   if(url.endsWith('/logout')){if(cookie)delete db.sessions[hash(cookie)];res.setHeader('Set-Cookie','ops_guardian=; HttpOnly; SameSite=Strict; Path=/api/guardian; Max-Age=0');await save(db);return send(200,{ok:true});}
   if(url.endsWith('/bind')){
    if(binding)return send(409,{error:'首版支持一个孩子，请先解绑再更换'});
    if(limited('bind:'+guardian.id,8))return send(429,{error:'绑定尝试过多，请15分钟后重试'});
    const phone=normalizePhone(String(input.phone||'')),code=String(input.code||'').trim().toUpperCase();
    const entry=Object.entries(db.students).find(([,s])=>s.phone===phone&&s.codeExpires!>Date.now()&&s.codeHash===hash(code));
    if(!validPhone(phone)||!entry)return send(400,{error:'手机号或绑定码无效、已使用或已过期'});
    if(db.bindings.some(b=>b.studentId===entry[0]&&b.status==='active'))return send(409,{error:'该孩子已有有效监护绑定'});
    const relation=['父亲','母亲','监护人'].includes(input.relation)?input.relation:'监护人',at=new Date().toISOString();binding={id:randomUUID(),guardianId:guardian.id,studentId:entry[0],studentPhone:phone,relation,status:'active',createdAt:at,updatedAt:at};db.bindings.push(binding);delete entry[1].codeHash;delete entry[1].codeExpires;await save(db);return send(200,{ok:true});
   }
   if(url.endsWith('/me')){
    if(!binding)return send(200,{guardian:{username:guardian.username},binding:null});const s=db.students[binding.studentId];return send(200,{guardian:{username:guardian.username},binding:{id:binding.id,studentPhone:binding.studentPhone,relation:binding.relation,createdAt:binding.createdAt},snapshot:s.snapshot,control:s.control,usage:s.usage,syncedAt:s.syncedAt});
   }
   if(!binding)return send(403,{error:'请先绑定孩子'});
   if(url.endsWith('/control')){db.students[binding.studentId].control=cleanControl(input.control);await save(db);return send(200,{ok:true});}
   if(url.endsWith('/relation')){if(!['父亲','母亲','监护人'].includes(input.relation))return send(400,{error:'请选择有效关系'});binding.relation=input.relation;binding.updatedAt=new Date().toISOString();await save(db);return send(200,{ok:true});}
   if(url.endsWith('/unbind')){binding.status='revoked';binding.updatedAt=new Date().toISOString();const s=db.students[binding.studentId];s.control={...DEFAULT_GUARDIAN_CONTROL};delete s.codeHash;delete s.codeExpires;await save(db);return send(200,{ok:true});}
   send(404,{error:'接口不存在'});
  }catch(e){send(400,{error:e instanceof Error&&/测评|时段|上限|时间/.test(e.message)?e.message:'请求无效或本机保存失败'});}
 };
 return (req:IncomingMessage,res:ServerResponse,next:()=>void)=>{if(!req.url?.startsWith('/api/guardian/')&&!req.url?.startsWith('/api/student-link/'))return next();queue=queue.then(()=>handle(req,res),()=>handle(req,res));};
}
