/**
 * [INPUT]: The host-owned location and weather reader.
 * [OUTPUT]: The official current-weather summary and native detail.
 * [POS]: Preinstalled service; location permission belongs to the host form.
 */
export async function summary(input,{api,signal}){
 signal.throwIfAborted();
 return api.call('weather.read',input);
}
