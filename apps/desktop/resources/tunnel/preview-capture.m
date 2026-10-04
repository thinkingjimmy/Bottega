/**
 * [INPUT]: One same-user process ID and macOS kernel process metadata.
 * [OUTPUT]: Bounded JSON containing executable, exact argument boundaries and working directory; never environment values.
 * [POS]: Read-only native companion for the preview handoff before Agent process cleanup.
 */
#import <Foundation/Foundation.h>
#include <libproc.h>
#include <sys/sysctl.h>
#include <unistd.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 1;
    char *end = NULL;
    long value = strtol(argv[1], &end, 10);
    if (!end || *end || value <= 1 || value > INT_MAX) return 1;
    int pid = (int)value;
    struct proc_bsdinfo info = {0};
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) || info.pbi_uid != getuid()) return 2;
    struct proc_vnodepathinfo paths = {0};
    char executable[PROC_PIDPATHINFO_MAXSIZE] = {0};
    if (proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &paths, sizeof(paths)) != sizeof(paths) ||
        proc_pidpath(pid, executable, sizeof(executable)) <= 0) return 2;
    size_t size = 262144;
    char *bytes = calloc(1, size);
    if (!bytes) return 2;
    int mib[] = { CTL_KERN, KERN_PROCARGS2, pid };
    if (sysctl(mib, 3, bytes, &size, NULL, 0) || size < sizeof(int)) { free(bytes); return 2; }
    int count = 0; memcpy(&count, bytes, sizeof(count));
    if (count < 1 || count > 128) { free(bytes); return 2; }
    char *cursor = bytes + sizeof(int), *limit = bytes + size;
    while (cursor < limit && *cursor) cursor++;
    while (cursor < limit && !*cursor) cursor++;
    NSMutableArray *arguments = [NSMutableArray array];
    size_t total = 0;
    for (int i = 0; i < count; i++) {
      char *terminator = memchr(cursor, 0, (size_t)(limit - cursor));
      if (!terminator || (total += (size_t)(terminator - cursor)) > 65536) { free(bytes); return 2; }
      NSString *argument = [[NSString alloc] initWithBytes:cursor length:(NSUInteger)(terminator - cursor) encoding:NSUTF8StringEncoding];
      if (!argument) { free(bytes); return 2; }
      [arguments addObject:argument]; cursor = terminator + 1;
    }
    free(bytes);
    NSString *path = [NSString stringWithUTF8String:executable];
    NSString *cwd = [NSString stringWithUTF8String:paths.pvi_cdir.vip_path];
    if (!path || !cwd || ![cwd hasPrefix:@"/"]) return 2;
    arguments[0] = path;
    NSData *json = [NSJSONSerialization dataWithJSONObject:@{ @"argv": arguments, @"cwd": cwd } options:0 error:nil];
    if (!json) return 2;
    return fwrite(json.bytes, 1, json.length, stdout) == json.length ? 0 : 2;
  }
}
