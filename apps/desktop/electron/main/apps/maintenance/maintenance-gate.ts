/**
 * [INPUT]: No external dependencies; accepts only an appId and a lock-holder identifier
 * [OUTPUT]: Provides MaintenanceGate: acquire/isLocked/release
 * [POS]: apps module's maintenance mutex; runtime start, edit rebuild, delete, and repair all read the same truth about whether an App is under maintenance
 */

export class MaintenanceGate {
  private readonly owners = new Map<string, string>();

  acquire(appId: string, owner: string) {
    if (this.owners.has(appId)) throw new Error("App 修复中");
    this.owners.set(appId, owner);
  }

  isLocked(appId: string) {
    return this.owners.has(appId);
  }

  release(appId: string, owner?: string) {
    if (owner && this.owners.get(appId) !== owner) return false;
    return this.owners.delete(appId);
  }
}
