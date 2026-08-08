import * as fs from "fs";
import { AggregatedEvent, FinalizeReason } from "../reolink.types";

interface PendingFrame {
  path: string;
  mtime: number;
}

export type EventFinalizedHandler = (
  event: AggregatedEvent,
  reason: FinalizeReason,
) => void;


export class EventAggregator {
  private readonly pending: PendingFrame[] = [];
  private lastMtime: number | null = null;

  constructor(
    private readonly gapSeconds: number,
    private readonly finalizeDelaySeconds: number,
    private readonly maxDurationSeconds: number,
    private readonly onFinalized: EventFinalizedHandler | null = null,
  ) {}

  addImage(filePath: string, mtime?: number): void {
    const mt = mtime ?? fs.statSync(filePath).mtimeMs / 1000;

    if (
      this.lastMtime !== null &&
      mt - this.lastMtime > this.gapSeconds
    ) {
      this.finalize("gap");
    }

    if (
      this.maxDurationSeconds > 0 &&
      this.pending.length > 0 &&
      mt - Math.min(...this.pending.map((f) => f.mtime)) >
        this.maxDurationSeconds
    ) {
      this.finalize("max_duration");
    }

    if (this.pending.some((f) => f.path === filePath)) {
      return;
    }

    this.pending.push({ path: filePath, mtime: mt });
    this.lastMtime = mt;
  }

  pollFinalize(now?: number): void {
    const current = now ?? Date.now() / 1000;
    if (!this.pending.length || this.lastMtime === null) {
      return;
    }
    if (current - this.lastMtime >= this.finalizeDelaySeconds) {
      this.finalize("quiet");
    }
  }

  flush(): void {
    if (this.pending.length) {
      this.finalize("shutdown");
    }
  }

  private finalize(reason: FinalizeReason): void {
    if (!this.pending.length) {
      this.lastMtime = null;
      return;
    }

    const frames = this.pending.map((f) => f.path);
    const firstMtime = Math.min(...this.pending.map((f) => f.mtime));
    const lastMtime = Math.max(...this.pending.map((f) => f.mtime));

    const event: AggregatedEvent = {
      frames,
      firstMtime,
      lastMtime,
    };

    this.pending.length = 0;
    this.lastMtime = null;

    if (this.onFinalized) {
      this.onFinalized(event, reason);
    }
  }
}
