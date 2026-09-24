/**
 * [INPUT]: Depends on AppKit/NSWorkspace (running apps, LaunchServices resolution, icons, launch), ApplicationServices AX, CFPreferences via shared.m, and bridge-system.m for Trash/Finder/agent ops.
 * [OUTPUT]: Provides the `system-dock-bridge` executable: newline-delimited JSON requests on stdin, one bounded response per id plus coalesced "running" events on stdout, exactly as electron/main/system-dock/native/protocol.ts (hello, running-apps, process-info, activate-pid, installed-apps, resolve-app, icons, launch, finder-activate, ax-status, unminimize, dock-prefs-*, dock-reload, dock-persistent-apps).
 * [POS]: system-dock/native I/O core and app/preference ops; a long-lived child of Electron main that never blocks its read loop or main run loop and never talks to a renderer.
 */

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <stdatomic.h>
#import <sys/utsname.h>
#import "bridge.h"

static const NSUInteger kLineBytes = 4 * 1024 * 1024;
static const double kDefaultTimeout = 5.0;
NSString *BDPrefsDomain = BD_DOCK_DOMAIN;
static dispatch_queue_t outQueue, prefsQueue, iconQueue, workQueue;

void BDEmit(NSDictionary *object) {
  dispatch_async(outQueue, ^{
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingWithoutEscapingSlashes error:nil];
    if (data.length >= kLineBytes && object[@"id"]) {
      // Main must still settle this id; an oversized result becomes a bounded error instead of a broken line.
      data = [NSJSONSerialization dataWithJSONObject:@{ @"id": object[@"id"], @"ok": @NO, @"error": @"too-large" } options:0 error:nil];
    }
    if (!data || data.length >= kLineBytes) { fprintf(stderr, "system-dock-bridge: dropped unencodable line\n"); return; }
    fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout);
  });
}

@implementation BDReply { NSNumber *_id; atomic_bool _done; }
- (instancetype)initWithId:(NSNumber *)identifier budget:(double)seconds {
  if ((self = [super init])) {
    _id = identifier; atomic_init(&_done, false);
    // Every id settles even if an op wedges; a reply that already went out ignores the guard.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), workQueue, ^{ [self fail:@"timeout"]; });
  }
  return self;
}
- (BOOL)claim { bool expected = false; return atomic_compare_exchange_strong(&_done, &expected, true); }
- (void)ok:(id)result { if ([self claim]) BDEmit(@{ @"id": _id, @"ok": @YES, @"result": result ?: NSNull.null }); }
- (void)fail:(NSString *)code {
  if ([self claim]) BDEmit(@{ @"id": _id, @"ok": @NO, @"error": code.length <= 64 ? code : [code substringToIndex:64] });
}
@end

NSString *BDString(NSDictionary *request, NSString *key, NSUInteger maxLength) {
  id value = request[key];
  return [value isKindOfClass:NSString.class] && [value length] > 0 && [value length] <= maxLength ? value : nil;
}
int64_t BDInteger(NSDictionary *request, NSString *key, int64_t min, int64_t max, BOOL *ok) {
  id value = request[key];
  double number = BDIsNumber(value) ? [value doubleValue] : NAN;
  *ok = isfinite(number) && number == floor(number) && number >= (double)min && number <= (double)max;
  return *ok ? (int64_t)number : 0;
}
static NSNumber *flag(BOOL value) { return value ? @YES : @NO; }
static id orNull(id value) { return value ?: NSNull.null; }
static NSString *clip(NSString *value, NSUInteger max) { return [value isKindOfClass:NSString.class] ? (value.length <= max ? value : [value substringToIndex:max]) : nil; }

// ---- Running applications -------------------------------------------------------------------

static NSArray *runningApps(void) {
  NSMutableArray *items = [NSMutableArray array];
  for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
    if (items.count >= 512) break;
    // Only .app bundles are Dock-like; bare daemons report their executable as a "bundle" URL.
    if (!app.bundleURL || [app.bundleURL.pathExtension caseInsensitiveCompare:@"app"] != NSOrderedSame || app.processIdentifier <= 0) continue;
    NSString *policy = app.activationPolicy == NSApplicationActivationPolicyRegular ? @"regular"
      : app.activationPolicy == NSApplicationActivationPolicyAccessory ? @"accessory" : @"prohibited";
    NSString *name = clip(app.localizedName, 512) ?: app.bundleURL.lastPathComponent.stringByDeletingPathExtension;
    NSString *path = app.bundleURL.path.length <= 4096 ? app.bundleURL.path : nil;
    NSString *bundle = app.bundleIdentifier.length && app.bundleIdentifier.length <= 255 ? app.bundleIdentifier : nil;
    [items addObject:@{ @"pid": @(app.processIdentifier), @"bundleIdentifier": orNull(bundle), @"name": clip(name, 512) ?: @"",
      @"path": orNull(path), @"activationPolicy": policy, @"finishedLaunching": flag(app.finishedLaunching),
      @"active": flag(app.active), @"hidden": flag(app.hidden) }];
  }
  return items;
}
static void scheduleRunningEvent(void) {
  static BOOL pending;
  static NSData *previous;
  if (pending) return;
  pending = YES;
  // Launch storms and activation ping-pong collapse into one snapshot per 100 ms.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    pending = NO;
    NSArray *apps = runningApps();
    NSData *data = [NSJSONSerialization dataWithJSONObject:apps options:0 error:nil];
    if ([data isEqualToData:previous]) return;
    previous = data;
    BDEmit(@{ @"event": @"running", @"apps": apps });
  });
}

// ---- Resolution, icons, launch --------------------------------------------------------------

static BOOL isAppBundle(NSString *path) {
  BOOL directory = NO;
  return path.isAbsolutePath && [path.pathExtension caseInsensitiveCompare:@"app"] == NSOrderedSame &&
    [NSFileManager.defaultManager fileExistsAtPath:path isDirectory:&directory] && directory;
}
static NSDictionary *describeApp(NSString *path) {
  NSBundle *bundle = [NSBundle bundleWithPath:path];
  NSDictionary *info = bundle.localizedInfoDictionary ?: @{};
  NSString *name = clip(info[@"CFBundleDisplayName"], 512) ?: clip(bundle.infoDictionary[@"CFBundleDisplayName"], 512) ?:
    clip(info[@"CFBundleName"], 512) ?: clip(bundle.infoDictionary[@"CFBundleName"], 512) ?: path.lastPathComponent.stringByDeletingPathExtension;
  NSString *identifier = bundle.bundleIdentifier.length && bundle.bundleIdentifier.length <= 255 ? bundle.bundleIdentifier : nil;
  NSMutableArray *copies = [NSMutableArray arrayWithObject:path];
  if (identifier) {
    for (NSURL *url in [NSWorkspace.sharedWorkspace URLsForApplicationsWithBundleIdentifier:identifier]) {
      if (copies.count >= 16) break;
      if (url.path.length <= 4096 && ![copies containsObject:url.path]) [copies addObject:url.path];
    }
  }
  return @{ @"path": path, @"bundleIdentifier": orNull(identifier), @"name": clip(name, 512) ?: @"",
    @"version": orNull(clip(bundle.infoDictionary[@"CFBundleShortVersionString"], 128)), @"copies": copies };
}
static void resolveApp(NSDictionary *request, BDReply *reply) {
  NSString *identifier = BDString(request, @"bundleIdentifier", 255), *path = BDString(request, @"path", 4096);
  if ((identifier == nil) == (path == nil)) { [reply fail:@"invalid-request"]; return; }
  dispatch_async(workQueue, ^{
    NSString *target = path;
    if (identifier) target = [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:identifier].path;
    [reply ok:target && target.length <= 4096 && isAppBundle(target) ? describeApp(target) : NSNull.null];
  });
}
static void installedApps(BDReply *reply) {
  dispatch_async(workQueue, ^{
    NSMutableArray *items = [NSMutableArray array];
    NSFileManager *files = NSFileManager.defaultManager;
    NSArray *roots = @[@"/Applications", @"/Applications/Utilities", @"/System/Applications", @"/System/Applications/Utilities",
      [NSHomeDirectory() stringByAppendingPathComponent:@"Applications"]];
    for (NSString *root in roots) {
      // First level only: nested folders and bundle contents are never walked, so the scan stays bounded.
      NSArray<NSURL *> *entries = [files contentsOfDirectoryAtURL:[NSURL fileURLWithPath:root isDirectory:YES]
        includingPropertiesForKeys:@[NSURLIsDirectoryKey] options:NSDirectoryEnumerationSkipsHiddenFiles error:nil];
      for (NSURL *url in entries) {
        if (items.count >= 2048) break;
        NSNumber *directory = nil;
        [url getResourceValue:&directory forKey:NSURLIsDirectoryKey error:nil];
        if (!directory.boolValue || [url.pathExtension caseInsensitiveCompare:@"app"] != NSOrderedSame || url.path.length > 4096) continue;
        @autoreleasepool {
          // Info.plist only; an NSBundle per app would be cached for the helper's lifetime.
          NSDictionary *info = CFBridgingRelease(CFBundleCopyInfoDictionaryInDirectory((__bridge CFURLRef)url));
          NSString *identifier = BDString(info ?: @{}, @"CFBundleIdentifier", 255);
          NSString *name = [files displayNameAtPath:url.path];
          if ([name.pathExtension caseInsensitiveCompare:@"app"] == NSOrderedSame) name = name.stringByDeletingPathExtension;
          name = clip(name, 512) ?: clip(info[@"CFBundleDisplayName"], 512) ?: clip(info[@"CFBundleName"], 512) ?: url.lastPathComponent.stringByDeletingPathExtension;
          [items addObject:@{ @"path": url.path, @"bundleIdentifier": orNull(identifier), @"name": clip(name, 512) ?: @"" }];
        }
      }
    }
    [reply ok:items];
  });
}
static NSString *iconDataURL(NSString *path, NSInteger points) {
  NSInteger pixels = points * 2;
  NSImage *icon = [NSWorkspace.sharedWorkspace iconForFile:path];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:pixels pixelsHigh:pixels bitsPerSample:8
    samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  if (!icon || !rep) return nil;
  rep.size = NSMakeSize(pixels, pixels);
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  NSGraphicsContext.currentContext = context;
  context.imageInterpolation = NSImageInterpolationHigh;
  [icon drawInRect:NSMakeRect(0, 0, pixels, pixels) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1];
  [context flushGraphics];
  [NSGraphicsContext restoreGraphicsState];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  NSString *url = png ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : nil;
  return url.length <= 512 * 1024 ? url : nil;
}
static void icons(NSDictionary *request, BDReply *reply) {
  NSArray *paths = request[@"paths"];
  BOOL valid = NO;
  int64_t size = BDInteger(request, @"size", 16, 256, &valid);
  if (!valid || ![paths isKindOfClass:NSArray.class] || paths.count > 32) { [reply fail:@"invalid-request"]; return; }
  for (id path in paths) if (![path isKindOfClass:NSString.class] || ![path isAbsolutePath] || [path length] > 4096) { [reply fail:@"invalid-request"]; return; }
  // Serial: AppKit graphics state is per thread, and icon decoding is the heaviest thing this helper does.
  dispatch_async(iconQueue, ^{
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    for (NSString *path in paths) {
      @autoreleasepool {
        if (![NSFileManager.defaultManager fileExistsAtPath:path]) continue;
        NSString *url = iconDataURL(path, (NSInteger)size);
        if (url) result[path] = url;
      }
    }
    [reply ok:result];
  });
}
static void openApp(NSURL *url, BDReply *reply, id (^shape)(NSRunningApplication *app, NSError *error)) {
  NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
  configuration.activates = YES;
  // A running target receives a reopen event, which is what makes minimized-only apps show a window.
  [NSWorkspace.sharedWorkspace openApplicationAtURL:url configuration:configuration completionHandler:^(NSRunningApplication *app, NSError *error) {
    id result = shape(app, error);
    if (result) [reply ok:result]; else [reply fail:@"launch-failed"];
  }];
}
static void launch(NSDictionary *request, BDReply *reply) {
  NSString *path = BDString(request, @"path", 4096);
  if (!path || !isAppBundle(path) || ![request[@"activate"] isEqual:@YES]) { [reply fail:@"invalid-request"]; return; }
  openApp([NSURL fileURLWithPath:path isDirectory:YES], reply, ^id(NSRunningApplication *app, NSError *error) {
    if (error) return nil;
    return @{ @"pid": app.processIdentifier > 0 ? @(app.processIdentifier) : NSNull.null };
  });
}
static void activateFinder(BDReply *reply) {
  NSURL *finder = [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"com.apple.finder"];
  if (!finder) { [reply ok:@{ @"activated": @NO }]; return; }
  openApp(finder, reply, ^id(NSRunningApplication *app, NSError *error) { return @{ @"activated": flag(error == nil) }; });
}

static void activatePid(NSDictionary *request, BDReply *reply) {
  BOOL valid = NO;
  pid_t pid = (pid_t)BDInteger(request, @"pid", 1, INT32_MAX, &valid);
  if (!valid) { [reply fail:@"invalid-request"]; return; }
  dispatch_async(dispatch_get_main_queue(), ^{
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    // Plain activation hands focus back without the reopen event that `launch` sends, so no window is created.
    [reply ok:@{ @"activated": flag(app && !app.terminated && [app activateWithOptions:0]) }];
  });
}

// ---- Accessibility ---------------------------------------------------------------------------

static void axStatus(NSDictionary *request, BDReply *reply) {
  BOOL prompt = [request[@"prompt"] isEqual:@YES];
  dispatch_async(workQueue, ^{
    NSDictionary *options = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: flag(prompt) };
    [reply ok:@{ @"trusted": flag(AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options)) }];
  });
}
static void unminimize(NSDictionary *request, BDReply *reply) {
  BOOL valid = NO;
  pid_t pid = (pid_t)BDInteger(request, @"pid", 1, INT32_MAX, &valid);
  if (!valid) { [reply fail:@"invalid-request"]; return; }
  dispatch_async(workQueue, ^{
    // Never prompts: a denied or revoked grant degrades to plain activation, reported honestly.
    if (!AXIsProcessTrusted()) { [reply ok:@{ @"trusted": @NO, @"restored": @0, @"windows": @0 }]; return; }
    if (![NSRunningApplication runningApplicationWithProcessIdentifier:pid]) { [reply fail:@"not-running"]; return; }
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(app, 1.0);
    CFArrayRef windows = NULL;
    NSInteger restored = 0, count = 0;
    if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, (CFTypeRef *)&windows) == kAXErrorSuccess && windows) {
      count = MIN(CFArrayGetCount(windows), 64);
      for (CFIndex index = 0; index < count; index += 1) {
        AXUIElementRef window = (AXUIElementRef)CFArrayGetValueAtIndex(windows, index);
        CFTypeRef minimized = NULL;
        if (AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute, &minimized) == kAXErrorSuccess && minimized) {
          if (CFGetTypeID(minimized) == CFBooleanGetTypeID() && CFBooleanGetValue(minimized) &&
              AXUIElementSetAttributeValue(window, kAXMinimizedAttribute, kCFBooleanFalse) == kAXErrorSuccess) restored += 1;
          CFRelease(minimized);
        }
      }
      CFRelease(windows);
    }
    CFRelease(app);
    [reply ok:@{ @"trusted": @YES, @"restored": @(restored), @"windows": @(count) }];
  });
}

// ---- Dock preferences --------------------------------------------------------------------------

static NSArray<NSString *> *prefKeys(void) { return @[@"autohide", @"autohide-delay"]; }
static NSDictionary *readPrefs(void) {
  NSMutableDictionary *prefs = [NSMutableDictionary dictionary];
  for (NSString *key in prefKeys()) prefs[key] = BDPrefRead(BDPrefsDomain, key);
  return prefs;
}
static void writePref(NSDictionary *request, BDReply *reply) {
  NSString *key = BDString(request, @"key", 64), *action = BDString(request, @"action", 16), *type = BDString(request, @"type", 8);
  if (![prefKeys() containsObject:key ?: @""]) { [reply fail:@"invalid-key"]; return; }
  id value = nil;
  if ([action isEqualToString:@"set"]) {
    id raw = request[@"value"];
    BOOL integral = BDIsNumber(raw) && [raw doubleValue] == floor([raw doubleValue]) && fabs([raw doubleValue]) < 1e15;
    if ([type isEqualToString:@"bool"] && BDIsBool(raw)) value = [raw boolValue] ? @YES : @NO;
    else if ([type isEqualToString:@"real"] && BDIsNumber(raw)) value = @([raw doubleValue]);
    else if ([type isEqualToString:@"int"] && integral) value = @([raw longLongValue]);
    if (!value) { [reply fail:@"invalid-value"]; return; }
  } else if (![action isEqualToString:@"delete"]) { [reply fail:@"invalid-request"]; return; }
  dispatch_async(prefsQueue, ^{
    // A forced (MDM) key would silently not take effect; refuse rather than pretend (INV-04).
    if ([BDPrefRead(BDPrefsDomain, key)[@"forced"] boolValue]) { [reply fail:@"managed"]; return; }
    if (!BDPrefWrite(BDPrefsDomain, key, value)) { [reply fail:@"sync-failed"]; return; }
    [reply ok:readPrefs()];
  });
}
static void reloadDock(BDReply *reply) {
  if (![BDPrefsDomain isEqualToString:BD_DOCK_DOMAIN]) { [reply ok:@{ @"reloaded": @NO }]; return; }
  dispatch_async(dispatch_get_main_queue(), ^{
    BOOL found = NO;
    // launchd relaunches Dock immediately; it rereads com.apple.dock on start.
    for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.dock"]) {
      found = YES; [app forceTerminate];
    }
    [reply ok:@{ @"reloaded": flag(found) }];
  });
}

// ---- Persistent Dock tiles (import source only) ---------------------------------------------------

static NSDictionary *parseTile(id entry, NSString *section) {
  if (![entry isKindOfClass:NSDictionary.class]) return nil;
  NSString *tileType = clip(entry[@"tile-type"], 64);
  if (!tileType.length) return nil;
  NSDictionary *data = [entry[@"tile-data"] isKindOfClass:NSDictionary.class] ? entry[@"tile-data"] : @{};
  NSString *label = clip(data[@"file-label"], 512) ?: clip(data[@"label"], 512);
  NSString *bundle = BDString(data, @"bundle-identifier", 255);
  NSDictionary *file = [data[@"file-data"] isKindOfClass:NSDictionary.class] ? data[@"file-data"]
    : [data[@"url"] isKindOfClass:NSDictionary.class] ? data[@"url"] : nil;
  NSString *raw = BDString(file ?: @{}, @"_CFURLString", 4096), *path = nil, *url = nil;
  if ([raw hasPrefix:@"file://"]) {
    NSURL *parsed = [NSURL URLWithString:raw];
    path = parsed.isFileURL && parsed.path.length ? parsed.path : nil;
  } else if ([raw hasPrefix:@"/"]) path = raw;
  else url = raw;
  return @{ @"section": section, @"tileType": tileType, @"label": orNull(label), @"bundleIdentifier": orNull(bundle),
    @"path": orNull(path.length <= 4096 ? path : nil), @"url": orNull(url) };
}
static void persistentApps(BDReply *reply) {
  dispatch_async(prefsQueue, ^{
    CFStringRef app = (__bridge CFStringRef)BDPrefsDomain;
    CFPreferencesAppSynchronize(app);
    NSMutableArray *tiles = [NSMutableArray array];
    BOOL managed = NO, present = NO, malformed = NO;
    for (NSArray *pair in @[@[@"persistent-apps", @"apps"], @[@"persistent-others", @"others"]]) {
      managed |= CFPreferencesAppValueIsForced((__bridge CFStringRef)pair[0], app);
      id list = CFBridgingRelease(CFPreferencesCopyAppValue((__bridge CFStringRef)pair[0], app));
      if (!list) continue;
      present = YES;
      if (![list isKindOfClass:NSArray.class]) { malformed = YES; continue; }
      // Unknown or damaged tiles are skipped one by one; the rest of the user's Dock still imports.
      for (id entry in list) {
        if (tiles.count >= 256) break;
        NSDictionary *tile = parseTile(entry, pair[1]);
        if (tile) [tiles addObject:tile];
      }
    }
    NSString *status = managed ? @"managed" : !present ? @"missing" : (malformed && tiles.count == 0) ? @"unavailable" : @"ok";
    [reply ok:@{ @"status": status, @"tiles": tiles }];
  });
}

// ---- Request loop -----------------------------------------------------------------------------------

static void hello(BDReply *reply) {
  NSOperatingSystemVersion os = NSProcessInfo.processInfo.operatingSystemVersion;
  NSString *version = os.patchVersion ? [NSString stringWithFormat:@"%ld.%ld.%ld", os.majorVersion, os.minorVersion, os.patchVersion]
    : [NSString stringWithFormat:@"%ld.%ld", os.majorVersion, os.minorVersion];
  struct utsname name; uname(&name);
  pid_t parent = getppid();
  int64_t started = BDProcessStartMs(parent);
  [reply ok:@{ @"version": @1, @"osVersion": version, @"arch": clip(@(name.machine), 16) ?: @"unknown", @"parentPid": @(parent),
    @"parentStartedAt": @(MAX(started, 0)), @"uid": @(getuid()), @"axTrusted": flag(AXIsProcessTrusted()) }];
}
static void processInfo(NSDictionary *request, BDReply *reply) {
  BOOL valid = NO;
  pid_t pid = (pid_t)BDInteger(request, @"pid", 1, INT32_MAX, &valid);
  if (!valid) { [reply fail:@"invalid-request"]; return; }
  int64_t started = BDProcessStartMs(pid);
  // sysctl reads other users' processes too; EPERM from kill only matters if sysctl itself came back empty.
  BOOL alive = started >= 0 || (kill(pid, 0) != 0 && errno == EPERM);
  [reply ok:@{ @"alive": flag(alive), @"startedAt": started >= 0 ? @(started) : NSNull.null }];
}
static void handle(NSData *line) {
  NSDictionary *request = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
  BOOL valid = NO;
  int64_t identifier = [request isKindOfClass:NSDictionary.class] ? BDInteger(request, @"id", 1, 9007199254740991LL, &valid) : 0;
  NSString *op = valid ? BDString(request, @"op", 64) : nil;
  if (!valid) { fprintf(stderr, "system-dock-bridge: ignored malformed request line\n"); return; }
  double budget = MAX(kDefaultTimeout, BDSystemOpBudget(op ?: @"", request));
  BDReply *reply = [[BDReply alloc] initWithId:@(identifier) budget:budget];
  if (!op) [reply fail:@"unknown-op"];
  else if ([op isEqualToString:@"hello"]) hello(reply);
  else if ([op isEqualToString:@"running-apps"]) dispatch_async(dispatch_get_main_queue(), ^{ [reply ok:runningApps()]; });
  else if ([op isEqualToString:@"resolve-app"]) resolveApp(request, reply);
  else if ([op isEqualToString:@"icons"]) icons(request, reply);
  else if ([op isEqualToString:@"launch"]) launch(request, reply);
  else if ([op isEqualToString:@"ax-status"]) axStatus(request, reply);
  else if ([op isEqualToString:@"unminimize"]) unminimize(request, reply);
  else if ([op isEqualToString:@"dock-prefs-read"]) dispatch_async(prefsQueue, ^{ [reply ok:readPrefs()]; });
  else if ([op isEqualToString:@"dock-prefs-write"]) writePref(request, reply);
  else if ([op isEqualToString:@"dock-reload"]) reloadDock(reply);
  else if ([op isEqualToString:@"dock-persistent-apps"]) persistentApps(reply);
  else if ([op isEqualToString:@"finder-activate"]) activateFinder(reply);
  else if ([op isEqualToString:@"process-info"]) processInfo(request, reply);
  else if ([op isEqualToString:@"activate-pid"]) activatePid(request, reply);
  else if ([op isEqualToString:@"installed-apps"]) installedApps(reply);
  else if (!BDHandleSystemOp(op, request, reply)) [reply fail:@"unknown-op"];
}
static void readLoop(void) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSMutableData *pending = [NSMutableData data];
    BOOL discarding = NO;
    uint8_t chunk[65536];
    for (;;) {
      ssize_t count = read(STDIN_FILENO, chunk, sizeof chunk);
      if (count < 0 && errno == EINTR) continue;
      // Main closed the pipe (or died): nothing can consume replies any more.
      if (count <= 0) exit(0);
      size_t start = 0;
      for (size_t index = 0; index < (size_t)count; index += 1) {
        if (chunk[index] != '\n') continue;
        if (!discarding) [pending appendBytes:chunk + start length:index - start];
        if (!discarding && pending.length) { NSData *line = [pending copy]; @autoreleasepool { handle(line); } }
        [pending setLength:0]; discarding = NO; start = index + 1;
      }
      if (!discarding) [pending appendBytes:chunk + start length:(size_t)count - start];
      if (pending.length > kLineBytes) {
        fprintf(stderr, "system-dock-bridge: discarded a request line over 4 MiB\n");
        [pending setLength:0]; discarding = YES;
      }
    }
  });
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    // Tests only: exercise preference ops on a scratch domain; main always spawns with no arguments.
    if (argc == 3 && strcmp(argv[1], "--prefs-domain") == 0 && strlen(argv[2]) > 0) BDPrefsDomain = @(argv[2]);
    else if (argc != 1) { fprintf(stderr, "usage: system-dock-bridge [--prefs-domain <domain>]\n"); return 64; }
    signal(SIGPIPE, SIG_IGN);
    outQueue = dispatch_queue_create("bottega.system-dock.out", DISPATCH_QUEUE_SERIAL);
    prefsQueue = dispatch_queue_create("bottega.system-dock.prefs", DISPATCH_QUEUE_SERIAL);
    iconQueue = dispatch_queue_create("bottega.system-dock.icons", DISPATCH_QUEUE_SERIAL);
    workQueue = dispatch_queue_create("bottega.system-dock.work", DISPATCH_QUEUE_CONCURRENT);
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[NSWorkspaceWillLaunchApplicationNotification, NSWorkspaceDidLaunchApplicationNotification,
        NSWorkspaceDidTerminateApplicationNotification, NSWorkspaceDidActivateApplicationNotification,
        NSWorkspaceDidDeactivateApplicationNotification, NSWorkspaceDidHideApplicationNotification, NSWorkspaceDidUnhideApplicationNotification]) {
      [workspace addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { scheduleRunningEvent(); }];
    }
    readLoop();
    [NSApp run];
  }
  return 0;
}
