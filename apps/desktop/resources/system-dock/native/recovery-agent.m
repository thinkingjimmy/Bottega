/**
 * [INPUT]: Depends on launchd (RunAtLoad + MachServices from the bundled LaunchAgent plist), NSXPCListener, ~/.bottega/system-dock recovery.json / last-result.json (journal.ts formats), CFPreferences via shared.m, and NSRunningApplication for the Dock reload.
 * [OUTPUT]: Provides the `bottega-dock-recovery` executable: login/on-demand conditional restore of autohide/autohide-delay for a dead, hung, or exited owner, the prepare/renew/release/status XPC handshake, and bounded idle exit.
 * [POS]: system-dock/native last line of defence (PRD 5.5, INV-02..05); independent of Electron, never launches Bottega, never touches anything but the journal's two keys and its own result file.
 */

#import <AppKit/AppKit.h>
#import <fcntl.h>
#import <os/log.h>
#import <pwd.h>
#import <sys/stat.h>
#import "shared.h"

static const int64_t kLeaseMs = 20000;
static const uint64_t kMinUptimeNs = 10 * NSEC_PER_SEC, kIdleGraceNs = 10 * NSEC_PER_SEC;

static dispatch_queue_t queue;
static NSString *directory, *domain, *requirement;
static BOOL onceMode, exiting;
static uint64_t startedNs, idleSinceNs;
static int64_t highestEpoch, leaseExpiresAt;
static NSDictionary *owner;
static NSString *lastNonce;
static dispatch_source_t ownerWatch, leaseTimer, idleTimer;

static void note(NSString *format, ...) NS_FORMAT_FUNCTION(1, 2);
static void note(NSString *format, ...) {
  va_list args; va_start(args, format);
  NSString *line = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);
  os_log(OS_LOG_DEFAULT, "bottega-dock-recovery: %{public}s", line.UTF8String);
  fprintf(stderr, "bottega-dock-recovery: %s\n", line.UTF8String);
}
static uint64_t uptimeNs(void) { return clock_gettime_nsec_np(CLOCK_UPTIME_RAW); }
static int64_t wallMs(void) { return (int64_t)(NSDate.date.timeIntervalSince1970 * 1000); }
static NSString *journalPath(void) { return [directory stringByAppendingPathComponent:@"recovery.json"]; }
static BOOL alive(int64_t pid, int64_t startedAt) { return pid > 0 && pid <= INT32_MAX && BDProcessStartMs((pid_t)pid) == startedAt; }

// ---- Journal (journal.ts journalSchema, strict) ------------------------------------------------------

static BOOL isInt(id value, int64_t min, int64_t max) {
  if (!BDIsNumber(value)) return NO;
  double number = [value doubleValue];
  return number == floor(number) && number >= (double)min && number <= (double)max;
}
static BOOL isScalar(id value) { return value == NSNull.null || BDIsBool(value) || BDIsNumber(value) || [value isKindOfClass:NSString.class]; }
static BOOL hasKeys(id object, NSArray *keys) {
  return [object isKindOfClass:NSDictionary.class] && [[NSSet setWithArray:[object allKeys]] isEqualToSet:[NSSet setWithArray:keys]];
}
static BOOL isText(id value, NSUInteger min, NSUInteger max) { return [value isKindOfClass:NSString.class] && [value length] >= min && [value length] <= max; }
static BOOL isOperationId(id value) {
  if (!isText(value, 8, 64)) return NO;
  NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"];
  return [value rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound;
}
static BOOL validField(NSDictionary *field) {
  NSArray *types = @[@"bool", @"real", @"int", @"string", @"other", @"missing"];
  return hasKeys(field, @[@"key", @"originalPresent", @"originalType", @"originalValue", @"writtenType", @"writtenValue", @"written"]) &&
    [@[@"autohide", @"autohide-delay"] containsObject:field[@"key"]] && BDIsBool(field[@"originalPresent"]) &&
    [types containsObject:field[@"originalType"]] && isScalar(field[@"originalValue"]) &&
    [@[@"bool", @"real", @"int"] containsObject:field[@"writtenType"]] && (BDIsBool(field[@"writtenValue"]) || BDIsNumber(field[@"writtenValue"])) &&
    BDIsBool(field[@"written"]);
}
static BOOL validJournal(NSDictionary *journal) {
  if (!hasKeys(journal, @[@"version", @"operationId", @"ownershipEpoch", @"phase", @"consentVersion", @"owner", @"fields", @"reload", @"updatedAt"])) return NO;
  NSDictionary *who = journal[@"owner"];
  NSArray *fields = journal[@"fields"];
  if (!isInt(journal[@"version"], 1, 1) || !isOperationId(journal[@"operationId"]) || !isInt(journal[@"ownershipEpoch"], 1, INT64_MAX) ||
      ![@[@"preparing", @"active", @"restoring"] containsObject:journal[@"phase"]] || !isInt(journal[@"consentVersion"], 1, INT64_MAX) ||
      !BDIsBool(journal[@"reload"]) || !isInt(journal[@"updatedAt"], 0, INT64_MAX) || ![fields isKindOfClass:NSArray.class] || fields.count > 2 ||
      !hasKeys(who, @[@"installation", @"profile", @"pid", @"startedAt", @"appPath"]) || !isText(who[@"installation"], 1, 128) ||
      !isText(who[@"profile"], 1, 128) || !isInt(who[@"pid"], 1, INT64_MAX) || !isInt(who[@"startedAt"], 0, INT64_MAX) || !isText(who[@"appPath"], 0, 4096)) return NO;
  for (id field in fields) if (!validField(field)) return NO;
  return YES;
}
typedef NS_ENUM(NSInteger, JournalKind) { JournalNone, JournalOk, JournalCorrupt };
/** A corrupt or unreadable journal is evidence, not a value: it is never restored from and never deleted (INV-04). */
static JournalKind readJournal(NSDictionary **journal) {
  int fd = open(journalPath().fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return errno == ENOENT ? JournalNone : JournalCorrupt;
  struct stat info;
  NSMutableData *data = nil;
  if (fstat(fd, &info) == 0 && S_ISREG(info.st_mode) && info.st_size <= 1024 * 1024) {
    data = [NSMutableData dataWithLength:(NSUInteger)info.st_size];
    if (read(fd, data.mutableBytes, data.length) != (ssize_t)data.length) data = nil;
  }
  close(fd);
  id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (!validJournal(parsed)) return JournalCorrupt;
  *journal = parsed;
  return JournalOk;
}
static BOOL journalOwnerAlive(NSDictionary *journal) { return alive([journal[@"owner"][@"pid"] longLongValue], [journal[@"owner"][@"startedAt"] longLongValue]); }

// ---- Conditional restore (journal.ts planRestore) ------------------------------------------------------

static BOOL equalsWritten(NSDictionary *current, NSDictionary *field) {
  if (![current[@"present"] boolValue]) return NO;
  id written = field[@"writtenValue"];
  if ([field[@"writtenType"] isEqualToString:@"bool"]) return [current[@"type"] isEqualToString:@"bool"] && BDIsBool(written) && [current[@"value"] boolValue] == [written boolValue];
  return ([current[@"type"] isEqualToString:@"real"] || [current[@"type"] isEqualToString:@"int"]) && BDIsNumber(current[@"value"]) &&
    fabs([current[@"value"] doubleValue] - [written doubleValue]) < 1e-9;
}
static BOOL durableWrite(NSString *path, NSString *text) {
  NSString *temporary = [NSString stringWithFormat:@"%@.%@.tmp", path, NSUUID.UUID.UUIDString.lowercaseString];
  NSData *bytes = [text dataUsingEncoding:NSUTF8StringEncoding];
  int fd = open(temporary.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return NO;
  BOOL ok = write(fd, bytes.bytes, bytes.length) == (ssize_t)bytes.length && fsync(fd) == 0;
  close(fd);
  ok = ok && rename(temporary.fileSystemRepresentation, path.fileSystemRepresentation) == 0;
  if (!ok) { unlink(temporary.fileSystemRepresentation); return NO; }
  int dir = open(directory.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (dir >= 0) { fsync(dir); close(dir); }
  return YES;
}
static void writeLastResult(NSString *operationId, NSString *result) {
  // Same bytes as JSON.stringify(lastResult) + "\n" in journal.ts, field order included.
  NSString *text = [NSString stringWithFormat:@"{\"version\":1,\"operationId\":\"%@\",\"result\":\"%@\",\"by\":\"agent\",\"at\":%lld}\n",
    operationId, result, wallMs()];
  if (!durableWrite([directory stringByAppendingPathComponent:@"last-result.json"], text)) note(@"could not write last-result.json (errno %d)", errno);
}
static void clearOwnership(void) {
  if (ownerWatch) { dispatch_source_cancel(ownerWatch); ownerWatch = nil; }
  if (leaseTimer) { dispatch_source_cancel(leaseTimer); leaseTimer = nil; }
  owner = nil; leaseExpiresAt = 0;
}
/** Puts back only what still holds our written value; everything else stays with whoever changed it. */
static NSString *restore(NSDictionary *journal, NSString *reason) {
  BOOL changed = NO, kept = NO, failed = NO;
  for (NSDictionary *field in journal[@"fields"]) {
    if (![field[@"written"] boolValue]) continue;
    NSString *key = field[@"key"], *type = field[@"originalType"];
    id original = field[@"originalValue"], value = nil;
    if (!equalsWritten(BDPrefRead(domain, key), field)) { kept = YES; continue; }
    if ([field[@"originalPresent"] boolValue]) {
      if ([type isEqualToString:@"bool"] && BDIsBool(original)) value = [original boolValue] ? @YES : @NO;
      else if ([type isEqualToString:@"real"] && BDIsNumber(original)) value = @([original doubleValue]);
      else if ([type isEqualToString:@"int"] && BDIsNumber(original)) value = @([original longLongValue]);
      // An original of an unexpected type was refused at takeover; reaching here means the journal lies.
      else { kept = YES; continue; }
    }
    if (BDPrefWrite(domain, key, value)) changed = YES; else failed = YES;
  }
  if (changed && [domain isEqualToString:BD_DOCK_DOMAIN]) {
    // The Dock only rereads autohide on start; launchd relaunches it right away.
    for (NSRunningApplication *dock in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.dock"]) [dock forceTerminate];
  }
  NSString *result = failed ? @"failed" : kept ? @"kept-external" : @"restored";
  NSString *operationId = journal[@"operationId"];
  writeLastResult(operationId, result);
  NSDictionary *latest = nil;
  // A failed restore keeps its journal as evidence for the next attempt (next login or next owner).
  if (!failed && readJournal(&latest) == JournalOk && [latest[@"operationId"] isEqualToString:operationId]) unlink(journalPath().fileSystemRepresentation);
  note(@"%@: operation %@ -> %@", reason, operationId, result);
  // A newer owner's lease survives the cleanup of someone else's stale journal.
  if (!owner || [owner[@"operationId"] isEqual:operationId] || !alive([owner[@"pid"] longLongValue], [owner[@"startedAt"] longLongValue])) clearOwnership();
  return result;
}
/** Restores when the journal's owner is gone, or when the expired lease belongs to the journal's operation. */
static void checkJournal(NSString *reason, NSDictionary *expiredLease) {
  NSDictionary *journal = nil;
  JournalKind kind = readJournal(&journal);
  if (kind == JournalCorrupt) { note(@"%@: journal unreadable or unknown version; left untouched", reason); return; }
  if (kind == JournalNone) return;
  /* "restoring" means the owner is restoring right now, so an expired lease does not race it. A restore that has sat in
     that phase for longer than a whole lease is abandoned (a hung owner), and the agent takes over. */
  BOOL restoringNow = [journal[@"phase"] isEqualToString:@"restoring"] && wallMs() - [journal[@"updatedAt"] longLongValue] < kLeaseMs;
  BOOL leaseMatches = expiredLease && [journal[@"operationId"] isEqualToString:expiredLease[@"operationId"]] &&
    [journal[@"ownershipEpoch"] isEqual:expiredLease[@"epoch"]] && !restoringNow;
  if (!journalOwnerAlive(journal) || leaseMatches) restore(journal, reason);
}

// ---- Idle exit (N-04) ------------------------------------------------------------------------------------

static BOOL hasPendingWork(void) {
  if (leaseTimer) return YES;
  NSDictionary *journal = nil;
  // Only a journal someone alive still owns keeps us up; a dead owner's journal was just handled above.
  return readJournal(&journal) == JournalOk && journalOwnerAlive(journal);
}
static void evaluateIdle(void) {
  if (exiting || onceMode) return;
  if (idleTimer) { dispatch_source_cancel(idleTimer); idleTimer = nil; }
  if (hasPendingWork()) { idleSinceNs = 0; return; }
  uint64_t now = uptimeNs();
  if (!idleSinceNs) idleSinceNs = now;
  uint64_t deadline = MAX(startedNs + kMinUptimeNs, idleSinceNs + kIdleGraceNs);
  if (now >= deadline) { exiting = YES; note(@"idle; exiting"); exit(0); }
  idleTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
  dispatch_source_set_timer(idleTimer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(deadline - now)), DISPATCH_TIME_FOREVER, 50 * NSEC_PER_MSEC);
  dispatch_source_set_event_handler(idleTimer, ^{ evaluateIdle(); });
  dispatch_resume(idleTimer);
}

// ---- Owner watch and lease ----------------------------------------------------------------------------------

static void watchOwner(pid_t pid, int64_t startedAt) {
  if (ownerWatch) { dispatch_source_cancel(ownerWatch); ownerWatch = nil; }
  dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC, (uintptr_t)pid, DISPATCH_PROC_EXIT, queue);
  if (!source) return;
  dispatch_source_set_event_handler(source, ^{
    dispatch_source_cancel(source);
    if (ownerWatch == source) ownerWatch = nil;
    checkJournal(@"owner-exited", nil);
    if (owner && [owner[@"pid"] intValue] == pid) clearOwnership();
    evaluateIdle();
  });
  ownerWatch = source;
  dispatch_resume(source);
  // The owner may have exited before the source armed; the start-time check closes that gap.
  if (!alive(pid, startedAt)) dispatch_async(queue, ^{ if (ownerWatch == source) { dispatch_source_cancel(source); ownerWatch = nil; checkJournal(@"owner-exited", nil); evaluateIdle(); } });
}
static void armLease(void) {
  if (leaseTimer) dispatch_source_cancel(leaseTimer);
  leaseExpiresAt = wallMs() + kLeaseMs;
  NSDictionary *lease = @{ @"operationId": owner[@"operationId"], @"epoch": owner[@"epoch"] };
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
  // Monotonic: system sleep does not age the lease, so a sleeping-but-healthy main is not treated as hung.
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, kLeaseMs * NSEC_PER_MSEC), DISPATCH_TIME_FOREVER, 100 * NSEC_PER_MSEC);
  dispatch_source_set_event_handler(timer, ^{
    if (leaseTimer != timer) return;
    dispatch_source_cancel(timer); leaseTimer = nil; leaseExpiresAt = 0;
    checkJournal(@"lease-expired", lease);
    evaluateIdle();
  });
  leaseTimer = timer;
  dispatch_resume(timer);
}

// ---- XPC handshake ------------------------------------------------------------------------------------------

static NSString *replyJSON(BOOL ok, NSString *code) {
  BOOL observed = owner && alive([owner[@"pid"] longLongValue], [owner[@"startedAt"] longLongValue]) && ownerWatch != nil;
  NSDictionary *reply = @{ @"ok": ok ? @YES : @NO, @"agentPid": @(getpid()), @"code": code, @"observedOwner": observed ? @YES : @NO,
    @"leaseExpiresAt": leaseTimer ? @(leaseExpiresAt) : NSNull.null };
  return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:reply options:0 error:nil] encoding:NSUTF8StringEncoding];
}
static BOOL sameOwner(NSDictionary *payload) {
  return owner && [owner[@"pid"] isEqual:payload[@"ownerPid"]] && [owner[@"startedAt"] isEqual:payload[@"ownerStartedAt"]] &&
    [owner[@"epoch"] isEqual:payload[@"ownershipEpoch"]] && [owner[@"installation"] isEqual:payload[@"installation"]];
}
/** Runs on the serial queue, so each handshake is atomic with respect to restores, lease expiry, and idle exit. */
static NSString *handle(NSString *method, NSString *json, pid_t peer) {
  NSDictionary *payload = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] ?: NSData.data options:0 error:nil];
  if (!hasKeys(payload, @[@"operationId", @"ownershipEpoch", @"ownerPid", @"ownerStartedAt", @"installation", @"nonce", @"journalPath"]) ||
      !isOperationId(payload[@"operationId"]) || !isInt(payload[@"ownershipEpoch"], 1, INT64_MAX) || !isInt(payload[@"ownerPid"], 1, INT32_MAX) ||
      !isInt(payload[@"ownerStartedAt"], 0, INT64_MAX) || !isText(payload[@"installation"], 1, 128) || !isText(payload[@"nonce"], 1, 128) ||
      ![payload[@"journalPath"] isKindOfClass:NSString.class] || ![[payload[@"journalPath"] stringByStandardizingPath] isEqualToString:journalPath().stringByStandardizingPath])
    return replyJSON(NO, @"invalid");
  pid_t ownerPid = [payload[@"ownerPid"] intValue];
  int64_t ownerStartedAt = [payload[@"ownerStartedAt"] longLongValue], epoch = [payload[@"ownershipEpoch"] longLongValue];
  // The payload's pid is only believed when it is the live parent of the peer that sent it (the owner's bridge).
  if (BDParentPid(peer) != ownerPid || !alive(ownerPid, ownerStartedAt)) return replyJSON(NO, @"invalid");
  if ([method isEqualToString:@"status"]) return replyJSON(YES, @"ok");
  if (exiting) return replyJSON(NO, @"exiting");
  if (epoch < highestEpoch) return replyJSON(NO, @"stale-epoch");
  if ([payload[@"nonce"] isEqualToString:lastNonce ?: @""]) return replyJSON(NO, @"rejected");
  if ([method isEqualToString:@"prepare"]) {
    BOOL otherHolder = owner && leaseTimer && ![owner[@"epoch"] isEqual:payload[@"ownershipEpoch"]] &&
      alive([owner[@"pid"] longLongValue], [owner[@"startedAt"] longLongValue]);
    if (otherHolder) return replyJSON(NO, @"owned-elsewhere");
    highestEpoch = epoch; lastNonce = payload[@"nonce"];
    owner = @{ @"pid": @(ownerPid), @"startedAt": @(ownerStartedAt), @"epoch": @(epoch), @"operationId": payload[@"operationId"],
      @"installation": payload[@"installation"] };
    watchOwner(ownerPid, ownerStartedAt);
    armLease();
    evaluateIdle();
    return replyJSON(YES, @"ok");
  }
  if (!sameOwner(payload)) return replyJSON(NO, @"rejected");
  lastNonce = payload[@"nonce"];
  if ([method isEqualToString:@"renew"]) {
    // A lapsed lease already triggered recovery; renewing it would resurrect ownership nobody observed.
    if (!leaseTimer || ![owner[@"operationId"] isEqual:payload[@"operationId"]]) return replyJSON(NO, @"rejected");
    armLease();
    return replyJSON(YES, @"ok");
  }
  if ([method isEqualToString:@"release"]) {
    if (leaseTimer) { dispatch_source_cancel(leaseTimer); leaseTimer = nil; }
    leaseExpiresAt = 0;
    evaluateIdle();
    return replyJSON(YES, @"ok");
  }
  return replyJSON(NO, @"invalid");
}

@interface BDRecoveryEndpoint : NSObject <BDRecoveryService, NSXPCListenerDelegate>
@property (nonatomic) pid_t peer;
@end
@implementation BDRecoveryEndpoint
- (void)call:(NSString *)method payload:(NSString *)json reply:(void (^)(NSString *))reply {
  pid_t peer = self.peer;
  NSString *safeMethod = [@[@"prepare", @"renew", @"release", @"status"] containsObject:method ?: @""] ? method : @"invalid";
  dispatch_async(queue, ^{ reply(handle(safeMethod, [json isKindOfClass:NSString.class] && json.length <= 16384 ? json : @"", peer)); });
}
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
  if (connection.effectiveUserIdentifier != getuid()) return NO;
  if (requirement) { if (@available(macOS 13.0, *)) [connection setCodeSigningRequirement:requirement]; }
  BDRecoveryEndpoint *endpoint = [BDRecoveryEndpoint new];
  endpoint.peer = connection.processIdentifier;
  connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(BDRecoveryService)];
  connection.exportedObject = endpoint;
  [connection resume];
  return YES;
}
@end

// ---- Entry --------------------------------------------------------------------------------------------------------

static NSString *startupCheck(void) {
  NSDictionary *journal = nil;
  JournalKind kind = readJournal(&journal);
  if (kind == JournalNone) return @"none";
  if (kind == JournalCorrupt) { note(@"startup: journal unreadable or unknown version; left untouched"); return @"corrupt"; }
  if (!journalOwnerAlive(journal)) return restore(journal, @"startup");
  if (!onceMode) watchOwner([journal[@"owner"][@"pid"] intValue], [journal[@"owner"][@"startedAt"] longLongValue]);
  return @"owner-alive";
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *label = nil;
    struct passwd *user = getpwuid(getuid());
    directory = user && user->pw_dir ? [@(user->pw_dir) stringByAppendingPathComponent:@".bottega/system-dock"] : nil;
    domain = BD_DOCK_DOMAIN;
    // launchd passes only the label; the flags exist for tests against scratch directories and domains.
    for (int index = 1; index < argc; index += 1) {
      NSString *argument = @(argv[index]);
      if ([argument isEqualToString:@"--once"]) onceMode = YES;
      else if ([argument isEqualToString:@"--dir"] && index + 1 < argc) directory = @(argv[++index]);
      else if ([argument isEqualToString:@"--prefs-domain"] && index + 1 < argc) domain = @(argv[++index]);
      else if (index == 1 && ![argument hasPrefix:@"--"]) label = argument;
      else { fprintf(stderr, "usage: bottega-dock-recovery <mach-service-label> | --once [--dir <dir>] [--prefs-domain <domain>]\n"); return 64; }
    }
    if (!directory || (!onceMode && !label)) { fprintf(stderr, "bottega-dock-recovery: missing label or home directory\n"); return 64; }
    queue = dispatch_queue_create("bottega.dock-recovery", DISPATCH_QUEUE_SERIAL);
    startedNs = uptimeNs();
    if (onceMode) {
      __block NSString *outcome;
      dispatch_sync(queue, ^{ outcome = startupCheck(); });
      printf("%s\n", outcome.UTF8String);
      return 0;
    }
    requirement = BDTeamRequirement();
    if (!requirement) note(@"unsigned or ad-hoc build: peers are checked by uid and parent pid only");
    // Logout/shutdown: whatever restore is running on the queue finishes first, then we leave without a grace period.
    signal(SIGTERM, SIG_IGN);
    dispatch_source_t term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, queue);
    dispatch_source_set_event_handler(term, ^{ exiting = YES; note(@"SIGTERM; exiting"); exit(0); });
    dispatch_resume(term);
    BDRecoveryEndpoint *delegate = [BDRecoveryEndpoint new];
    NSXPCListener *listener = [[NSXPCListener alloc] initWithMachServiceName:label];
    listener.delegate = delegate;
    dispatch_async(queue, ^{ startupCheck(); evaluateIdle(); });
    [listener resume];
    dispatch_main();
  }
}
