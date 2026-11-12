/**
 * [INPUT]: The host-owned city weather reader.
 * [OUTPUT]: Current readings, daily forecasts and native detail for the selected city.
 * [POS]: Preinstalled service; the host owns transport and validation.
 */
export async function summary(input,{api,signal}){
 signal.throwIfAborted();
 return api.call('weather.read',input);
}
