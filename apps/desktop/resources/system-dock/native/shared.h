/**
 * [INPUT]: Depends on Foundation, AppKit process discovery, CoreFoundation preferences, and the Security code-signing API.
 * [OUTPUT]: Declares the XPC recovery protocol, process start-time identity, typed preference read/write, bounded Dock restart verification, and fail-closed same-team helper signing requirements shared by both executables.
 * [POS]: system-dock/native common header; bridge.m and recovery-agent.m must agree on these byte-level facts or ownership proofs break.
 */

#import <Foundation/Foundation.h>

/** One method keeps the Mach surface tiny; the payload and reply are the JSON documents in protocol.ts. */
@protocol BDRecoveryService
- (void)call:(NSString *)method payload:(NSString *)json reply:(void (^)(NSString *reply))reply;
@end

#define BD_DOCK_DOMAIN @"com.apple.dock"
#define BD_BRIDGE_IDENTIFIER @"system-dock-bridge"
#define BD_RECOVERY_IDENTIFIER @"bottega-dock-recovery"

/** Start time in ms since epoch from kp_proc.p_starttime, or -1 when the pid does not exist; main stores it as owner.startedAt. */
int64_t BDProcessStartMs(pid_t pid);
/** Parent pid of a live process, or -1. */
pid_t BDParentPid(pid_t pid);
/** {present,type,value,forced} exactly as prefValueSchema; reads the effective value after a synchronize. */
NSDictionary *BDPrefRead(NSString *domain, NSString *key);
/** Sets (value non-nil) or deletes (nil) in CurrentUser/AnyHost, then synchronizes; NO when cfprefsd refused. */
BOOL BDPrefWrite(NSString *domain, NSString *key, id value);
/** On a background queue, waits at most four seconds for the old Dock processes to exit and a new live Dock to appear. */
BOOL BDReloadDock(void);
/** CFBoolean-backed NSNumber, which JSON decoding produces for true/false. */
BOOL BDIsBool(id value);
/** Finite JSON number that is not a boolean. */
BOOL BDIsNumber(id value);
/** Same-team requirement only after validating this code and its Team ID; nil means authentication must be refused. */
NSString *BDTeamRequirement(void);
/** Adds one of the two fixed helper identifiers to the validated same-team requirement, or returns nil. */
NSString *BDPeerRequirement(NSString *identifier);
