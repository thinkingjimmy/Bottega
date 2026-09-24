/**
 * [INPUT]: Depends on sysctl KERN_PROC_PID, CFPreferences (CurrentUser/AnyHost writes, effective reads), and SecCode signing information.
 * [OUTPUT]: Implements shared.h: process start identity, typed Dock preference read/write, JSON scalar predicates, and the same-team XPC requirement.
 * [POS]: system-dock/native common implementation compiled into both system-dock-bridge and bottega-dock-recovery so ownership and restore facts match byte for byte.
 */

#import "shared.h"
#import <Security/Security.h>
#import <sys/sysctl.h>

static BOOL procInfo(pid_t pid, struct kinfo_proc *info) {
  if (pid <= 0) return NO;
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, pid };
  size_t size = sizeof(*info);
  memset(info, 0, size);
  // A vanished pid still returns 0 with an empty buffer; only a filled record is a live process.
  return sysctl(mib, 4, info, &size, NULL, 0) == 0 && size == sizeof(*info) && info->kp_proc.p_pid == pid;
}
int64_t BDProcessStartMs(pid_t pid) {
  struct kinfo_proc info;
  if (!procInfo(pid, &info)) return -1;
  return (int64_t)info.kp_proc.p_starttime.tv_sec * 1000 + info.kp_proc.p_starttime.tv_usec / 1000;
}
pid_t BDParentPid(pid_t pid) {
  struct kinfo_proc info;
  return procInfo(pid, &info) ? info.kp_eproc.e_ppid : -1;
}

BOOL BDIsBool(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID(); }
BOOL BDIsNumber(id value) { return [value isKindOfClass:NSNumber.class] && !BDIsBool(value) && isfinite([value doubleValue]); }

NSDictionary *BDPrefRead(NSString *domain, NSString *key) {
  CFStringRef app = (__bridge CFStringRef)domain, name = (__bridge CFStringRef)key;
  // Another process (System Settings, `defaults`) may have written since our last read.
  CFPreferencesAppSynchronize(app);
  id value = CFBridgingRelease(CFPreferencesCopyAppValue(name, app));
  NSNumber *forced = CFPreferencesAppValueIsForced(name, app) ? @YES : @NO;
  if (!value) return @{ @"present": @NO, @"type": @"missing", @"value": NSNull.null, @"forced": forced };
  if (BDIsBool(value)) return @{ @"present": @YES, @"type": @"bool", @"value": value, @"forced": forced };
  if (BDIsNumber(value)) {
    BOOL real = CFNumberIsFloatType((__bridge CFNumberRef)value);
    return @{ @"present": @YES, @"type": real ? @"real" : @"int", @"value": value, @"forced": forced };
  }
  if ([value isKindOfClass:NSString.class] && [value length] <= 4096)
    return @{ @"present": @YES, @"type": @"string", @"value": value, @"forced": forced };
  return @{ @"present": @YES, @"type": @"other", @"value": NSNull.null, @"forced": forced };
}
BOOL BDPrefWrite(NSString *domain, NSString *key, id value) {
  CFStringRef app = (__bridge CFStringRef)domain;
  CFPreferencesSetAppValue((__bridge CFStringRef)key, (__bridge CFPropertyListRef)value, app);
  return CFPreferencesAppSynchronize(app);
}

NSString *BDTeamRequirement(void) {
  SecCodeRef code = NULL;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return nil;
  CFDictionaryRef info = NULL;
  OSStatus status = SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &info);
  CFRelease(code);
  if (status != errSecSuccess || !info) return nil;
  NSDictionary *signing = CFBridgingRelease(info);
  NSString *team = signing[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
  if (![team isKindOfClass:NSString.class] || team.length == 0) return nil;
  return [NSString stringWithFormat:@"anchor apple generic and certificate leaf[subject.OU] = \"%@\"", team];
}
