/**
 * [INPUT]: Depends on resolved shortcut bindings and a narrow native registration port.
 * [OUTPUT]: Provides scoped registration, observable conflicts, and exact ownership cleanup.
 * [POS]: Task-panel shortcut lifecycle, independent of panel health and task activity.
 */
import type { PanelBinding } from "../../../../shared/shortcuts/bindings";

export class PanelShortcut {
  private owned: string | null = null;
  private generation = 0;
  private signature = "";
  private failed: string | null = null;
  unavailable = false;
  constructor(private readonly native: { register(key: string, action: () => void): boolean; unregister(key: string): void }, private readonly toggle: () => void) {}
  update(binding: PanelBinding, eligible: boolean, retry = false) {
    const signature = JSON.stringify([binding, eligible]);
    if (!retry && this.signature === signature) return false;
    this.signature = signature;
    const previous = this.unavailable;
    if (this.owned && (!eligible || binding.conflict || this.owned !== binding.accelerator)) this.release();
    this.unavailable = binding.conflict || Boolean(binding.accelerator && this.failed === binding.accelerator);
    if (eligible && binding.accelerator && !binding.conflict && !this.owned) {
      const key = binding.accelerator;
      const generation = ++this.generation;
      try {
        if (this.native.register(key, () => { if (this.owned === key && this.generation === generation) this.toggle(); })) { this.owned = key; this.failed = null; this.unavailable = false; }
        else { this.failed = key; this.unavailable = true; }
      } catch { this.failed = key; this.unavailable = true; }
    }
    return previous !== this.unavailable;
  }
  private release() { const key = this.owned; this.owned = null; this.generation++; if (key) this.native.unregister(key); }
  close() { this.release(); this.signature = ""; this.failed = null; this.unavailable = false; }
}
