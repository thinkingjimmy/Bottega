/**
 * [INPUT]: Depends on AppKit screen/workspace notifications, CoreGraphics window geometry, and bounded stdin commands.
 * [OUTPUT]: Provides versioned safe-area, conservative fullscreen/inactivity facts, and acknowledged prior-application focus restoration.
 * [POS]: Narrow subprocess adapter for presence; no task data, permissions, or login registration.
 */

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

static BOOL screensSleeping = NO;
static BOOL sessionInactive = NO;

static NSDictionary *rect(NSRect r, CGFloat primaryHeight) {
  return @{ @"x": @(r.origin.x), @"y": @(primaryHeight - NSMaxY(r)),
    @"width": @(r.size.width), @"height": @(r.size.height) };
}
static BOOL fullscreen(NSScreen *screen, NSArray *windows, pid_t frontmost, CGFloat primaryHeight) {
  NSRect frame = screen.frame;
  CGRect target = CGRectMake(frame.origin.x, primaryHeight - NSMaxY(frame), frame.size.width, frame.size.height);
  CGFloat topAllowance = MAX(screen.safeAreaInsets.top, NSMaxY(frame) - NSMaxY(screen.visibleFrame));
  for (NSDictionary *window in windows) {
    if ([window[(id)kCGWindowOwnerPID] intValue] != frontmost || [window[(id)kCGWindowLayer] intValue] != 0) continue;
    CGRect bounds;
    if (!CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)window[(id)kCGWindowBounds], &bounds)) continue;
    // Notched displays can keep the camera/menu band above a native full-screen window.
    // A window must still cover the full width and reach the physical screen's bottom.
    if (fabs(bounds.origin.x - target.origin.x) < 2 && fabs(bounds.size.width - target.size.width) < 2 &&
        fabs(CGRectGetMaxY(bounds) - CGRectGetMaxY(target)) < 2 && bounds.origin.y >= target.origin.y - 1 &&
        bounds.origin.y <= target.origin.y + topAllowance + 1) return YES;
  }
  return NO;
}
static void emitScreens(void) {
  NSArray<NSScreen *> *screens = NSScreen.screens;
  if (screens.count == 0) return;
  CGFloat primaryHeight = screens[0].frame.size.height;
  NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  pid_t frontmost = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  NSMutableArray *items = [NSMutableArray array];
  for (NSScreen *screen in screens) {
    if (items.count >= 16) break;
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    NSEdgeInsets safe = NSEdgeInsetsMake(0, 0, 0, 0);
    NSRect left = NSZeroRect, right = NSZeroRect;
    if (@available(macOS 12.0, *)) {
      safe = screen.safeAreaInsets;
      left = screen.auxiliaryTopLeftArea; right = screen.auxiliaryTopRightArea;
    }
    [items addObject:@{ @"id": display, @"builtin": [NSNumber numberWithBool:CGDisplayIsBuiltin(display.unsignedIntValue)],
      @"primary": [NSNumber numberWithBool:(screen == screens[0])], @"bounds": rect(screen.frame, primaryHeight),
      @"visible": rect(screen.visibleFrame, primaryHeight), @"topInset": @(safe.top),
      @"left": rect(left, primaryHeight), @"right": rect(right, primaryHeight),
      @"fullscreen": [NSNumber numberWithBool:fullscreen(screen, windows, frontmost, primaryHeight)],
      @"inactive": [NSNumber numberWithBool:(screensSleeping || sessionInactive)] }];
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{ @"version": @1, @"screens": items } options:0 error:nil];
  static NSData *previous;
  if ([data isEqualToData:previous]) return;
  previous = data;
  fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout);
}
static void refreshScreens(void) {
  static NSUInteger revision;
  NSUInteger current = ++revision;
  emitScreens();
  // Space notifications can precede the WindowServer animation's final geometry.
  for (NSNumber *delay in @[@0.2, @0.8, @1.5]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay.doubleValue * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (current == revision) emitScreens();
    });
  }
}
int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[NSWorkspaceActiveSpaceDidChangeNotification, NSWorkspaceDidActivateApplicationNotification,
        NSWorkspaceDidWakeNotification]) {
      [workspace addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { refreshScreens(); }];
    }
    for (NSNotificationName name in @[NSWorkspaceScreensDidSleepNotification, NSWorkspaceScreensDidWakeNotification,
        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceSessionDidBecomeActiveNotification]) {
      [workspace addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
        if ([note.name isEqualToString:NSWorkspaceScreensDidSleepNotification]) screensSleeping = YES;
        if ([note.name isEqualToString:NSWorkspaceScreensDidWakeNotification]) screensSleeping = NO;
        if ([note.name isEqualToString:NSWorkspaceSessionDidResignActiveNotification]) sessionInactive = YES;
        if ([note.name isEqualToString:NSWorkspaceSessionDidBecomeActiveNotification]) sessionInactive = NO;
        refreshScreens();
      }];
    }
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil
      queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { refreshScreens(); }];
    __block NSRunningApplication *previousApplication;
    __block NSMutableData *pending = [NSMutableData data];
    [NSFileHandle fileHandleWithStandardInput].readabilityHandler = ^(NSFileHandle *handle) {
      NSData *data = handle.availableData;
      if (data.length == 0) exit(0);
      dispatch_async(dispatch_get_main_queue(), ^{
        [pending appendData:data];
        if (pending.length > 1024) exit(2);
        NSString *text = [[NSString alloc] initWithData:pending encoding:NSUTF8StringEncoding];
        if (![text hasSuffix:@"\n"]) return;
        for (NSString *command in [text componentsSeparatedByString:@"\n"]) {
          if ([command isEqualToString:@"remember-focus"]) {
            previousApplication = NSWorkspace.sharedWorkspace.frontmostApplication;
            fputs("{\"version\":1,\"focusRemembered\":true}\n", stdout); fflush(stdout);
          }
          if ([command isEqualToString:@"restore-focus"] && previousApplication && !previousApplication.terminated) {
            [previousApplication activateWithOptions:0]; previousApplication = nil;
          }
          if ([command isEqualToString:@"refresh"]) refreshScreens();
        }
        [pending setLength:0];
      });
    };
    emitScreens();
    [NSApp run];
  }
  return 0;
}
