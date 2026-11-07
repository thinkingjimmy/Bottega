/**
 * [INPUT]: Core Location, Foundation and Node-API callbacks from Electron Main.
 * [OUTPUT]: Cancellable one-shot location; only explicit prompt requests can ask for authorization.
 * [POS]: In-process native adapter so macOS attributes access to the outer Bottega application.
 */
#import <Foundation/Foundation.h>
#import <CoreLocation/CoreLocation.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
typedef struct { char *error; double latitude; double longitude; } LocationResult;
static NSMutableDictionary *requests;
static BOOL environmentOpen = YES;
static void deliver(napi_env env, napi_value callback, void *context, void *raw) {
  (void)context;
  LocationResult *result = raw;
  if (env && callback) {
    napi_value args[2], receiver;
    napi_get_undefined(env, &receiver);
    napi_get_null(env, &args[0]); napi_get_null(env, &args[1]);
    if (result->error) napi_create_string_utf8(env, result->error, NAPI_AUTO_LENGTH, &args[0]);
    else {
      napi_create_object(env, &args[1]);
      napi_value latitude, longitude;
      napi_create_double(env, result->latitude, &latitude); napi_create_double(env, result->longitude, &longitude);
      napi_set_named_property(env, args[1], "latitude", latitude); napi_set_named_property(env, args[1], "longitude", longitude);
    }
    napi_call_function(env, receiver, callback, 2, args, NULL);
  }
  free(result->error); free(result);
}
@interface WeatherLocationRequest : NSObject <CLLocationManagerDelegate>
@property(nonatomic,strong) CLLocationManager *manager;
@property(nonatomic,copy) NSString *identity;
@property(nonatomic) napi_threadsafe_function callback;
@property(nonatomic) BOOL prompt;
@property(nonatomic) BOOL finished;
@property(nonatomic) BOOL requestedPermission;
- (void)start;
- (void)finish:(NSString *)error location:(CLLocation *)location;
@end
@implementation WeatherLocationRequest
- (void)finish:(NSString *)error location:(CLLocation *)location {
  if (self.finished) return;
  self.finished = YES; [self.manager stopUpdatingLocation]; self.manager.delegate = nil;
  LocationResult *result = calloc(1, sizeof(LocationResult));
  if (error) result->error = strdup(error.UTF8String);
  else { result->latitude = location.coordinate.latitude; result->longitude = location.coordinate.longitude; }
  if (napi_call_threadsafe_function(self.callback, result, napi_tsfn_nonblocking) != napi_ok) { free(result->error); free(result); }
  napi_release_threadsafe_function(self.callback, napi_tsfn_release);
  [requests removeObjectForKey:self.identity];
}
- (void)start {
  if (self.finished) return;
  if (![CLLocationManager locationServicesEnabled]) { [self finish:@"WEATHER_LOCATION_DISABLED" location:nil]; return; }
  if (!self.manager) { self.manager = [CLLocationManager new]; self.manager.delegate = self; self.manager.desiredAccuracy = kCLLocationAccuracyKilometer; }
  CLAuthorizationStatus status = self.manager.authorizationStatus;
  if (status == kCLAuthorizationStatusDenied || status == kCLAuthorizationStatusRestricted) { [self finish:@"WEATHER_LOCATION_DENIED" location:nil]; return; }
  if (status == kCLAuthorizationStatusNotDetermined) {
    if (!self.prompt) { [self finish:@"WEATHER_LOCATION_AUTHORIZATION" location:nil]; return; }
    if (![[NSBundle mainBundle] objectForInfoDictionaryKey:@"NSLocationUsageDescription"]) { [self finish:@"WEATHER_LOCATION_UNAVAILABLE" location:nil]; return; }
    if (!self.requestedPermission) { self.requestedPermission = YES; [self.manager requestWhenInUseAuthorization]; }
    return;
  }
  [self.manager requestLocation];
}
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager { (void)manager; [self start]; }
- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
  (void)manager; CLLocation *location = locations.lastObject;
  if (location && location.horizontalAccuracy >= 0 && fabs(location.timestamp.timeIntervalSinceNow) < 300) [self finish:nil location:location];
}
- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
  (void)manager;
  [self finish:error.code == kCLErrorDenied ? @"WEATHER_LOCATION_DENIED" : @"WEATHER_LOCATION_UNAVAILABLE" location:nil];
}
@end
static NSString *identity(napi_env env,napi_value value) {
  char bytes[80]; size_t length=0;
  if(napi_get_value_string_utf8(env,value,bytes,sizeof(bytes),&length)!=napi_ok || length==0 || length>=79) return nil;
  return [NSString stringWithUTF8String:bytes];
}
static napi_value requestLocation(napi_env env,napi_callback_info info) {
  size_t count=3; napi_value args[3]; napi_get_cb_info(env,info,&count,args,NULL,NULL);
  if(count!=3){napi_throw_type_error(env,NULL,"Expected identity, prompt and callback");return NULL;}
  NSString *key=identity(env,args[0]); bool prompt=false; napi_valuetype type;
  napi_typeof(env,args[2],&type);
  if(!key || type!=napi_function || napi_get_value_bool(env,args[1],&prompt)!=napi_ok){napi_throw_type_error(env,NULL,"Invalid location request");return NULL;}
  napi_value name; napi_create_string_utf8(env,"Bottega location",NAPI_AUTO_LENGTH,&name);
  napi_threadsafe_function callback;
  if(napi_create_threadsafe_function(env,args[2],NULL,name,1,1,NULL,NULL,NULL,deliver,&callback)!=napi_ok)return NULL;
  napi_unref_threadsafe_function(env,callback);
  dispatch_async(dispatch_get_main_queue(),^{
    if(!environmentOpen){napi_release_threadsafe_function(callback,napi_tsfn_abort);return;}
    if(!requests)requests=[NSMutableDictionary new];
    WeatherLocationRequest *prior=requests[key];[prior finish:@"WEATHER_CANCELLED" location:nil];
    WeatherLocationRequest *request=[WeatherLocationRequest new]; request.identity=key;request.prompt=prompt;request.callback=callback;requests[key]=request;[request start];
  });
  return NULL;
}
static napi_value cancelLocation(napi_env env,napi_callback_info info) {
  size_t count=1;napi_value args[1];napi_get_cb_info(env,info,&count,args,NULL,NULL);if(count!=1)return NULL;
  NSString *key=identity(env,args[0]);if(key)dispatch_async(dispatch_get_main_queue(),^{WeatherLocationRequest *request=requests[key];[request finish:@"WEATHER_CANCELLED" location:nil];});return NULL;
}
static void cleanup(void *context) {
  (void)context; environmentOpen = NO;
  for (WeatherLocationRequest *request in requests.allValues) [request finish:@"WEATHER_CANCELLED" location:nil];
  requests = nil;
}
static napi_value initialize(napi_env env,napi_value exports) {
  napi_add_env_cleanup_hook(env,cleanup,NULL);
  napi_value request,cancel;napi_create_function(env,"request",NAPI_AUTO_LENGTH,requestLocation,NULL,&request);napi_create_function(env,"cancel",NAPI_AUTO_LENGTH,cancelLocation,NULL,&cancel);
  napi_set_named_property(env,exports,"request",request);napi_set_named_property(env,exports,"cancel",cancel);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
