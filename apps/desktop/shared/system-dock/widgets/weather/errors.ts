/**
 * [INPUT]: Bounded weather error codes from Main.
 * [OUTPUT]: Locale-independent translation keys for weather failures.
 * [POS]: Small shared presentation leaf; keeps locale dictionaries out of eager panel code.
 */
export function weatherFailureKey(error:unknown){
 const message=error instanceof Error?error.message:String(error??'');
 if(message.includes('LOCATION_DENIED'))return 'denied';
 if(message.includes('LOCATION_DISABLED'))return 'disabled';
 if(message.includes('LOCATION_TIMEOUT'))return 'timeout';
 if(message.includes('LOCATION_AUTHORIZATION'))return 'authorization';
 if(message.includes('LOCATION_UNAVAILABLE'))return 'unavailable';
 if(message.includes('RATE_LIMITED'))return 'rateLimited';
 if(message.includes('RESPONSE_INVALID'))return 'invalid';
 return 'failed';
}
