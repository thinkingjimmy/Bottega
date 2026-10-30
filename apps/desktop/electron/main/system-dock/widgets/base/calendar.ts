/**
 * [INPUT]: Depends only on explicit IANA time zones and standard Gregorian Date/Intl APIs.
 * [OUTPUT]: Provides strict dates, half-open zoned day boundaries and calendar bucket ordinals.
 * [POS]: Base Widget time leaf; a local day can contain 23 or 25 hours and is never assumed to be 86,400,000 ms.
 */
const DAY=86_400_000;
export type CalendarBucket='day'|'week'|'month';
export function calendarDate(value:string){
 if(!/^\d{4}-\d\d-\d\d$/.test(value))throw new Error('DOCK_BASE_DATE_INVALID');
 const at=Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==value)throw new Error('DOCK_BASE_DATE_INVALID');
 return at;
}
export function zonedCalendar(timeZone:string){
 const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'});
 const date=(at:number)=>formatter.format(at);
 const start=(key:string)=>{
  const utc=calendarDate(key);let low=utc-36*3600000,high=utc+36*3600000;
  while(low<high){const middle=Math.floor((low+high)/2);if(date(middle)<key)low=middle+1;else high=middle;}
  if(date(low)!==key)throw new Error('DOCK_BASE_DATE_INVALID');return low;
 };
 const timestamp=(value:unknown):number|null=>{
  if(typeof value!=='string')return null;
  if(/^\d{4}-\d\d-\d\d$/.test(value))return start(value);
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))return null;
  const at=Date.parse(value);return Number.isFinite(at)?at:null;
 };
 const ordinal=(at:number,bucket:CalendarBucket)=>{
  const key=date(at),day=Math.floor(calendarDate(key)/DAY);
  return bucket==='day'?day:bucket==='week'?Math.floor((day+3)/7):Number(key.slice(0,4))*12+Number(key.slice(5,7))-1;
 };
 const bucketStart=(ordinal:number,bucket:CalendarBucket)=>{
  const key=bucket==='month'?`${String(Math.floor(ordinal/12)).padStart(4,'0')}-${String(ordinal%12+1).padStart(2,'0')}-01`
   :new Date((bucket==='week'?ordinal*7-3:ordinal)*DAY).toISOString().slice(0,10);
  return start(key);
 };
 return{date,start,timestamp,ordinal,bucketStart};
}
