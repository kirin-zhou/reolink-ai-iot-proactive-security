import type { ReolinkFtpEventType } from "./reolink.constants";

export type FinalizeReason = "gap" | "max_duration" | "quiet" | "shutdown";

export interface AggregatedEvent {
  frames: string[];
  firstMtime: number;
  lastMtime: number;
}

export interface FrameTimelineEntry {
  index: number;
  name: string;
  time_local: string;
}

export interface ReolinkEventMeta {
  event_id: string;
  channel: number;
  finalize_reason: FinalizeReason;
  first_mtime: number;
  last_mtime: number;
  frame_count: number;
  frames_relative: string[];
  sampled_relative: string[];
  llm_sample_max_frames: number;
  image_count: number;
  frames: FrameTimelineEntry[];
}

export interface ReolinkAnalysisRecord {
  saved_at_local: string;
  event_id: string;
  channel: number;
  finalize_reason: FinalizeReason;
  request_event_meta: ReolinkEventMeta;
  analysis?: unknown;
  rawContent?: string;
  model?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: number;
    currency: string;
  };
  error?: string;
}

export interface PipelineAggregationConfig {
  gapSeconds: number;
  finalizeDelaySeconds: number;
  maxDurationSeconds: number;
}

export interface PipelineSamplingConfig {
  maxFrames: number;
}

export interface PipelineFtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  pasvUrl: string;
  pasvMin: number;
  pasvMax: number;
}

export interface PipelineConfig {
  watchDir: string;
  analysisDir: string;
  channels: number[] | "all";
  nvrChannelCount: number;
  ftp: PipelineFtpConfig;
  aggregation: PipelineAggregationConfig;
  sampling: PipelineSamplingConfig;
  analysisEnabled: boolean;
  pollIntervalSeconds: number;
  processExisting: boolean;
}

export interface PipelineStatus {
  running: boolean;
  state: "STOPPED" | "ARMED" | "MONITORING";
  startedAt?: string;
  watchDir?: string;
  analysisDir?: string;
  channels?: string;
  stoppedChannels?: number[];
  ftp?: {
    host: string;
    port: number;
    listening: boolean;
  };
  stats: {
    uploadsReceived: number;
    eventsFinalized: number;
    analysesCompleted: number;
    analysesFailed: number;
  };
}

export interface DeviceFtpServerConfig {
  address: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string;
}

export interface ChannelFtpEventConfig {
  channel: number;
  events: ReolinkFtpEventType[];
}

export type DeviceFtpEnableFlags =
  | "preserve"
  | { enable: number; scheduleEnable: number };

export interface ConfigureDeviceFtpOptions {
  host: string;
  username: string;
  password: string;
  channels: number[] | "all";
  nvrChannelCount: number;
  events?: ReolinkFtpEventType[];
  channelConfigs?: ChannelFtpEventConfig[];
  ftpServer: DeviceFtpServerConfig;
  passiveMode: boolean;
  onlyFtps: boolean;
  testAfterSet: boolean;
  enableFlags?: DeviceFtpEnableFlags;
}

export interface DisableDeviceFtpOptions {
  host: string;
  username: string;
  password: string;
  channels: number[] | "all";
  nvrChannelCount: number;
  clearGlobalEnable?: boolean;
}

export interface DeviceFtpChannelStatus {
  channel: number;
  monitoring: boolean;
  enable: number;
  scheduleEnable: number;
  ftp: Record<string, unknown>;
}
