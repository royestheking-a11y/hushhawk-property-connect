function json(data,status=200,extra={}){
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
}
function identity(request){
  const id=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  return id&&email?{id,email}:null;
}
function asset(name,privatePage=false,url=new URL('https://localhost/')){
  const file=assets[name];
  if(!file)return new Response('Not found',{status:404});
  return new Response(Uint8Array.from(atob(file.body),c=>c.charCodeAt(0)),{headers:securityHeaders(url,{
    'Content-Type':file.type,'Cache-Control':privatePage?'no-store':'no-cache'
  })});
}
const lists=['properties','contacts','threads','tickets','tasks','events','calls','approvals','rules','runs','templates','knowledge','team','audit','leads','providerEvents','scheduled'];
function validState(state){
  return state && typeof state==='object' && lists.every(key=>Array.isArray(state[key])) &&
    ['settings','draft','billing','integrations'].every(key=>state[key]&&typeof state[key]==='object'&&!Array.isArray(state[key]));
}
async function workspace(request,env,url){
  const user=identity(request);
  if(!user)return json({error:'Sign in to your authorized account.'},401);
  if(!env.DB)return json({error:'Workspace storage is unavailable.'},503);
  try{
    return await workspaceRoute(request,env,url,user.id,{actor:user.email,email:user.email,extra:request.method==='GET'?{sms:smsConnection(env,user.id)}:{}});
  }catch(error){
    if(error.status)return json({error:error.message},error.status);
    throw error;
  }
}
export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/email/inbound'&&request.method==='POST'){
    try{return await emailInbound(request,env,url,ctx);}catch(error){console.error(error);return new Response('Email intake could not be saved',{status:503});}
  }
  if(url.pathname==='/api/email/events'&&request.method==='POST'){
    try{return await emailEvents(request,env,url);}catch{return new Response('Email event could not be saved',{status:503});}
  }
  if(/^\/api\/files\/[a-f0-9-]{36}$/.test(url.pathname)&&request.method==='GET'){
    try{return await fileRoute(request,env,url);}catch{return json({error:'File unavailable.'},503);}
  }
  if(['/api/sms/inbound','/api/sms/status'].includes(url.pathname)){
    try{return await smsWebhook(request,env,url,ctx);}catch{return new Response('SMS intake could not be saved',{status:503});}
  }
  if(url.pathname==='/api/admin/sms/send'){
    try{return await sendAdminSms(request,env,url,identity(request));}catch{return json({error:'Check the timeline before retrying. The send result could not be confirmed.'},503);}
  }
  if(/^\/api\/(me|workspace|workspace\/changes|auth\/[a-z-]+|ai\/[a-z-]+|public\/[a-z]+|billing\/[a-z]+|stripe\/webhook|company\/[a-z-]+|super\/[a-z-]+)$/.test(url.pathname))return accountsApi(request,env,url);
  if(url.pathname==='/api/admin/workspace'||url.pathname==='/api/admin/workspace/changes'){
    try{return await workspace(request,env,url);}catch{return json({error:'Workspace storage could not be reached.'},503);}
  }
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method unavailable',{status:405});
  if(url.pathname==='/admin'||url.pathname==='/admin/'){
    if(!identity(request))return Response.redirect(new URL('/signin-with-chatgpt?return_to=%2Fadmin%2F',url),302);
    return asset('index.html',true,url);
  }
  if(url.pathname==='/')return asset('index.html',false,url);
  return /^\/[a-zA-Z0-9._-]+$/.test(url.pathname)?asset(url.pathname.slice(1),false,url):new Response('Not found',{status:404});
},
// Cron trigger: advances trials, renewals, grace periods and cancellations.
async scheduled(event,env,ctx){if(env.DB)ctx.waitUntil(cronTick(env));}};
// Exposed for tests and the local preview.
export const internals={loadState,createWorkspace,runJobs,cronTick,smsSegments};
