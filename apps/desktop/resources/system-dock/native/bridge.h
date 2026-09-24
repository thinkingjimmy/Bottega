/**
 * [INPUT]: Depends on Foundation and shared.h.
 * [OUTPUT]: Declares the once-only timed reply object, the stdout event writer, request field validators, and the system-op entry implemented by bridge-system.m.
 * [POS]: system-dock/native internal seam between the bridge's I/O core (bridge.m) and its Trash/Finder/agent ops (bridge-system.m); not used by the recovery agent.
 */

#import "shared.h"

/** Exactly one line per request: the first of ok/fail/timeout wins, later calls are dropped. */
@interface BDReply : NSObject
- (void)ok:(id)result;
- (void)fail:(NSString *)code;
@end

extern NSString *BDPrefsDomain;
/** Writes one JSON line; serialized with every response so lines never interleave. */
void BDEmit(NSDictionary *object);
NSString *BDString(NSDictionary *request, NSString *key, NSUInteger maxLength);
/** Integral JSON number within [min, max], else NSNotFound-like sentinel via *ok = NO. */
int64_t BDInteger(NSDictionary *request, NSString *key, int64_t min, int64_t max, BOOL *ok);
/** Returns NO when `op` is not one of the Trash/Finder/agent operations. */
BOOL BDHandleSystemOp(NSString *op, NSDictionary *request, BDReply *reply);
/** Upper bound on how long the reply guard waits for this op before answering "timeout". */
double BDSystemOpBudget(NSString *op, NSDictionary *request);
