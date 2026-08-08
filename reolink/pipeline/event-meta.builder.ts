import * as crypto from "crypto";
import * as path from "path";
import { AggregatedEvent, FinalizeReason, ReolinkEventMeta } from "../reolink.types";
import { buildFramesTimeline } from "./reolink-filename.utils";
import { sampleEventFrames } from "./event-sampler";

// 生成事件 ID：event_YYYYMMDD_HHMMSS_{8位随机}
export function buildEventId(lastMtime: number): string {
  const dt = new Date(lastMtime * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}_` +
    `${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
  return `event_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
}

function dedupeFrames(frames: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const frame of frames) {
    if (!seen.has(frame)) {
      seen.add(frame);
      unique.push(frame);
    }
  }
  return unique;
}

export function buildEventMeta(params: {
  event: AggregatedEvent;
  reason: FinalizeReason;
  channel: number;
  watchDir: string;
  maxSamples: number;
}): { eventMeta: ReolinkEventMeta; sampled: string[] } {
  const { event, reason, channel, watchDir, maxSamples } = params;
  const frames = dedupeFrames(event.frames);
  const sampled = sampleEventFrames(frames, maxSamples);
  const eventId = buildEventId(event.lastMtime);

  const toRelative = (p: string) => {
    try {
      return path.relative(watchDir, p);
    } catch {
      return p;
    }
  };

  const eventMeta: ReolinkEventMeta = {
    event_id: eventId,
    channel,
    finalize_reason: reason,
    first_mtime: event.firstMtime,
    last_mtime: event.lastMtime,
    frame_count: frames.length,
    frames_relative: frames.map(toRelative),
    sampled_relative: sampled.map(toRelative),
    llm_sample_max_frames: maxSamples,
    image_count: sampled.length,
    frames: buildFramesTimeline(sampled),
  };

  return { eventMeta, sampled };
}
