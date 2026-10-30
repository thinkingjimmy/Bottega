/**
 * [INPUT]: Depends on Node DNS/TCP/TLS/HTTPS, trusted system proxy routing, streaming decompression and the shared public-address policy.
 * [OUTPUT]: Provides bounded direct or public-IP CONNECT HTTPS attempts, verified TLS, manual redirects and no ambient authentication.
 * [POS]: Main-only API transport; all credentials and final request bytes come from the broker after grant validation.
 */
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {Agent,request} from 'node:https';
import {connect,checkServerIdentity,type TLSSocket} from 'node:tls';
import {createBrotliDecompress,createUnzip} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {DOCK_API_BUDGET as B} from '@bottega/contracts/plugins/dock/api';
import {apiDestination,isPublicApiAddress} from './address';
import {systemApiRoute,proxyApiAddress,proxyTlsSocket,ApiProxyError} from './proxy';

export type ApiWireRequest=Readonly<{url:URL;method:'GET'|'HEAD'|'POST';headers:Readonly<Record<string,string>>;body?:string}>;
export type ApiWireResponse=Readonly<{status:number;body:Buffer;headers:Readonly<{etag?:string;lastModified?:string;contentLength?:string;retryAfter?:string;location?:string}>;network?:Readonly<{route:'direct'|'http-proxy'|'https-proxy';address:string}>}>;
export type ApiRefreshBudget={attempts:number;headerBytes:number;responseBytes:number;deadline:number};
export type ApiTransport=(input:ApiWireRequest,budget:ApiRefreshBudget,signal:AbortSignal)=>Promise<ApiWireResponse>;
export class ApiTransportError extends Error{constructor(code:string,readonly sent:boolean,readonly status?:number,readonly networkCode?:string){super(code);}}
const failure=(code:string)=>new ApiTransportError('DOCK_API_'+code,false);
function abortable<T>(task:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(failure('CANCELLED'));
 return new Promise<T>((resolve,reject)=>{const abort=()=>reject(failure('CANCELLED'));signal.addEventListener('abort',abort,{once:true});task.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
async function checkedAddress(url:URL,signal:AbortSignal){
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 const answers=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await abortable(lookup(hostname,{all:true,verbatim:true}),signal);
 if(!answers.length||answers.some(answer=>!isPublicApiAddress(answer.address))){
  const synthetic=answers.some(answer=>answer.address.startsWith('198.18.')||answer.address.startsWith('198.19.')||/^2001:0*2:/i.test(answer.address));
  if(synthetic)throw failure('PROXY_REQUIRED');
  throw failure('ADDRESS_FORBIDDEN');
 }
 return{hostname,address:answers[0]!.address};
}
function checkedSocket(url:URL,hostname:string,address:string,signal:AbortSignal):Promise<TLSSocket>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(failure('CANCELLED'));return;}
  const socket=connect({host:address,port:Number(url.port||443),servername:isIP(hostname)?undefined:hostname,rejectUnauthorized:true,
   checkServerIdentity:(_name,certificate)=>checkServerIdentity(hostname,certificate),ALPNProtocols:['http/1.1']});
  const abort=()=>socket.destroy(failure('CANCELLED'));
  const rejectSocket=(error:Error)=>{signal.removeEventListener('abort',abort);reject(error);};
  signal.addEventListener('abort',abort,{once:true});socket.once('error',rejectSocket);
  socket.once('secureConnect',()=>{
   const peer=socket.remoteAddress?.replace(/^::ffff:/i,'');
   if(!socket.authorized||!peer||!isPublicApiAddress(peer)||peer.toLowerCase()!==address.toLowerCase()){
    socket.destroy();signal.removeEventListener('abort',abort);reject(failure('ADDRESS_FORBIDDEN'));return;
   }
   socket.removeListener('error',rejectSocket);socket.on('error',()=>{});
   socket.once('close',()=>signal.removeEventListener('abort',abort));resolve(socket);
  });
 });
}
export const directApiRequest:ApiTransport=async(input,budget,parentSignal)=>{
 let sent=false;
 const url=apiDestination(input.url.href);
 if(++budget.attempts>B.apiRefreshRequests)throw failure('REQUEST_BUDGET');
 if(performance.now()>=budget.deadline)throw failure('DEADLINE');
 const headers:Record<string,string>={accept:'application/json','accept-encoding':'gzip, deflate, br',connection:'close',host:url.host,...input.headers};
 if(input.body!==undefined){headers['content-type']='application/json';headers['content-length']=String(Buffer.byteLength(input.body));}
 const headerBytes=Buffer.byteLength(Object.entries(headers).map(([name,value])=>name+': '+value+'\r\n').join(''));
 if(headerBytes+Buffer.byteLength(url.href)+Buffer.byteLength(input.body??'')>B.apiRequestBytes)throw failure('REQUEST_BUDGET');
 budget.headerBytes+=headerBytes;if(budget.headerBytes>B.apiHeaderBytes)throw failure('HEADER_BUDGET');
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,Math.max(1,budget.deadline-performance.now()));timer.unref?.();
 parentSignal.addEventListener('abort',abort,{once:true});if(parentSignal.aborted)controller.abort();
 const signal=controller.signal,agent=new Agent({keepAlive:false,maxSockets:1,maxCachedSessions:0});
 try{
  const route=await systemApiRoute(url,signal),hostname=url.hostname.replace(/^\[|\]$/g,'');
  const address=route.kind==='direct'?(await checkedAddress(url,signal)).address:await proxyApiAddress(route,hostname,budget,signal);
  // The request does not receive its socket until TLS and peer validation finish.
  agent.createConnection=((_options,callback)=>{(route.kind==='direct'?checkedSocket(url,hostname,address,signal):proxyTlsSocket(route,hostname,address,Number(url.port||443),budget,signal)).then(socket=>callback!(null,socket),error=>callback!(error as Error,null as never));return undefined;})as typeof agent.createConnection;
  return await new Promise<ApiWireResponse>((resolve,reject)=>{
   const req=request(url,{method:input.method,headers,agent,maxHeaderSize:B.apiHeaderBytes,signal},response=>{
    budget.headerBytes+=Buffer.byteLength(response.rawHeaders.join('\r\n'));
    if(budget.headerBytes>B.apiHeaderBytes){response.destroy();reject(failure('HEADER_BUDGET'));return;}
    const one=(name:string)=>{const value=response.headers[name];return typeof value==='string'?value:undefined;};
    const resultHeaders={etag:one('etag'),lastModified:one('last-modified'),contentLength:one('content-length'),retryAfter:one('retry-after'),location:one('location')};
    const encoding=(one('content-encoding')??'identity').trim().toLowerCase();
    if(!['identity','gzip','deflate','br'].includes(encoding)){response.destroy();reject(failure('ENCODING_INVALID'));return;}
    const decoder=input.method==='HEAD'||encoding==='identity'?null:encoding==='br'?createBrotliDecompress():createUnzip();
    const stream=decoder?response.pipe(decoder):response,chunks:Buffer[]=[];let bytes=0,encoded=0,finished=false;
    const fail=(error:Error)=>{if(finished)return;finished=true;response.destroy();decoder?.destroy();reject(error);};
    response.on('data',(chunk:Buffer)=>{encoded+=chunk.length;if(encoded>B.apiResponseBytes)fail(failure('RESPONSE_BUDGET'));});
    response.once('aborted',()=>fail(failure('RESPONSE_INCOMPLETE')));response.once('error',()=>fail(failure('NETWORK')));
    stream.on('data',(raw:Buffer)=>{const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);bytes+=chunk.length;budget.responseBytes+=chunk.length;
     if(budget.responseBytes>B.apiResponseBytes){fail(failure('RESPONSE_BUDGET'));return;}chunks.push(chunk);
    });
    stream.once('error',()=>fail(failure('ENCODING_INVALID')));
    stream.once('end',()=>{if(finished)return;finished=true;resolve({status:response.statusCode??0,headers:resultHeaders,body:Buffer.concat(chunks,bytes),network:{route:route.kind==='direct'?'direct':route.kind==='http'?'http-proxy':'https-proxy',address}});});
   });
   req.once('finish',()=>{sent=true;});req.once('error',error=>reject(signal.aborted?failure(parentSignal.aborted?'CANCELLED':'DEADLINE'):error));
   if(input.body!==undefined)req.end(input.body);else req.end();
  });
 }catch(error){
  const rawCode=error instanceof ApiProxyError?error.networkCode:(error as NodeJS.ErrnoException|null)?.code,networkCode=typeof rawCode==='string'&&/^[A-Z0-9_]{1,80}$/.test(rawCode)?rawCode:undefined;
  throw new ApiTransportError(signal.aborted?'DOCK_API_'+(parentSignal.aborted?'CANCELLED':'DEADLINE'):error instanceof Error?error.message:'DOCK_API_NETWORK',sent,error instanceof ApiProxyError?error.status:undefined,networkCode);
 }
 finally{clearTimeout(timer);parentSignal.removeEventListener('abort',abort);agent.destroy();}
};
