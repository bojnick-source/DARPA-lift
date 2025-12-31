// ==========================================
// HAPTICS CORE API — A246 (HARDENED)
// FILE: uiux/advanced/haptics/haptics.ts
// Event-driven haptic cues. Safe no-op fallback.
// NOTE: iOS Safari supports vibration only on some devices; this keeps it optional.
// ==========================================

export type HapticKind =
  | "tap"
  | "success"
  | "warning"
  | "critical"
  | "selection"
  | "confirm"
  | "reject";

export interface HapticPattern {
  // WebVibration-compatible pattern (ms). Example: [20, 30, 20]
  pattern: number[];
}

export interface HapticsDriver {
  supported: () => boolean;
  play: (p: HapticPattern) => void;
}

export interface HapticsPolicy {
  enabled: boolean;
  // optional: reduce intensity patterns
  lowPower?: boolean;
}

const PATTERNS: Record<HapticKind, HapticPattern> = {
  tap: { pattern: [10] },
  selection: { pattern: [8] },
  confirm: { pattern: [12, 18, 12] },

  success: { pattern: [10, 20, 20] },
  warning: { pattern: [20, 25, 20] },
  critical: { pattern: [30, 30, 30] },

  reject: { pattern: [25, 15, 25, 15, 25] },
};

export function createWebVibrationDriver(): HapticsDriver {
  return {
    supported: () => typeof navigator !== "undefined" && typeof (navigator as any).vibrate === "function",
    play: (p: HapticPattern) => {
      const vib = (navigator as any).vibrate;
      if (typeof vib === "function") vib(p.pattern);
    },
  };
}

// No-op driver for safety
export function createNoopDriver(): HapticsDriver {
  return {
    supported: () => false,
    play: () => {},
  };
}

export class Haptics {
  private driver: HapticsDriver;
  private policy: HapticsPolicy;

  constructor(opts?: { driver?: HapticsDriver; policy?: HapticsPolicy }) {
    this.driver = opts?.driver ?? createWebVibrationDriver();
    this.policy = opts?.policy ?? { enabled: true };
  }

  setPolicy(p: Partial<HapticsPolicy>) {
    this.policy = { ...this.policy, ...p };
  }

  supported() {
    return this.driver.supported();
  }

  cue(kind: HapticKind) {
    if (!this.policy.enabled) return;

    const base = PATTERNS[kind] ?? PATTERNS.tap;
    const pat = this.policy.lowPower ? lowPower(base) : base;

    // Always safe: driver may no-op
    this.driver.play(pat);
  }
}

function lowPower(p: HapticPattern): HapticPattern {
  // reduce pattern durations deterministically
  return { pattern: p.pattern.map((x) => Math.max(5, Math.floor(x * 0.6))) };
}
