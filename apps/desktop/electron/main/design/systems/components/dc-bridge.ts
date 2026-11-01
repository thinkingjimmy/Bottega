/**
 * [INPUT]: Native document window.React18, window.ReactDOM and fixed connected component identities.
 * [OUTPUT]: dcRuntimeShim and dcComponentBootstrap use one React, one connected graph and board-only Portals without mounting roots.
 * [POS]: Browser source generator for the native captured-component target.
 */
import type { SystemComponent } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
const react18 = ["Children", "Component", "Fragment", "Profiler", "PureComponent", "StrictMode", "Suspense", "cloneElement", "createContext", "createElement",
  "createFactory", "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition", "useCallback", "useContext", "useDebugValue", "useDeferredValue",
  "useEffect", "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect", "useMemo", "useReducer", "useRef", "useState", "useSyncExternalStore", "useTransition", "version"];
const identity = "const R=window.React;if(!R||R.version!=='18.3.1')throw new Error('DC component requires the document React18 singleton');";
export function dcRuntimeShim(name: string) {
  if (name === "react") return identity + "export default R;" + react18.map(key => "export const " + key + "=R." + key + ";").join("");
  if (name === "react-dom") return identity +
    "const D=window.ReactDOM;if(!D||D.version!=='18.3.1')throw new Error('DC component requires the document ReactDOM18 singleton');" +
    "export const flushSync=D.flushSync;export const version=D.version;" +
    "export function createPortal(children,target,key){const root=document.getElementById('dc-root');" +
    "if(!root||!target||target.ownerDocument!==document||!root.contains(target))throw new Error('DC Portal target must remain inside its board');return D.createPortal(children,target,key);}export default {createPortal,flushSync,version};";
  return identity + "export const Fragment=R.Fragment;export function jsx(type,props,key){const value={...props};if(key!==undefined)value.key=key;return R.createElement(type,value)}" +
    "export function jsxs(type,props,key){const value={...props},children=value.children;delete value.children;if(key!==undefined)value.key=key;return R.createElement(type,value,...(Array.isArray(children)?children:[children]))}export const jsxDEV=jsx;";
}
export function dcGlobalName(component: SystemComponent, graph: string) {
  return "BottegaDC_" + graph.slice(7, 23) + "_" + component.name;
}
export function dcComponentBootstrap(components: readonly SystemComponent[], graph: string) {
  const imports = components.map((_component, index) => "import * as Source" + index + " from 'dc-entry:" + index + "';").join("\n");
  const exports = components.map((component, index) => "output[" + JSON.stringify(component.name) + "]=wrap(Source" + index + "[" + JSON.stringify(component.exportName) + "]," + JSON.stringify(component.name) + ");").join("\n");
  const globals = components.map(component => "Object.defineProperty(window," + JSON.stringify(dcGlobalName(component, graph)) + ",{value:output[" + JSON.stringify(component.name) + "]});").join("\n");
  return imports + "\n" + identity + "\nconst output={};" +
    "function wrap(C,name){if(!C)throw new Error('Captured DC component export is missing: '+name);" +
    "function DCComponent(props){const slot=R.useRef(null);R.useLayoutEffect(()=>{if(slot.current?.firstChild)slot.current.setAttribute('data-bottega-dc-mounted','1')},[]);" +
    "const actual=props['data-bottega-props']??props;return R.createElement('div',{ref:slot,'data-bottega-dc-component':name},R.createElement(C,actual));}" +
    "DCComponent.displayName='DC('+name+')';return DCComponent;}\n" + exports + "\n" + globals + "\nmodule.exports=output;";
}
export function dcCachedModule(code: string, graph: string) {
  const key = JSON.stringify("bottega.dc." + graph);
  return "const cacheKey=Symbol.for(" + key + ");if(window[cacheKey]){module.exports=window[cacheKey];}else{\n" + code +
    "\nObject.defineProperty(window,cacheKey,{value:Object.freeze(module.exports)});}";
}
