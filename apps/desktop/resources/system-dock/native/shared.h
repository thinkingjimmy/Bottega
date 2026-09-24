/**
 * [INPUT]: Depends on Foundation, CoreFoundation preferences, and the Security code-signing API.
 * [OUTPUT]: Declares the XPC recovery protocol, process start-time identity, typed preference read/write, and same-team signing requirement shared by both executables.
 * [POS]: system-dock/native common header; bridge.m and recovery-agent.m must agree on these byte-level facts or ownership proofs break.
 */

#import <Foundation/Foundation.h>

/** One method keeps the Mach surface tiny; the payload and reply are the JSON documents in protocol.ts. */
@protocol BDRecoveryService
- (void)call:(NSString *)method payload:(NSString *)json reply:(void (^)(NSString *reply))reply;
@end

#define BD_DOCK_DOMAIN @"com.apple.dock"

/** Start time in ms since epoch from kp_proc.p_starttime, or -1 when the pid does not exist; main stores it as owner.startedAt. */
int64_t BDProcessStartMs(pid_t pid);
/** Parent pid of a live process, or -1. */
pid_t BDParentPid(pid_t pid);
/** {present,type,value,forced} exactly as prefValueSchema; reads the effective value after a synchronize. */
NSDictionary *BDPrefRead(NSString *domain, NSString *key);
/** Sets (value non-nil) or deletes (nil) in CurrentUser/AnyHost, then synchronizes; NO when cfprefsd refused. */
BOOL BDPrefWrite(NSString *domain, NSString *key, id value);
/** CFBoolean-backed NSNumber, which JSON decoding produces for true/false. */
BOOL BDIsBool(id value);
/** Finite JSON number that is not a boolean. */
BOOL BDIsNumber(id value);
/** "anchor apple generic and certificate leaf[subject.OU] = TEAM" when this binary carries a Team ID, else nil (ad-hoc dev builds). */
NSString *BDTeamRequirement(void);
