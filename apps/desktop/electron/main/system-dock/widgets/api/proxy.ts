/**
 * [INPUT]: Depends on trusted Electron system routes, Node CONNECT/TLS, fixed Cloudflare DoH and public-address admission.
 * [OUTPUT]: Provides dedicated unauthenticated proxy tunnels and bounded public DNS resolution without author-selected routing.
 * [POS]: API network route boundary; only the OS chooses the proxy, and CONNECT authority is always a checked public IP.
 */
import {request as httpRequest} from 'node:http';
import {Agent,request as httpsRequest} from 'node:https';
import {isIP,type Socket} from 'node:net';
import {connect,checkServerIdentity,type TLSSocket} from 'node:tls';
import {session} from 'electron';
import {DOCK_API_BUDGET as B} from '@bottega/contracts/plugins/dock/api';
import {isPublicApiAddress} from './address';
import type {ApiRefreshBudget} from './transport';

export type ApiProxyRoute=Readonly<{kind:'direct'}>|Readonly<{kind:'http'|'https';hostname:string;port:number}>;
export class ApiProxyError extends Error{constructor(code:string,readonly status?:number,readonly networkCode?:string){super('DOCK_API_'+code);}}
const fail=(code:string,status?:number,networkCode?:string)=>new ApiProxyError(code,status,networkCode);
const DNS_HOST='cloudflare-dns.com',DNS_ADDRESS='1.1.1.1',DNS_BYTES=16*1024;
function charge(budget:ApiRefreshBudget,headers=0,body=0,attempt=false){
 if(attempt&&++budget.attempts>B.apiRefreshRequests)throw fail('REQUEST_BUDGET');
 budget.headerBytes+=headers;budget.responseBytes+=body;
 if(budget.headerBytes>B.apiHeaderBytes)throw fail('HEADER_BUDGET');if(budget.responseBytes>B.apiResponseBytes)throw fail('RESPONSE_BUDGET');
}
export function parseSystemApiRoute(value:string):ApiProxyRoute{
 const first=value.split(';',1)[0]?.trim();if(!first||/[\r\n\0]/.test(first))throw fail('PROXY_REQUIRED');if(first==='DIRECT')return{kind:'direct'};
 const match=/^(PROXY|HTTP|HTTPS)\s+(\S+)$/i.exec(first);if(!match)throw fail('PROXY_REQUIRED');
 const kind=match[1]!.toUpperCase()==='HTTPS'?'https':'http';let endpoint:URL;
 try{endpoint=new URL(kind+'://'+match[2]);}catch{throw fail('PROXY_REQUIRED');}
 if(endpoint.username||endpoint.password)throw fail('PROXY_AUTHENTICATION_REQUIRED',407);
 if(!endpoint.hostname||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw fail('PROXY_REQUIRED');
 const port=Number(endpoint.port||(kind==='https'?443:80));if(!Number.isInteger(port)||port<1||port>65535)throw fail('PROXY_REQUIRED');
 return{kind,hostname:endpoint.hostname.replace(/^\[|\]$/g,''),port};
}
export async function systemApiRoute(url:URL,signal:AbortSignal):Promise<ApiProxyRoute>{
 if(!session?.defaultSession||signal.aborted)throw fail('PROXY_REQUIRED');
 const raw=await new Promise<string>((resolve,reject)=>{
  const abort=()=>reject(fail('CANCELLED'));signal.addEventListener('abort',abort,{once:true});
  session.defaultSession.resolveProxy(url.origin).then(resolve,()=>reject(fail('PROXY_REQUIRED'))).finally(()=>signal.removeEventListener('abort',abort));
 });
 const route=parseSystemApiRoute(raw);
 if(route.kind==='direct'&&['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy'].some(name=>Boolean(process.env[name]?.trim())))throw fail('PROXY_REQUIRED');
 return route;
}
export async function proxyTlsSocket(route:Exclude<ApiProxyRoute,{kind:'direct'}>,hostname:string,address:string,port:number,budget:ApiRefreshBudget,signal:AbortSignal):Promise<TLSSocket>{
 if(!isPublicApiAddress(address)||!isIP(address))throw fail('ADDRESS_FORBIDDEN');if(signal.aborted)throw fail('CANCELLED');
 const authority=(isIP(address)===6?'['+address+']':address)+':'+port;
 charge(budget,Buffer.byteLength('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n\r\n'),0,true);
 const tunnel=await new Promise<Socket>((resolve,reject)=>{
  const request=route.kind==='https'?httpsRequest:httpRequest;
  const req=request({hostname:route.hostname,port:route.port,method:'CONNECT',path:authority,headers:{host:authority},agent:false,maxHeaderSize:16*1024,signal,
   ...(route.kind==='https'?{rejectUnauthorized:true,servername:isIP(route.hostname)?undefined:route.hostname,checkServerIdentity:(_name:string,cert:Parameters<typeof checkServerIdentity>[1])=>checkServerIdentity(route.hostname,cert)}:{})});
  req.once('connect',(response,socket,head)=>{
   try{charge(budget,Buffer.byteLength(response.rawHeaders.join('\r\n')));
    if(response.statusCode!==200)throw fail(response.statusCode===407?'PROXY_AUTHENTICATION_REQUIRED':'PROXY_REQUIRED',response.statusCode);
    if(head.length)throw fail('PROXY_RESPONSE_INVALID');
   }catch(error){socket.destroy();reject(error);return;}
   resolve(socket);
  });
  req.once('error',()=>reject(fail(signal.aborted?'CANCELLED':'PROXY_REQUIRED')));req.end();
 });
 return new Promise<TLSSocket>((resolve,reject)=>{
  const socket=connect({socket:tunnel,servername:isIP(hostname)?undefined:hostname,rejectUnauthorized:true,checkServerIdentity:(_name,certificate)=>checkServerIdentity(hostname,certificate),ALPNProtocols:['http/1.1']});
  const abort=()=>socket.destroy(fail('CANCELLED'));
  signal.addEventListener('abort',abort,{once:true});socket.once('close',()=>signal.removeEventListener('abort',abort));
  socket.once('error',(error:NodeJS.ErrnoException)=>{tunnel.destroy();const code=error.code&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:undefined;reject(fail(signal.aborted?'CANCELLED':'TLS_INVALID'+(code?'_'+code:''),undefined,code));});
  socket.once('secureConnect',()=>{if(!socket.authorized){socket.destroy();reject(fail('TLS_INVALID'));return;}resolve(socket);});if(signal.aborted)abort();
 });
}
export async function proxyApiAddress(route:Exclude<ApiProxyRoute,{kind:'direct'}>,hostname:string,budget:ApiRefreshBudget,signal:AbortSignal):Promise<string>{
 if(isIP(hostname)){if(!isPublicApiAddress(hostname))throw fail('ADDRESS_FORBIDDEN');return hostname;}
 const endpoint=new URL('https://'+DNS_HOST+'/dns-query');endpoint.searchParams.set('name',hostname);endpoint.searchParams.set('type','A');
 charge(budget,Buffer.byteLength(endpoint.href)+100,0,true);
 const agent=new Agent({keepAlive:false,maxSockets:1,maxCachedSessions:0});
 agent.createConnection=((_options,callback)=>{proxyTlsSocket(route,DNS_HOST,DNS_ADDRESS,443,budget,signal).then(socket=>callback!(null,socket),error=>{const safe=error instanceof ApiProxyError&&error.message.startsWith('DOCK_API_TLS_INVALID')?new ApiProxyError('DNS_'+error.message.slice('DOCK_API_'.length),error.status,error.networkCode):error;callback!(safe as Error,null as never);});return undefined;})as typeof agent.createConnection;
 try{
  const raw=await new Promise<Buffer>((resolve,reject)=>{
   const req=httpsRequest(endpoint,{agent,signal,maxHeaderSize:16*1024,headers:{accept:'application/dns-json',connection:'close'}},response=>{
    try{charge(budget,Buffer.byteLength(response.rawHeaders.join('\r\n')));if(response.statusCode!==200||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw fail('DNS_INVALID');}catch(error){response.destroy();reject(error);return;}
    const chunks:Buffer[]=[];let bytes=0;
    response.on('data',(chunk:Buffer)=>{try{bytes+=chunk.length;if(bytes>DNS_BYTES)throw fail('DNS_BUDGET');charge(budget,0,chunk.length);chunks.push(chunk);}catch(error){response.destroy();reject(error);}});
    response.once('aborted',()=>reject(fail('DNS_INVALID')));response.once('error',()=>reject(fail('DNS_INVALID')));response.once('end',()=>resolve(Buffer.concat(chunks,bytes)));
   });req.once('error',error=>reject(error));req.end();
  });
  let document:unknown;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw fail('DNS_INVALID');}
  const dns=document as{Status?:unknown;TC?:unknown;Question?:{name?:unknown;type?:unknown}[];Answer?:{name?:unknown;type?:unknown;data?:unknown}[]};
  if(dns.Status!==0||dns.TC===true||!Array.isArray(dns.Question)||dns.Question.length!==1||dns.Question[0]?.type!==1||typeof dns.Question[0].name!=='string'||dns.Question[0].name.replace(/\.$/,'').toLowerCase()!==hostname.toLowerCase()||!Array.isArray(dns.Answer)||dns.Answer.length>64)throw fail('DNS_INVALID');
  const addresses=dns.Answer.filter(answer=>answer.type===1||answer.type===28);
  if(!addresses.length||addresses.some(answer=>typeof answer.data!=='string'||!isIP(answer.data)||!isPublicApiAddress(answer.data)))throw fail('ADDRESS_FORBIDDEN');
  const selected=addresses.find(answer=>answer.type===1&&isIP(answer.data as string)===4);if(!selected)throw fail('DNS_INVALID');return selected.data as string;
 }finally{agent.destroy();}
}
