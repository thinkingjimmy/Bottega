/**
 * [INPUT]: Depends on declared Base history/range settings, strict zoned calendars and bounded Dock series.
 * [OUTPUT]: Provides incremental <=64-point history over the complete declared range with count/sum/mean and honest missing buckets.
 * [POS]: Base Widget reducer; it stores no source rows and never truncates a history tail.
 */
import type {DockSeries} from '@bottega/contracts/plugins/dock/data';
import type {DockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {BaseWidgetQuery} from './model';
import {zonedCalendar} from './calendar';
export function baseHistory(query:BaseWidgetQuery,settings:DockSettings){
 if(query.operation!=='history'||!query.timeZone||!query.timeField||!query.bucket||!query.fromSetting||!query.toSetting||!query.reduction||!query.missingBuckets)throw new Error('DOCK_BASE_HISTORY_INVALID');
 if(query.field&&query.missingBuckets==='zero-count'||!query.field&&query.reduction!=='sum')throw new Error('DOCK_BASE_HISTORY_INVALID');
 const calendar=zonedCalendar(query.timeZone),from=calendar.timestamp(settings[query.fromSetting]),to=calendar.timestamp(settings[query.toSetting]);
 if(from===null||to===null||from>=to)throw new Error('DOCK_BASE_RANGE_INVALID');
 const bucket=query.bucket,first=calendar.ordinal(from,bucket),last=calendar.ordinal(to-1,bucket),rawCount=last-first+1,width=Math.ceil(rawCount/64);
 if(!Number.isSafeInteger(rawCount)||rawCount<1)throw new Error('DOCK_BASE_RANGE_INVALID');
 const values=Array.from({length:Math.ceil(rawCount/width)},(_,index)=>({at:Math.max(from,calendar.bucketStart(first+index*width,bucket)),sum:0,count:0}));
 return{
  add(time:unknown,value:unknown){
   const at=calendar.timestamp(time);if(at===null||at<from||at>=to)return;
   const point=values[Math.floor((calendar.ordinal(at,bucket)-first)/width)];if(!point)throw new Error('DOCK_BASE_RANGE_INVALID');
   if(query.field){if(typeof value!=='number'||!Number.isFinite(value))return;point.sum+=value;}else point.sum++;
   point.count++;if(!Number.isFinite(point.sum))throw new Error('DOCK_BASE_AGGREGATE_INVALID');
  },
  result(complete:boolean):DockSeries{
   return{from,to,timeZone:query.timeZone!,points:values.map(point=>({at:point.at,value:!complete?null:point.count?(query.reduction==='mean'?point.sum/point.count:point.sum):query.missingBuckets==='zero-count'?0:null}))};
  },
 };
}
