/**
 * [INPUT]: Depends on Node IP parsing and canonical URL parsing.
 * [OUTPUT]: Provides strict public HTTPS destination and IPv4/IPv6 admission.
 * [POS]: Broker connection boundary; the same policy is used for declarations, resolved answers and connected peers.
 */
import {isIP} from 'node:net';

const v4Number=(address:string)=>address.split('.').reduce((value,part)=>value*256+Number(part),0);
const v4Ranges:readonly[string,number][]=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]];
function v6Number(address:string):bigint{
 const pieces=address.toLowerCase().split('::');
 const parse=(part:string)=>part?part.split(':').flatMap(value=>value.includes('.')?[((v4Number(value)>>>16)&65535).toString(16),(v4Number(value)&65535).toString(16)]:[value]):[];
 const left=parse(pieces[0]!),right=parse(pieces[1]??''),parts=pieces.length===2?[...left,...Array<string>(8-left.length-right.length).fill('0'),...right]:left;
 return parts.reduce((value,part)=>(value<<16n)+BigInt('0x'+part),0n);
}
function in6(value:bigint,address:string,bits:number){return value>>BigInt(128-bits)===v6Number(address)>>BigInt(128-bits);}
export function isPublicApiAddress(raw:string):boolean{
 const address=raw.startsWith('[')&&raw.endsWith(']')?raw.slice(1,-1):raw;
 if(address.includes('%'))return false;
 if(isIP(address)===4){const value=v4Number(address);return!v4Ranges.some(([base,bits])=>Math.floor(value/2**(32-bits))===Math.floor(v4Number(base)/2**(32-bits)));}
 if(isIP(address)!==6)return false;
 const value=v6Number(address);
 // Only global unicast is admitted. Transition, documentation and protocol-assignment ranges stay closed.
 return in6(value,'2000::',3)&&!in6(value,'2001::',23)&&!in6(value,'2001:db8::',32)&&!in6(value,'2002::',16)&&!in6(value,'3fff::',20);
}
export function apiDestination(raw:string):URL{
 let url:URL;try{url=new URL(raw);}catch{throw new Error('DOCK_API_DESTINATION_INVALID');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||/[\r\n\0]/.test(raw))throw new Error('DOCK_API_DESTINATION_INVALID');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 if(isIP(hostname)){if(!isPublicApiAddress(hostname))throw new Error('DOCK_API_ADDRESS_FORBIDDEN');}
 else if(hostname.length>253||!hostname.includes('.')||!hostname.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part))||/(?:^|\.)(?:localhost|local|internal|home|invalid|test|onion)$/i.test(hostname))throw new Error('DOCK_API_DESTINATION_INVALID');
 return url;
}
