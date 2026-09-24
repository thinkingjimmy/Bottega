/**
 * [INPUT]: Depends on getattrlist(ATTR_DIR_ENTRYCOUNT), FSEvents, NSFileManager mounted volumes, CoreServices Apple Events (AEDeterminePermissionToAutomateTarget / AESendMessage to Finder), and NSXPCConnection to the recovery agent's Mach service.
 * [OUTPUT]: Implements BDHandleSystemOp for trash-state, watch-trash (+ "trash" events), automation-status, empty-trash, and agent-call; BDSystemOpBudget for their reply guards.
 * [POS]: system-dock/native side-effecting and TCC-gated ops of system-dock-bridge; every call runs on a background queue with its own bound, and nothing here retries.
 */

#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import <sys/attr.h>
#import <sys/stat.h>
#import "bridge.h"

static const AEEventClass kFinderSuite = 'fndr';
static const AEEventID kFinderEmpty = 'empt';

static dispatch_queue_t systemQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("bottega.system-dock.system", DISPATCH_QUEUE_CONCURRENT); });
  return queue;
}

// ---- Trash ---------------------------------------------------------------------------------------

typedef struct { u_int32_t length; attribute_set_t returned; u_int32_t count; } __attribute__((packed)) EntryCountBuffer;

/** Scope entry {path,count,error}: a missing scope is verified empty, a permission failure is never empty (INV-12). */
static NSDictionary *trashScope(NSString *path) {
  struct attrlist request = { .bitmapcount = ATTR_BIT_MAP_COUNT, .commonattr = ATTR_CMN_RETURNED_ATTRS, .dirattr = ATTR_DIR_ENTRYCOUNT };
  EntryCountBuffer buffer = { 0 };
  NSString *error = nil;
  NSNumber *count = nil;
  if (getattrlist(path.fileSystemRepresentation, &request, &buffer, sizeof buffer, FSOPT_NOFOLLOW) != 0) {
    if (errno == ENOENT) count = @0;
    else error = errno == EPERM ? @"EPERM" : errno == EACCES ? @"EACCES" : errno == ENOTDIR ? @"ENOTDIR" : [NSString stringWithFormat:@"errno-%d", errno];
  } else if (!(buffer.returned.dirattr & ATTR_DIR_ENTRYCOUNT)) {
    error = @"unsupported";
  } else {
    u_int32_t entries = buffer.count;
    struct stat info;
    // Finder leaves a .DS_Store after showing an empty Trash; that file is not a user item, and the Dock
    // itself reads such a Trash as empty. Only a verified regular file is discounted.
    if (entries == 1 && lstat([path stringByAppendingPathComponent:@".DS_Store"].fileSystemRepresentation, &info) == 0 && S_ISREG(info.st_mode)) entries = 0;
    count = @(entries);
  }
  return @{ @"path": path, @"count": count ?: NSNull.null, @"error": error ?: NSNull.null };
}
static NSString *homeTrash(void) { return [NSHomeDirectory() stringByAppendingPathComponent:@".Trash"]; }
/** ~/.Trash plus <volume>/.Trashes/<uid> on each visible local non-root volume; never creates a directory. */
static NSArray<NSString *> *trashPaths(void) {
  NSMutableArray *paths = [NSMutableArray arrayWithObject:homeTrash()];
  NSArray *volumes = [NSFileManager.defaultManager mountedVolumeURLsIncludingResourceValuesForKeys:@[NSURLVolumeIsLocalKey, NSURLVolumeIsRootFileSystemKey]
    options:NSVolumeEnumerationSkipHiddenVolumes];
  for (NSURL *volume in volumes) {
    if (paths.count >= 64) break;
    NSNumber *local = nil, *root = nil;
    [volume getResourceValue:&local forKey:NSURLVolumeIsLocalKey error:nil];
    [volume getResourceValue:&root forKey:NSURLVolumeIsRootFileSystemKey error:nil];
    // The root volume's Trash is ~/.Trash; network volumes are outside the product's scope.
    if (!local.boolValue || root.boolValue || [volume.path isEqualToString:@"/"]) continue;
    [paths addObject:[volume.path stringByAppendingPathComponent:[NSString stringWithFormat:@".Trashes/%u", getuid()]]];
  }
  return paths;
}
static NSDictionary *trashState(void) {
  NSMutableArray *scopes = [NSMutableArray array];
  BOOL full = NO, verified = YES;
  for (NSString *path in trashPaths()) {
    NSDictionary *scope = trashScope(path);
    [scopes addObject:scope];
    NSNumber *count = [scope[@"count"] isKindOfClass:NSNumber.class] ? scope[@"count"] : nil;
    if (count.unsignedIntValue > 0) full = YES;
    if (!count) verified = NO;
  }
  return @{ @"state": full ? @"full" : verified ? @"empty" : @"unknown", @"volumes": scopes };
}

static dispatch_queue_t trashQueue;
static FSEventStreamRef trashStream;
static dispatch_source_t trashTimer;
static NSData *lastTrash;
static NSArray *mountObservers;

static void publishTrash(BOOL force) {
  NSDictionary *state = trashState();
  NSData *data = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
  if (!force && [data isEqualToData:lastTrash]) return;
  lastTrash = data;
  BDEmit(@{ @"event": @"trash", @"state": state });
}
static void trashEvents(ConstFSEventStreamRef stream, void *info, size_t count, void *paths, const FSEventStreamEventFlags flags[], const FSEventStreamEventId ids[]) {
  publishTrash(NO);
}
static void stopTrashStream(void) {
  if (!trashStream) return;
  FSEventStreamStop(trashStream); FSEventStreamInvalidate(trashStream); FSEventStreamRelease(trashStream);
  trashStream = NULL;
}
static void startTrashStream(void) {
  stopTrashStream();
  // Streams are recursive, so never watch a home or volume root; a per-volume .Trashes watch catches a
  // later-created <uid> folder, and the 30 s recheck plus mount notifications cover the rest.
  NSMutableSet *watched = [NSMutableSet set];
  for (NSString *path in trashPaths()) {
    [watched addObject:path];
    if (![path isEqualToString:homeTrash()]) [watched addObject:path.stringByDeletingLastPathComponent];
  }
  FSEventStreamContext context = { 0 };
  trashStream = FSEventStreamCreate(NULL, trashEvents, &context, (__bridge CFArrayRef)watched.allObjects, kFSEventStreamEventIdSinceNow, 0.5,
    kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagWatchRoot);
  if (!trashStream) return;
  FSEventStreamSetDispatchQueue(trashStream, trashQueue);
  FSEventStreamStart(trashStream);
}
static void watchTrash(BOOL enabled) {
  if (!enabled) {
    stopTrashStream();
    if (trashTimer) { dispatch_source_cancel(trashTimer); trashTimer = nil; }
    for (id observer in mountObservers) [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:observer];
    mountObservers = nil;
    lastTrash = nil;
    return;
  }
  if (trashTimer) return;
  startTrashStream();
  // FSEvents can coalesce or drop; a bounded 30 s recheck covers what events miss, and only while watched.
  trashTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, trashQueue);
  dispatch_source_set_timer(trashTimer, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), 30 * NSEC_PER_SEC, 2 * NSEC_PER_SEC);
  dispatch_source_set_event_handler(trashTimer, ^{ publishTrash(NO); });
  dispatch_resume(trashTimer);
  // Mounting or ejecting changes the set of scopes itself.
  NSOperationQueue *queue = [NSOperationQueue new];
  queue.underlyingQueue = trashQueue;
  NSMutableArray *observers = [NSMutableArray array];
  for (NSNotificationName name in @[NSWorkspaceDidMountNotification, NSWorkspaceDidUnmountNotification]) {
    [observers addObject:[NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:name object:nil queue:queue usingBlock:^(NSNotification *note) {
      if (trashTimer) { startTrashStream(); publishTrash(NO); }
    }]];
  }
  mountObservers = observers;
  publishTrash(YES);
}

// ---- Finder Automation ------------------------------------------------------------------------------

static NSAppleEventDescriptor *finderTarget(void) { return [NSAppleEventDescriptor descriptorWithBundleIdentifier:@"com.apple.finder"]; }
static void automationStatus(NSDictionary *request, BDReply *reply) {
  BOOL prompt = [request[@"prompt"] isEqual:@YES];
  // May block on tccd (and on the user, when prompting); never on the read loop or main thread.
  dispatch_async(systemQueue(), ^{
    OSStatus status = AEDeterminePermissionToAutomateTarget(finderTarget().aeDesc, kFinderSuite, kFinderEmpty, prompt);
    NSString *mapped = status == noErr ? @"granted" : status == errAEEventWouldRequireUserConsent ? @"needs-prompt"
      : status == errAEEventNotPermitted ? @"denied" : @"unavailable";
    [reply ok:@{ @"status": mapped, @"code": @(status) }];
  });
}
static void emptyTrash(NSDictionary *request, BDReply *reply) {
  BOOL valid = NO;
  int64_t timeoutMs = BDInteger(request, @"timeoutMs", 1000, 120000, &valid);
  if (!valid) { [reply fail:@"invalid-request"]; return; }
  dispatch_async(systemQueue(), ^{
    // Exactly the scripted `empty trash`: direct object = property 'trsh' of the application. One send, no retry (INV-14).
    NSAppleEventDescriptor *event = [NSAppleEventDescriptor appleEventWithEventClass:kFinderSuite eventID:kFinderEmpty
      targetDescriptor:finderTarget() returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    NSAppleEventDescriptor *property = [NSAppleEventDescriptor recordDescriptor];
    [property setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:cProperty] forKeyword:keyAEDesiredClass];
    [property setDescriptor:[NSAppleEventDescriptor nullDescriptor] forKeyword:keyAEContainer];
    [property setDescriptor:[NSAppleEventDescriptor descriptorWithEnumCode:formPropertyID] forKeyword:keyAEKeyForm];
    [property setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:'trsh'] forKeyword:keyAEKeyData];
    NSAppleEventDescriptor *specifier = [property coerceToDescriptorType:typeObjectSpecifier];
    if (specifier) [event setParamDescriptor:specifier forKeyword:keyDirectObject];
    AppleEvent answer = { typeNull, NULL };
    long ticks = (long)(timeoutMs * 60 / 1000);
    OSStatus status = AESendMessage(event.aeDesc, &answer, kAEWaitReply | kAECanInteract, ticks);
    if (status == noErr && answer.descriptorType != typeNull) {
      NSAppleEventDescriptor *wrapped = [[NSAppleEventDescriptor alloc] initWithAEDescNoCopy:&answer];
      NSAppleEventDescriptor *failure = [wrapped paramDescriptorForKeyword:keyErrorNumber];
      if (failure) status = failure.int32Value;
    } else AEDisposeDesc(&answer);
    NSString *result = status == noErr ? @"emptied" : status == errAEEventNotPermitted ? @"denied" : status == userCanceledErr ? @"cancelled"
      : status == errAETimeout ? @"timeout" : @"failed";
    [reply ok:@{ @"result": result, @"code": @(status) }];
  });
}

// ---- Recovery agent relay ------------------------------------------------------------------------------

static dispatch_queue_t agentQueue;
static NSMutableDictionary<NSString *, NSXPCConnection *> *agentConnections;

static NSDictionary *agentFailure(NSString *code) {
  return @{ @"ok": @NO, @"agentPid": NSNull.null, @"code": code, @"observedOwner": @NO, @"leaseExpiresAt": NSNull.null };
}
/** The agent's reply must already be agentReplySchema; anything else is "invalid", never passed through. */
static NSDictionary *agentReply(NSString *json) {
  NSDictionary *reply = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] ?: NSData.data options:0 error:nil];
  NSSet *keys = [NSSet setWithArray:@[@"ok", @"agentPid", @"code", @"observedOwner", @"leaseExpiresAt"]];
  NSArray *codes = @[@"ok", @"unreachable", @"timeout", @"rejected", @"stale-epoch", @"owned-elsewhere", @"exiting", @"invalid"];
  BOOL valid = NO, pidValid = NO, leaseValid = NO;
  if ([reply isKindOfClass:NSDictionary.class] && [[NSSet setWithArray:reply.allKeys] isEqualToSet:keys]) {
    if (reply[@"agentPid"] == NSNull.null) pidValid = YES; else BDInteger(reply, @"agentPid", 1, INT32_MAX, &pidValid);
    if (reply[@"leaseExpiresAt"] == NSNull.null) leaseValid = YES; else BDInteger(reply, @"leaseExpiresAt", 0, 9007199254740991LL, &leaseValid);
    valid = BDIsBool(reply[@"ok"]) && BDIsBool(reply[@"observedOwner"]) && [codes containsObject:reply[@"code"] ?: @""] && pidValid && leaseValid;
  }
  return valid ? reply : agentFailure(@"invalid");
}
static NSXPCConnection *agentConnection(NSString *service) {
  NSXPCConnection *connection = agentConnections[service];
  if (connection) return connection;
  connection = [[NSXPCConnection alloc] initWithMachServiceName:service options:0];
  connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(BDRecoveryService)];
  NSString *requirement = BDTeamRequirement();
  // Signed builds only talk to an agent from the same team; ad-hoc dev builds have no team to pin.
  if (requirement) { if (@available(macOS 13.0, *)) [connection setCodeSigningRequirement:requirement]; }
  __weak NSXPCConnection *weak = connection;
  connection.invalidationHandler = ^{
    dispatch_async(agentQueue, ^{ if (agentConnections[service] == weak || !weak) [agentConnections removeObjectForKey:service]; });
  };
  agentConnections[service] = connection;
  [connection resume];
  return connection;
}
static void agentCall(NSDictionary *request, BDReply *reply) {
  NSString *method = BDString(request, @"method", 16), *service = BDString(request, @"machService", 128);
  NSDictionary *payload = [request[@"payload"] isKindOfClass:NSDictionary.class] ? request[@"payload"] : nil;
  BOOL valid = NO;
  int64_t timeoutMs = BDInteger(request, @"timeoutMs", 100, 30000, &valid);
  NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
  NSData *json = payload ? [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil] : nil;
  if (!valid || ![@[@"prepare", @"renew", @"release", @"status"] containsObject:method ?: @""] || !service ||
      [service rangeOfCharacterFromSet:invalid].location != NSNotFound || !json || json.length > 16384) { [reply fail:@"invalid-request"]; return; }
  NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  dispatch_async(agentQueue, ^{
    __block BOOL settled = NO;
    // XPC calls back on its own queue; funnel every outcome through agentQueue so the first one wins.
    void (^finish)(NSDictionary *) = ^(NSDictionary *result) {
      dispatch_async(agentQueue, ^{ if (!settled) { settled = YES; [reply ok:result]; } });
    };
    // Creating the connection does not start the agent; only a delivered reply proves a live, validated peer.
    id<BDRecoveryService> proxy = [agentConnection(service) remoteObjectProxyWithErrorHandler:^(NSError *error) { finish(agentFailure(@"unreachable")); }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, timeoutMs * NSEC_PER_MSEC), agentQueue, ^{ finish(agentFailure(@"timeout")); });
    [proxy call:method payload:text reply:^(NSString *answer) { finish(agentReply(answer)); }];
  });
}

// ---- Entry ------------------------------------------------------------------------------------------------

double BDSystemOpBudget(NSString *op, NSDictionary *request) {
  BOOL valid = NO;
  if ([op isEqualToString:@"empty-trash"] || [op isEqualToString:@"agent-call"]) {
    int64_t timeoutMs = BDInteger(request, @"timeoutMs", 1, 120000, &valid);
    // The op answers its own "timeout" result first; the guard only catches a wedged queue.
    return valid ? timeoutMs / 1000.0 + 2.0 : 0;
  }
  // A consent prompt waits for the user; main owns how long it is willing to wait.
  if ([op isEqualToString:@"automation-status"] && [request[@"prompt"] isEqual:@YES]) return 120.0;
  return 0;
}
BOOL BDHandleSystemOp(NSString *op, NSDictionary *request, BDReply *reply) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    trashQueue = dispatch_queue_create("bottega.system-dock.trash", DISPATCH_QUEUE_SERIAL);
    agentQueue = dispatch_queue_create("bottega.system-dock.agent", DISPATCH_QUEUE_SERIAL);
    agentConnections = [NSMutableDictionary dictionary];
  });
  if ([op isEqualToString:@"trash-state"]) dispatch_async(trashQueue, ^{ [reply ok:trashState()]; });
  else if ([op isEqualToString:@"watch-trash"]) {
    if (!BDIsBool(request[@"enabled"])) { [reply fail:@"invalid-request"]; return YES; }
    BOOL enabled = [request[@"enabled"] boolValue];
    dispatch_async(trashQueue, ^{ watchTrash(enabled); [reply ok:@{ @"watching": enabled ? @YES : @NO }]; });
  }
  else if ([op isEqualToString:@"automation-status"]) automationStatus(request, reply);
  else if ([op isEqualToString:@"empty-trash"]) emptyTrash(request, reply);
  else if ([op isEqualToString:@"agent-call"]) agentCall(request, reply);
  else return NO;
  return YES;
}
