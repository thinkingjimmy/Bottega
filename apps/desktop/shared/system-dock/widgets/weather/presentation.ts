/**
 * [INPUT]: Depends on normalized Weather readings, localized Weather copy, forecast day helpers and the public summary/document contracts.
 * [OUTPUT]: Provides the public v2 summary layouts, typed readings and the detail document the official Weather Widget publishes.
 * [POS]: Pure Weather-to-protocol projection shared by Main and renderer previews; no fetching or plugin code.
 */
import type {DockDetailDocument,DockSummaryNode,DockSummaryReadings,DockSummaryText} from '@bottega/contracts/plugins/dock/summary';
import {WEATHER_FORECAST_DAYS,weatherConditionKey,weatherWeekday,type WeatherDay} from './forecast';
import {weatherCopy} from './copy';

export type WeatherPresentationReading=Readonly<{temperature:number;code:number;today:WeatherDay|null;upcoming:readonly WeatherDay[];feelsLike:number;humidity:number;observedAt:number}>;
const bound=(source:string,field:string,format?:'degrees'|'percent'):DockSummaryText=>({kind:'binding',source,field,...(format?{format}:{})});
const weatherIcons={clear:'sun',partlyCloudy:'cloud-sun',cloudy:'cloud',fog:'fog',drizzle:'drizzle',rain:'rain',snow:'snow',showers:'showers',thunderstorm:'thunder',unknown:'cloud'} as const;
const weatherBackdrops={clear:'clear',partlyCloudy:'cloudy',cloudy:'cloudy',fog:'fog',drizzle:'rain',rain:'rain',snow:'snow',showers:'rain',thunderstorm:'storm',unknown:'cloudy'} as const;
const iconOf=(code:number):string=>weatherIcons[weatherConditionKey(code)];
const backdropOf=(code:number):string=>weatherBackdrops[weatherConditionKey(code)];
const dayRecord=(day:WeatherDay,title:string)=>({id:day.date,values:{title,icon:iconOf(day.code),high:day.high,low:day.low}});

export function weatherLayouts():{small:DockSummaryNode;medium:DockSummaryNode;large:DockSummaryNode}{
 const lead=(align:'start'|'center'):DockSummaryNode=>({type:'column',gap:4,align,children:[
  {type:'primary',emphasis:'display',text:bound('current','temperature','degrees')},
  {type:'row',gap:4,children:[
   {type:'icon',source:'current',field:'icon',label:bound('current','condition')},
   {type:'label',text:bound('current','city')},
  ]},
 ]});
 const columns=(source:string,max:1|2|3|4,secondary?:string):DockSummaryNode=>
  ({type:'columns',source,max,title:'title',icon:'icon',value:'high',...(secondary?{secondary}:{}),format:'degrees'});
 return {
  small:lead('center'),
  medium:{type:'row',gap:10,children:[lead('start'),columns('today',1,'low')]},
  large:{type:'row',gap:10,children:[lead('start'),columns('forecast',3)]},
 };
}

export function weatherReadings(observation:WeatherPresentationReading,city:string,locale:string):DockSummaryReadings{
 const copy=weatherCopy(locale);
 const today=observation.today?dayRecord(observation.today,copy.today):null;
 const upcoming=observation.upcoming.map(day=>dayRecord(day,weatherWeekday(day.date,locale)));
 const day=(state:DockSummaryReadings[string]['state'],values:Record<string, string|number|boolean|null>,records?:DockSummaryReadings[string]['records'])=>({state,updatedAt:observation.observedAt,values,...(records?{records}:{})});
 return {
  current:day('ready',{temperature:observation.temperature,city,icon:iconOf(observation.code),condition:copy[weatherConditionKey(observation.code)],backdrop:backdropOf(observation.code),'feels-like':observation.feelsLike,humidity:observation.humidity}),
  today:day('ready',{high:observation.today?.high??null,low:observation.today?.low??null},today?[today]:[]),
  forecast:day('ready',{},upcoming),
  days:day('ready',{},[...(today?[today]:[]),...upcoming]),
 };
}

export function weatherDocument(observation:WeatherPresentationReading,locale:string):DockDetailDocument{
 const copy=weatherCopy(locale);
 return {
  version:2,
  backdrop:{source:'current',field:'backdrop'},
  hero:{title:bound('current','city'),value:bound('current','temperature','degrees'),caption:bound('current','condition'),
   ...(observation.today?{high:bound('today','high','degrees'),low:bound('today','low','degrees')}:{})},
  rows:{source:'days',max:WEATHER_FORECAST_DAYS,title:'title',icon:'icon',low:'low',high:'high',format:'degrees'},
  tiles:[
   {label:{kind:'literal',value:copy.feelsLike},value:bound('current','feels-like','degrees')},
   {label:{kind:'literal',value:copy.humidity},value:bound('current','humidity','percent')},
  ],
  attribution:{label:copy.attribution,url:'https://open-meteo.com/'},
 };
}
