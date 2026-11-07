/**
 * [INPUT]: The packaged macOS Core Location Node-API module and cancellation.
 * [OUTPUT]: On-demand one-shot system location with explicit prompting and bounded lifetime.
 * [POS]: Main-only native adapter; coordinates stay in this process.
 */
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
type Point={latitude:number;longitude:number};
type NativeLocation={request(id:string,prompt:boolean,callback:(error:string|null,point:Point|null)=>void):void;cancel(id:string):void};
export class WeatherLocationOwner{
 private native?:NativeLocation;
 constructor(private readonly directory:string){}
 async current(prompt:boolean,signal:AbortSignal):Promise<Point>{
  signal.throwIfAborted();
  if(process.platform!=='darwin')throw new Error('WEATHER_LOCATION_UNAVAILABLE');
  try{this.native??=createRequire(import.meta.url)(join(this.directory,'weather-location.node')) as NativeLocation;}catch{throw new Error('WEATHER_LOCATION_UNAVAILABLE');}
  const native=this.native,id=randomUUID();
  return new Promise((resolve,reject)=>{
   let done=false;
   const finish=(error:string|null,point:Point|null)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);native.cancel(id);
    if(error||!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)){reject(new Error(error??'WEATHER_LOCATION_UNAVAILABLE'));return;}
    const rounded={latitude:Math.round(point.latitude*100)/100,longitude:Math.round(point.longitude*100)/100};resolve(rounded);};
   const abort=()=>{if(!done){finish('WEATHER_CANCELLED',null);}};
   const timer=setTimeout(()=>finish('WEATHER_LOCATION_TIMEOUT',null),15_000);
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
   try{native.request(id,prompt,(error,point)=>{finish(error,point);});}catch{finish('WEATHER_LOCATION_UNAVAILABLE',null);}
  });
 }
}
