import * as fs from "fs";
import * as path from "path";

// 文件名中 14 位时间戳：test1_00_20260514171805.jpg
const FILENAME_TIMESTAMP_PATTERN = /(?<timestamp>\d{14})/;
const REOLINK_FILENAME_CHANNEL_PATTERN = /test1_(\d{2})_/i;

export function channelFromUploadFilename(filePath: string): number | null {
  const name = path.basename(filePath);
  const match = name.match(REOLINK_FILENAME_CHANNEL_PATTERN);
  if (!match) {
    return null;
  }
  return parseInt(match[1], 10);
}

export function parseWatchChannels(
  value: number[] | "all" | undefined,
): Set<number> | null {
  if (!value || value === "all") {
    return null;
  }
  return new Set(value);
}


export function formatWatchChannels(channels: Set<number> | null): string {
  if (channels === null) {
    return "ALL";
  }
  return [...channels].sort((a, b) => a - b).join(",");
}



export function uploadMatchesWatchChannels(
  filePath: string,
  channels: Set<number> | null,
  excludedChannels: Set<number> = new Set(),
): boolean {
  const fileChannel = channelFromUploadFilename(filePath);
  if (fileChannel === null || excludedChannels.has(fileChannel)) {
    return false;
  }
  if (channels === null) {
    return true;
  }
  return channels.has(fileChannel);
}


export function formatActiveWatchChannels(
  channels: Set<number> | null,
  excludedChannels: Set<number> = new Set(),
): string {
  if (channels === null) {
    return "ALL";
  }
  if (channels.size === 0) {
    return "";
  }
  return [...channels].sort((a, b) => a - b).join(",");
}


export function isWatchChannelActive(
  channel: number,
  channels: Set<number> | null,
  excludedChannels: Set<number> = new Set(),
): boolean {
  if (excludedChannels.has(channel)) {
    return false;
  }
  if (channels === null) {
    return true;
  }
  return channels.has(channel);
}


export function eventTimeFromFile(filePath: string): Date {
  const stem = path.parse(filePath).name;
  const match = stem.match(FILENAME_TIMESTAMP_PATTERN);
  if (match?.groups?.timestamp) {
    const ts = match.groups.timestamp;
    const year = parseInt(ts.slice(0, 4), 10);
    const month = parseInt(ts.slice(4, 6), 10) - 1;
    const day = parseInt(ts.slice(6, 8), 10);
    const hour = parseInt(ts.slice(8, 10), 10);
    const minute = parseInt(ts.slice(10, 12), 10);
    const second = parseInt(ts.slice(12, 14), 10);

    return new Date(year, month, day, hour, minute, second);
  }

  const stat = fs.statSync(filePath);
  return new Date(stat.mtimeMs);
}


// 格式化本地日期时间 YYYY-MM-DD HH:mm:ss
export function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}


// 为 LLM 提供每张图的序号与参考时间
export function buildFramesTimeline(filePaths: string[]): Array<{
  index: number;
  name: string;
  time_local: string;
}> {
  return filePaths.map((filePath, i) => ({
    index: i + 1,
    name: path.basename(filePath),
    time_local: formatLocalDateTime(eventTimeFromFile(filePath)),
  }));
}


export function imageMimeType(filePath: string): string {
  const suf = path.extname(filePath).toLowerCase();
  if (suf === ".png") {
    return "image/png";
  }
  return "image/jpeg";
}
