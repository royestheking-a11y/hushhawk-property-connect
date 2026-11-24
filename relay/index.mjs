// Optional public Worker for Twilio callbacks to an owner-private Sites deployment.
const routes=new Set(['/api/sms/inbound','/api/sms/status']);
export default {async fetch(request,env){
  const incoming=new URL(request.url);
  if(request.method!=='POST'||!routes.has(incoming.pathname))return new Response('Not found',{status:404});
  if(!env.HUSHHAWK_SITE_ORIGIN||!env.HUSHHAWK_SITE_SERVICE_TOKEN)return new Response('Relay is unavailable',{status:503});
  const signature=request.headers.get('X-Twilio-Signature');
  if(!signature||!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return new Response('Invalid request',{status:400});
  const payload=await request.text();
  if(payload.length>32000)return new Response('Request is too large',{status:413});
  const destination=new URL(incoming.pathname+incoming.search,env.HUSHHAWK_SITE_ORIGIN);
  const response=await fetch(destination,{method:'POST',redirect:'manual',headers:{
    'Content-Type':'application/x-www-form-urlencoded',
    'X-Twilio-Signature':signature,
    'OAI-Sites-Authorization':'Bearer '+env.HUSHHAWK_SITE_SERVICE_TOKEN
  },body:payload,signal:AbortSignal.timeout(8000)});
  if(response.status>=300&&response.status<400)return new Response('Site service access was rejected',{status:503});
  const forwarded=new Headers({'Cache-Control':'no-store'});
  if(response.headers.has('Content-Type'))forwarded.set('Content-Type',response.headers.get('Content-Type'));
  return new Response(response.body,{status:response.status,headers:forwarded});
}};
