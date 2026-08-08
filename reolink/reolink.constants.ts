export const IMAGE_SUFFIXES = new Set([".jpg", ".jpeg", ".png"]);
export const VIDEO_SUFFIXES = new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".h264",
  ".h265",
]);

export const MEDIA_SUFFIXES = IMAGE_SUFFIXES;

// 开启的告警类型（FTP schedule.table 键名）
export const AI_EVENT_SCHEDULE_KEYS = ["AI_PEOPLE", "AI_VEHICLE", "AI_DOG_CAT", "MD"] as const;
export type ReolinkFtpEventType = (typeof AI_EVENT_SCHEDULE_KEYS)[number];
export const DISABLED_SCHEDULE_KEYS = [
  "TIMING",
] as const;

export const DEFAULT_PIC_CAPTURE_MODE = 2;             // 0=清晰(高分辨率),1=标准(中分辨率),2=流畅(低分辨率)
export const DEFAULT_PIC_UPLOAD_INTERVAL_SECONDS = 3;

// 事件聚合
export const DEFAULT_EVENT_GAP_SECONDS = 20;
export const DEFAULT_EVENT_FINALIZE_DELAY_SECONDS = 17;
export const DEFAULT_EVENT_MAX_DURATION_SECONDS = 60;
export const DEFAULT_LLM_SAMPLE_MAX_FRAMES = 5;
export const DEFAULT_POLL_INTERVAL_SECONDS = 0.5;
export const DEFAULT_NVR_CHANNEL_COUNT = 4;

// 本地 FTP Server 配置
export const DEFAULT_FTP_HOST = "0.0.0.0";
export const DEFAULT_FTP_PORT = 2121;
export const DEFAULT_FTP_PASSIVE_MODE = true;
export const DEFAULT_FTP_PASV_MIN = 20000;
export const DEFAULT_FTP_PASV_MAX = 20100;
export const DEFAULT_WATCH_DIR = "reolink/ftp_uploads";
export const DEFAULT_ANALYSIS_DIR = "reolink/analysis";
