/**
 * [INPUT]: Unified plugin manifest schema and pinned compatible frontend versions.
 * [OUTPUT]: Editable native plugin source with page, Widget, tool, service and mode contributions.
 * [POS]: Shared first-send starter and repeatable weather example; has no host dependency catalogue.
 */
import {unifiedPluginManifestSchema} from '@bottega/contracts/plugins/platform';
import {PLUGIN_PNPM_VERSION,PLUGIN_SHADCN_VERSION} from './dependencies';

export function pluginTemplate(id:string,name:string,sample:'starter'|'weather'='starter'){
  const weather=sample==='weather',method=weather?'forecast':'hello';
  const manifest=unifiedPluginManifestSchema.parse({schemaVersion:1,id,name,version:'1.0.0',source:{kind:'authored',format:'bottega',editable:true},
    slots:{declares:[],injects:[{slot:'main.pages',ownerPluginId:'host'}]},contributions:[
      {kind:'page',id:'page',name,entry:'src/main.tsx',slot:'main.pages',navigation:{label:name}},
      {kind:'widget',id:'widget',name,entry:'src/main.tsx',settingsSchema:{type:'object',properties:{city:{type:'string',default:'Beijing'}}}},
      {kind:'tool',id:method,name:weather?'Weather forecast':'Hello',description:weather?'Read the weather for a named city.':'Read a greeting from this plugin.',
        inputSchema:{type:'object',properties:weather?{city:{type:'string'}}:{name:{type:'string'}},additionalProperties:false},
        outputSchema:{type:'object'},executor:{kind:'process',entry:'src/service.ts',method},access:'read',planAllowed:true},
      {kind:'service',id:'backend',name:`${name} service`,entry:'src/service.ts'},
      {kind:'mode',id:'mode',name,prompt:weather?'Use this plugin to check city weather.':'Use the tools provided by this plugin.',tools:{plugins:[id],tools:[]}},
    ]});
  const service=weather?WEATHER_SERVICE:'export function hello({name = "world"}) { return {message: `Hello, ${name}!`}; }\n';
  const files:Record<string,string>={
    'bottega.plugin.json':JSON.stringify(manifest,null,2)+'\n',
    'package.json':JSON.stringify({name:`bottega-${id}`,private:true,type:'module',packageManager:`pnpm@${PLUGIN_PNPM_VERSION}`,
      dependencies:{react:'19.2.4','react-dom':'19.2.4',cn:'0.5.2'},devDependencies:{'@types/react':'19.2.17','@types/react-dom':'19.2.3',tailwindcss:'4.3.2',typescript:'5.9.3'},
      scripts:{'ui:add':`pnpm dlx shadcn@${PLUGIN_SHADCN_VERSION} add`}},null,2)+'\n',
    'components.json':JSON.stringify({$schema:'https://ui.shadcn.com/schema.json',style:'new-york',rsc:false,tsx:true,
      tailwind:{config:'',css:'src/styles.css',baseColor:'neutral',cssVariables:true,prefix:''},
      aliases:{components:'@/components',utils:'cn',ui:'@/components/ui',lib:'@/lib',hooks:'@/hooks'},iconLibrary:'lucide'},null,2)+'\n',
    'tsconfig.json':JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,
      esModuleInterop:true,skipLibCheck:true,baseUrl:'.',paths:{'@/*':['./src/*']}},include:['src']},null,2)+'\n',
    'src/main.tsx':`import {useState} from 'react';\nexport default function PluginPage(){\n const [result,setResult]=useState('');\n const [busy,setBusy]=useState(false);\n async function run(){setBusy(true);try{const value=await (window as any).bottega.call(${JSON.stringify(method)},${weather?"{city:(window as any).bottega.configuration.city??'Beijing'}":"{name:'world'}"});setResult(JSON.stringify(value,null,2));}catch(error){setResult(String(error));}finally{setBusy(false);}}\n return <main className="p-6"><h1 className="text-2xl font-semibold">${name.replace(/[<>&{}]/g,'')}</h1><button className="mt-4 rounded-md border bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy} onClick={run}>{busy?'Loading…':${JSON.stringify(weather?'Check weather':'Try plugin tool')}}</button><pre role="status" className="mt-4 whitespace-pre-wrap">{result}</pre></main>;\n}\n`,
    'src/service.ts':service,
    'src/styles.css':'@import "tailwindcss";\n@theme inline { --color-background: var(--background); --color-foreground: var(--foreground); --color-card: var(--card); --color-card-foreground: var(--card-foreground); --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground); --color-border: var(--border); --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground); --radius-md: var(--radius); }\n@layer base { * { border-color: var(--border); } body { margin:0; background:var(--background); color:var(--foreground); font-family:system-ui; } }\n',
    'README.md':`# ${name}\n\nNative Bottega plugin source. Edit this Project from any authoring Chat.\n\nThe host installs dependencies with pnpm ${PLUGIN_PNPM_VERSION}, builds offline, and activates only a ready immutable revision.\nUse the pinned shadcn ${PLUGIN_SHADCN_VERSION} CLI to add components. Source and code recovery do not change plugin data or instance settings.\n`,
  };
  return{manifest,files};
}

const WEATHER_SERVICE=`const cities={Beijing:{latitude:39.9042,longitude:116.4074},Shanghai:{latitude:31.2304,longitude:121.4737}};
export async function forecast({city='Beijing'},{signal,api}){
 const place=cities[city];if(!place)throw new Error('Choose Beijing or Shanghai.');
 signal?.throwIfAborted();
 const url='https://api.open-meteo.com/v1/forecast?latitude='+place.latitude+'&longitude='+place.longitude+'&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto';
 const response=await api.call('network.fetch',{url,method:'GET'});
 if(response.status!==200)throw new Error('Weather service is unavailable.');
 const weather=typeof response.body==='string'?JSON.parse(response.body):response.body;
 return {city,current:weather.current,daily:weather.daily};
}
`;
