/**
 * [INPUT]: No external dependence, only accepting appId and lock holder identification
 * [OUTPUT]: Provides MaintenanceGate, Unified Repair acquisire/isLocked/release
 * [POS]: The apps module maintains parallel boundaries, runtime, edit, delete and repair with the same truth source
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
