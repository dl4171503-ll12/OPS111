import {loadEnv,type Plugin} from 'vite';
import path from 'node:path';
import {createGuardianService} from './guardian-service';
export function guardianPlugin(root:string):Plugin{
 const env=loadEnv('development',root,'');const cache=new Map<string,{at:number;identity:{id:string;phone:string}}>();
 const service=createGuardianService({dataFile:path.join(root,'.ops-data','guardian','database.json'),verifyStudent:async(token)=>{
  const cached=cache.get(token);if(cached&&Date.now()-cached.at<60000)return cached.identity;
  const response=await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('invalid session');const user=await response.json();if(!user.id||!user.phone||!user.phone_confirmed_at)throw Error('verified phone required');const identity={id:user.id,phone:user.phone};if(cache.size>100)cache.clear();cache.set(token,{at:Date.now(),identity});return identity;
 }});
 return {name:'ops-guardian-service',configureServer(s){s.middlewares.use(service);},configurePreviewServer(s){s.middlewares.use(service);}};
}
