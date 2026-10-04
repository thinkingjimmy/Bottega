/**
 * [INPUT]: Depends on the Node-API and AppKit. NSGlassEffectView is resolved at runtime (macOS 26); the binary still loads on the macOS 15 deployment target.
 * [OUTPUT]: Provides the `dock-glass` addon: `apply(handle, radius)` inserts one clear glass plate behind the Electron content view, `clear(handle)` removes it. A missing class returns false and changes nothing.
 * [POS]: system-dock/native in-process glass for the bar window. It is not the JSON-line helper; Electron main loads this `.node` and never ships it to a renderer.
 */

#include <node_api.h>
#include <string.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static const void *kDockGlass = &kDockGlass;

static NSView *hostView(napi_env env, napi_value value) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) return nil;
  void *data = NULL;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok || data == NULL || length < sizeof(void *)) return nil;
  void *raw = NULL;
  memcpy(&raw, data, sizeof(raw));
  NSView *view = (__bridge NSView *)raw;
  return [view isKindOfClass:[NSView class]] ? view : nil;
}

static void setInteger(id object, const char *selector, NSInteger value) {
  SEL sel = sel_registerName(selector);
  if (![object respondsToSelector:sel]) return;
  void (*imp)(id, SEL, NSInteger) = (void *)[object methodForSelector:sel];
  imp(object, sel, value);
}

static void setFloat(id object, const char *selector, CGFloat value) {
  SEL sel = sel_registerName(selector);
  if (![object respondsToSelector:sel]) return;
  void (*imp)(id, SEL, CGFloat) = (void *)[object methodForSelector:sel];
  imp(object, sel, value);
}

static void setObject(id object, const char *selector, id value) {
  SEL sel = sel_registerName(selector);
  if (![object respondsToSelector:sel]) return;
  void (*imp)(id, SEL, id) = (void *)[object methodForSelector:sel];
  imp(object, sel, value);
}

static void removeGlass(NSView *host) {
  NSView *glass = objc_getAssociatedObject(host, kDockGlass);
  if (glass) [glass removeFromSuperview];
  objc_setAssociatedObject(host, kDockGlass, nil, OBJC_ASSOCIATION_RETAIN);
}

static bool insertGlass(NSView *host, CGFloat radius) {
  Class cls = NSClassFromString(@"NSGlassEffectView");
  if (!cls) return false;
  removeGlass(host);
  NSView *glass = [[cls alloc] initWithFrame:host.bounds];
  glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  /* Clear samples the desktop. A light tint keeps the bar from disappearing into the wallpaper. */
  setInteger(glass, "setStyle:", 1);
  setFloat(glass, "setCornerRadius:", radius);
  setObject(glass, "setTintColor:", [NSColor colorWithWhite:1 alpha:0.12]);
  if (host.window) {
    host.window.opaque = NO;
    host.window.backgroundColor = NSColor.clearColor;
  }
  [host addSubview:glass positioned:NSWindowBelow relativeTo:nil];
  objc_setAssociatedObject(host, kDockGlass, glass, OBJC_ASSOCIATION_RETAIN);
  return true;
}

static napi_value clearGlass(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  NSView *host = argc == 1 ? hostView(env, args[0]) : nil;
  if (host) {
    if ([NSThread isMainThread]) removeGlass(host);
    else dispatch_sync(dispatch_get_main_queue(), ^{ removeGlass(host); });
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value applyGlass(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  NSView *host = argc >= 1 ? hostView(env, args[0]) : nil;
  double radius = 17;
  if (argc >= 2) napi_get_value_double(env, args[1], &radius);
  __block bool ok = false;
  if (host) {
    CGFloat points = (CGFloat)radius;
    if ([NSThread isMainThread]) ok = insertGlass(host, points);
    else dispatch_sync(dispatch_get_main_queue(), ^{ ok = insertGlass(host, points); });
  }
  napi_value result;
  napi_get_boolean(env, ok, &result);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value applyFn;
  napi_value clearFn;
  napi_create_function(env, "apply", NAPI_AUTO_LENGTH, applyGlass, NULL, &applyFn);
  napi_create_function(env, "clear", NAPI_AUTO_LENGTH, clearGlass, NULL, &clearFn);
  napi_set_named_property(env, exports, "apply", applyFn);
  napi_set_named_property(env, exports, "clear", clearFn);
  return exports;
}

NAPI_MODULE(dock_glass, init)
