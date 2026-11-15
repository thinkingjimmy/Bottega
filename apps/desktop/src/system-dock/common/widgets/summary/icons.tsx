/**
 * [INPUT]: Depends on the public icon vocabulary and Lucide glyphs.
 * [OUTPUT]: Provides the fixed summary icon map, a vocabulary guard for bound values and the icon element whose semantic tint (icons.css) travels with it.
 * [POS]: Shared icon leaf of the summary renderer; unknown bound names render nothing.
 */
import type {CSSProperties} from 'react';
import {Clock,Calendar,Activity,Gauge,ListTodo,Database,ChartLine,Globe,Flag,Check,TriangleAlert,Sparkles,
 Sun,CloudSun,Cloud,CloudFog,CloudDrizzle,CloudRain,CloudSnow,CloudSunRain,CloudLightning} from 'lucide-react';
import type {DockIconName} from '@bottega/contracts/plugins/dock/summary';
import './icons.css';
const ICONS={clock:Clock,calendar:Calendar,activity:Activity,gauge:Gauge,tasks:ListTodo,database:Database,chart:ChartLine,globe:Globe,flag:Flag,check:Check,alert:TriangleAlert,sparkles:Sparkles,
 sun:Sun,'cloud-sun':CloudSun,cloud:Cloud,fog:CloudFog,drizzle:CloudDrizzle,rain:CloudRain,snow:CloudSnow,showers:CloudSunRain,thunder:CloudLightning};
export function summaryIconName(value:unknown):DockIconName|null{return typeof value==='string'&&value in ICONS?value as DockIconName:null;}
export function SummaryIcon({name,color}:{name:DockIconName;color?:string}){
 const Icon=ICONS[name];
 const style:CSSProperties=color&&color!=='default'?color==='muted'?{opacity:.65}:{color:`var(--dock-summary-${color})`}:{};
 return <Icon aria-hidden="true" data-summary-node="icon" data-icon={name} className="summary-icon" strokeWidth={1.9} style={style}/>;
}
