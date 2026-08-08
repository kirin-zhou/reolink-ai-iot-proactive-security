import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import * as path from "path";
import {
  DEFAULT_ANALYSIS_DIR,
  DEFAULT_EVENT_FINALIZE_DELAY_SECONDS,
  DEFAULT_EVENT_GAP_SECONDS,
  DEFAULT_EVENT_MAX_DURATION_SECONDS,
  DEFAULT_FTP_HOST,
  DEFAULT_FTP_PASSWORD,
  DEFAULT_FTP_PASSIVE_MODE,
  DEFAULT_FTP_PASV_MAX,
  DEFAULT_FTP_PASV_MIN,
  DEFAULT_FTP_PORT,
  DEFAULT_FTP_USERNAME,
  DEFAULT_LLM_SAMPLE_MAX_FRAMES,
  DEFAULT_NVR_CHANNEL_COUNT,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEFAULT_WATCH_DIR,
  type ReolinkFtpEventType,
} from "../reolink.constants";
import { ReolinkDeviceClient } from "../device/reolink-device.client";
import { ReolinkFtpReceiverService } from "../ftp/reolink-ftp-receiver.service";
import { parseWatchChannels, formatActiveWatchChannels, isWatchChannelActive } from "../pipeline/reolink-filename.utils";
import { ReolinkEventPipelineService } from "../pipeline/reolink-event-pipeline.service";
import { resolveFtpPasvUrl } from "../ftp/reolink-ftp-pasv.util";
import {
  ChannelFtpEventConfig,
  ConfigureDeviceFtpOptions,
  DeviceFtpEnableFlags,
  DisableDeviceFtpOptions,
  PipelineConfig,
  PipelineStatus,
  ReolinkAnalysisRecord,
} from "../reolink.types";

type PipelineDeviceCredentials = {
  host: string;
  username: string;
  password: string;
};

// NVR 设备 FTP 配置（pipeline start/add 共用）
export interface PipelineDeviceFtpInput {
  host: string;
  username: string;
  password: string;
  ftpServer: {
    address: string;
    port: number;
    username: string;
    password: string;
    remoteDir?: string;
  };
  events?: ReolinkFtpEventType[];
  channelConfigs?: ChannelFtpEventConfig[];
  passiveMode?: boolean;
  onlyFtps?: boolean;
  nvrChannelCount?: number;
}

// POST /reolink/control/pipeline/channels/delete 请求体
export interface DeletePipelineChannelsInput {
  device: {
    host: string;
    username: string;
    password: string;
  };
  channels?: number[];
  nvrChannelCount?: number;
}

// POST /reolink/control/pipeline/channels/delete 响应体
export interface DeletePipelineChannelsResult extends PipelineStatus {
  stoppedChannels?: number[];
  stoppedAll?: boolean;
  deviceFtpDisabled?: {
    channels: unknown[];
    message: string;
  };
}

// POST /reolink/control/pipeline/stop 请求体
export interface StopPipelineInput {
  device: PipelineDeviceCredentials;
  nvrChannelCount?: number;
}

// POST /reolink/control/pipeline/stop 响应体
export interface StopPipelineResult extends PipelineStatus {
  stoppedAll: true;
  deviceFtpDisabled: {
    channels: unknown[];
    message: string;
  };
}


// POST /reolink/control/pipeline/channels/add 请求体
export interface AddPipelineChannelsInput {
  device: {
    host: string;
    username: string;
    password: string;
  };
  channels: number[];
  events?: ReolinkFtpEventType[];
  channelConfigs?: ChannelFtpEventConfig[];
  onlyFtps?: boolean;
  nvrChannelCount?: number;
}

// POST /reolink/control/pipeline/channels/add 响应体
export interface AddPipelineChannelsResult extends PipelineStatus {
  addedChannels: number[];
  deviceFtpEnabled?: {
    channels: unknown[];
    message: string;
  };
}


// POST /reolink/control/pipeline/start 请求体
export interface StartPipelineInput {
  watchDir?: string;
  analysisDir?: string;
  channels?: number[] | "all";
  device?: {
    host: string;
    username: string;
    password: string;
  };
  events?: ReolinkFtpEventType[];
  channelConfigs?: ChannelFtpEventConfig[];
  onlyFtps?: boolean;
  nvrChannelCount?: number;
  ftp: {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    pasvUrl?: string;
  };
}

// POST /reolink/control/pipeline/start 响应体
export interface StartPipelineResult extends PipelineStatus {
  deviceFtpEnabled?: {
    channels: unknown[];
    message: string;
  };
}


// Reolink 控制编排层：设备 FTP 配置 / FTP 接收 / 事件管道
@Injectable()
export class ReolinkControlService implements OnModuleDestroy {
  private pipelineConfig: PipelineConfig | null = null;
  private startedAt: string | null = null;
  private watchChannels: Set<number> | null = null;
  private excludedWatchChannels = new Set<number>();
  private stoppedChannels: number[] = [];
  private pipelineDevice: PipelineDeviceCredentials | null = null;
  private shuttingDown = false;

  constructor(
    private readonly deviceClient: ReolinkDeviceClient,
    private readonly ftpReceiver: ReolinkFtpReceiverService,
    private readonly eventPipeline: ReolinkEventPipelineService,
    @InjectPinoLogger(ReolinkControlService.name)
    private readonly logger: PinoLogger,
  ) {}


  // AI 模块关闭(Ctrl+C/SIGTERM)时，停止全部通道，清零 NVR FTP enable/scheduleEnable
  async onModuleDestroy(): Promise<void> {
    await this.stopPipelineOnShutdown("onModuleDestroy");
  }

  private async stopPipelineOnShutdown(reason: string): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    const hasLocalPipeline =
      this.ftpReceiver.isRunning() || this.pipelineConfig !== null;
    if (!hasLocalPipeline && !this.pipelineDevice) {
      return;
    }

    this.logger.info(
      { reason },
      "AI module shutting down: auto stop Reolink pipeline and clear NVR FTP",
    );

    try {
      if (this.pipelineDevice) {
        await this.disableDeviceFtp({
          ...this.pipelineDevice,
          channels: "all",
          nvrChannelCount:
            this.pipelineConfig?.nvrChannelCount ?? DEFAULT_NVR_CHANNEL_COUNT,
          clearGlobalEnable: true,
        });
        this.logger.info(
          "NVR FTP cleared on shutdown (enable=0, scheduleEnable=0)",
        );
      } else if (hasLocalPipeline) {
        this.logger.warn(
          "NVR FTP not cleared on shutdown (no stored device credentials from pipeline/start)",
        );
      }
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "Failed to clear NVR FTP on shutdown",
      );
    } finally {
      if (hasLocalPipeline) {
        await this.stopAllPipeline();
      }
    }
  }

  // 配置 NVR/摄像头 FTP 上传目标与事件表（不修改 enable / scheduleEnable）
  async configureDeviceFtp(
    options: ConfigureDeviceFtpOptions,
  ): Promise<{ channels: unknown[]; message: string }> {
    const results = await this.deviceClient.configureDeviceFtp({
      ...options,
      enableFlags: options.enableFlags ?? "preserve",
    });
    return {
      channels: results,
      message: `FTP 配置完成: ${options.ftpServer.address}:${options.ftpServer.port}`,
    };
  }

  // 关闭 NVR 指定通道 FTP 上传
  async disableDeviceFtp(
    options: DisableDeviceFtpOptions,
  ): Promise<{ channels: unknown[]; message: string }> {
    const results = await this.deviceClient.disableDeviceFtp(options);
    const channelDesc =
      options.channels === "all"
        ? "全部"
        : [...options.channels].sort((a, b) => a - b).join(",");
    return {
      channels: results,
      message:
        options.clearGlobalEnable === false
          ? `FTP 通道计划已关闭（保留总开关）: channel ${channelDesc}`
          : `FTP 已关闭: channel ${channelDesc}`,
    };
  }

  // 获取指定通道 FTP 配置
  async getDeviceFtpConfig(
    host: string,
    username: string,
    password: string,
    channel: number,
  ): Promise<Record<string, unknown>> {
    return this.deviceClient.getDeviceFtpConfig(
      { host, username, password },
      channel,
    );
  }

  // 测试指定通道 FTP 连接
  async testDeviceFtp(
    host: string,
    username: string,
    password: string,
    channel: number,
  ): Promise<{ message: string }> {
    await this.deviceClient.testDeviceFtp(
      { host, username, password },
      channel,
    );
    return { message: "TestFtp succeeded" };
  }


  // 启动 FTP 监听 + 事件聚合 + LLM 分析管道
  async startPipeline(input: StartPipelineInput): Promise<StartPipelineResult> {
    if (this.ftpReceiver.isRunning()) {
      throw new Error("Pipeline is already running");
    }

    const nvrChannelCount =
      input.nvrChannelCount ?? DEFAULT_NVR_CHANNEL_COUNT;
    const watchChannels = input.channels ?? "all";
    const config = this.buildPipelineConfig(input, nvrChannelCount, watchChannels);
    const startsArmed = Array.isArray(watchChannels) && watchChannels.length === 0;

    if (startsArmed && !input.device) {
      throw new Error(
        "device is required when channels is empty so NVR FTP can enter ARMED state",
      );
    }

    let deviceFtpEnabled:
      | { channels: unknown[]; message: string }
      | undefined;
    if (input.device) {
      // 缓存凭证
      this.pipelineDevice = {
        host: input.device.host,
        username: input.device.username,
        password: input.device.password,
      };
      try {
        const deviceFtpInput = this.buildDeviceFtpInput(
          input.device,
          config.ftp,
          {
            events: input.events,
            channelConfigs: input.channelConfigs,
            onlyFtps: input.onlyFtps,
            passiveMode: DEFAULT_FTP_PASSIVE_MODE,
          },
        );
        deviceFtpEnabled = await this.enableDeviceFtpForChannels(
          startsArmed
            ? {
                ...deviceFtpInput,
                events: undefined,
                channelConfigs: undefined,
              }
            : deviceFtpInput,
          startsArmed ? "all" : watchChannels,
          nvrChannelCount,
          {
            enable: 1,
            scheduleEnable: startsArmed ? 0 : 1,
          },
          { requireEventConfig: !startsArmed },
        );
      } catch (e) {
        this.pipelineDevice = null;
        throw e;
      }
    } else {
      this.pipelineDevice = null;
    }

    this.pipelineConfig = config;
    this.startedAt = new Date().toISOString();

    this.eventPipeline.start(config);

    const parsedWatchChannels = parseWatchChannels(config.channels);
    this.watchChannels = parsedWatchChannels;
    this.excludedWatchChannels = new Set();
    this.stoppedChannels = [];

    try {
      await this.ftpReceiver.start({
        watchDir: config.watchDir,
        ftp: config.ftp,
        channels: parsedWatchChannels,
        pollIntervalSeconds: config.pollIntervalSeconds,
        processExisting: config.processExisting,
        onUpload: (upload) => {
          this.eventPipeline.handleUpload(upload);
        },
      });
    } catch (e) {
      this.eventPipeline.stop();
      this.pipelineConfig = null;
      this.startedAt = null;
      this.watchChannels = null;
      this.excludedWatchChannels.clear();
      this.stoppedChannels = [];
      if (this.pipelineDevice) {
        try {
          await this.disableDeviceFtp({
            host: this.pipelineDevice.host,
            username: this.pipelineDevice.username,
            password: this.pipelineDevice.password,
            channels: "all",
            nvrChannelCount,
            clearGlobalEnable: true,
          });
        } catch (disableErr) {
          this.logger.warn(
            {
              err:
                disableErr instanceof Error
                  ? disableErr.message
                  : String(disableErr),
            },
            "Failed to roll back NVR FTP after local pipeline start failure",
          );
          // 保留 pipelineDevice，进程退出时再清一次
          throw e;
        }
        this.pipelineDevice = null;
      }
      throw e;
    }

    this.logger.info(
      {
        watchDir: config.watchDir,
        channels: formatActiveWatchChannels(
          this.watchChannels,
          this.excludedWatchChannels,
        ),
        ftpPort: config.ftp.port,
      },
      "Reolink pipeline started",
    );

    return {
      ...this.getStatus(),
      deviceFtpEnabled,
    };
  }


  // 完全停止管道：关闭 NVR FTP 总开关、所有通道计划、FTP Server
  async stopPipeline(input: StopPipelineInput): Promise<StopPipelineResult> {
    const hasLocalPipeline =
      this.ftpReceiver.isRunning() || this.pipelineConfig !== null;
    if (!hasLocalPipeline) {
      throw new Error("Pipeline is not running");
    }

    const nvrChannelCount =
      input.nvrChannelCount ??
      this.pipelineConfig?.nvrChannelCount ??
      DEFAULT_NVR_CHANNEL_COUNT;

    this.pipelineDevice = { ...input.device };

    let deviceFtpDisabled:
      | { channels: unknown[]; message: string }
      | undefined;
    try {
      deviceFtpDisabled = await this.disableDeviceFtp({
        ...input.device,
        channels: "all",
        nvrChannelCount,
        clearGlobalEnable: true,
      });
    } finally {
      await this.stopAllPipeline();
    }

    return {
      ...this.getStatus(),
      stoppedAll: true,
      deviceFtpDisabled,
    };
  }


  // 关闭全部或指定通道；保留 FTP 总开关 enable 和 FTP Server
  async deletePipelineChannels(
    input: DeletePipelineChannelsInput,
  ): Promise<DeletePipelineChannelsResult> {
    if (!this.ftpReceiver.isRunning()) {
      throw new Error("Pipeline is not running");
    }

    // 解析要关闭哪些通道
    const requested = input.channels?.length
      ? [...new Set(input.channels)].sort((a, b) => a - b)
      : null;
    const nvrChannelCount =
      input.nvrChannelCount ??
      this.pipelineConfig?.nvrChannelCount ??
      DEFAULT_NVR_CHANNEL_COUNT;

    const deviceFtpDisabled = await this.disableDeviceFtp({
      host: input.device.host,
      username: input.device.username,
      password: input.device.password,
      channels: requested ?? "all",
      nvrChannelCount,
      clearGlobalEnable: false,
    });

    this.pipelineDevice = {
      host: input.device.host,
      username: input.device.username,
      password: input.device.password,
    };

    const result = requested
      ? await this.stopPipelineChannels(requested)
      : await this.pauseAllPipelineChannels(nvrChannelCount);

    result.deviceFtpDisabled = deviceFtpDisabled;
    return result;
  }

  // 管道运行中追加监听通道
  async addPipelineChannels(
    input: AddPipelineChannelsInput,
  ): Promise<AddPipelineChannelsResult> {
    if (!this.ftpReceiver.isRunning()) {
      throw new Error("Pipeline is not running");
    }

    this.assertFtpEventConfig(input);

    const requested = [...new Set(input.channels)].sort((a, b) => a - b);
    if (!requested.length) {
      throw new Error("channels is required");
    }

    for (const channel of requested) {
      if (
        isWatchChannelActive(
          channel,
          this.watchChannels,
          this.excludedWatchChannels,
        )
      ) {
        throw new Error(`Channel ${channel} is already being monitored`);
      }
    }

    const nvrChannelCount =
      input.nvrChannelCount ??
      this.pipelineConfig?.nvrChannelCount ??
      DEFAULT_NVR_CHANNEL_COUNT;

    const pipelineFtp = this.pipelineConfig?.ftp;
    if (!pipelineFtp) {
      throw new Error("Pipeline FTP config is not available");
    }

    this.pipelineDevice = {
      host: input.device.host,
      username: input.device.username,
      password: input.device.password,
    };

    const deviceFtpEnabled = await this.enableDeviceFtpForChannels(
      this.buildDeviceFtpInput(input.device, pipelineFtp, {
        events: input.events,
        channelConfigs: input.channelConfigs,
        onlyFtps: input.onlyFtps,
        passiveMode: DEFAULT_FTP_PASSIVE_MODE,
      }),
      requested,
      nvrChannelCount,
      { enable: 1, scheduleEnable: 1 },
      { requireEventConfig: true },
    );

    const added: number[] = [];
    for (const channel of requested) {
      this.excludedWatchChannels.delete(channel);
      if (this.watchChannels !== null) {
        this.watchChannels.add(channel);
      }
      added.push(channel);
    }

    this.stoppedChannels = this.stoppedChannels.filter(
      (ch) => !added.includes(ch),
    );
    this.eventPipeline.startChannels(added);
    this.ftpReceiver.updateWatchChannels(
      this.watchChannels,
      this.excludedWatchChannels,
    );
    this.syncPipelineConfigChannels();

    this.logger.info({ channels: added }, "Reolink pipeline channels added");

    return {
      ...this.getStatus(),
      addedChannels: added,
      deviceFtpEnabled,
    };
  }

  private async stopPipelineChannels(
    requested: number[],
  ): Promise<DeletePipelineChannelsResult> {
    const stopped: number[] = [];
    for (const channel of requested) {
      if (
        !isWatchChannelActive(
          channel,
          this.watchChannels,
          this.excludedWatchChannels,
        )
      ) {
        continue;
      }

      if (this.watchChannels === null) {
        this.excludedWatchChannels.add(channel);
      } else {
        this.watchChannels.delete(channel);
      }
      stopped.push(channel);
    }

    if (!stopped.length) {
      return {
        ...this.getStatus(),
        stoppedAll: !this.eventPipeline.hasActiveChannels(
          this.watchChannels,
          this.excludedWatchChannels,
        ),
      };
    }

    this.stoppedChannels = [
      ...new Set([...this.stoppedChannels, ...stopped]),
    ].sort((a, b) => a - b);
    this.materializeWatchChannelsIfNeeded();

    this.eventPipeline.stopChannels(stopped);
    this.ftpReceiver.updateWatchChannels(
      this.watchChannels,
      this.excludedWatchChannels,
    );
    this.syncPipelineConfigChannels();

    this.logger.info({ channels: stopped }, "Reolink pipeline channels stopped");

    return {
      ...this.getStatus(),
      stoppedAll: !this.eventPipeline.hasActiveChannels(
        this.watchChannels,
        this.excludedWatchChannels,
      ),
    };
  }

  // 暂停全部通道并进入待机 ARMED
  private async pauseAllPipelineChannels(
    nvrChannelCount: number,
  ): Promise<DeletePipelineChannelsResult> {
    const allChannels = Array.from(
      { length: nvrChannelCount },
      (_, channel) => channel,
    );

    this.eventPipeline.stopChannels(allChannels);
    this.watchChannels = new Set();
    this.excludedWatchChannels.clear();
    this.stoppedChannels = allChannels;
    this.ftpReceiver.updateWatchChannels(
      this.watchChannels,
      this.excludedWatchChannels,
    );
    this.syncPipelineConfigChannels();

    this.logger.info("All Reolink pipeline channels paused; FTP remains armed");

    return {
      ...this.getStatus(),
      stoppedAll: true,
      stoppedChannels: allChannels,
    };
  }

  // 停止所有管道
  private async stopAllPipeline(): Promise<DeletePipelineChannelsResult> {
    this.eventPipeline.stop();
    await this.ftpReceiver.stop();
    this.pipelineConfig = null;
    this.startedAt = null;
    this.watchChannels = null;
    this.excludedWatchChannels.clear();
    this.stoppedChannels = [];
    this.pipelineDevice = null;
    this.logger.info("Reolink pipeline stopped");
    return {
      ...this.getStatus(),
      stoppedAll: true,
    };
  }


  // 获取管道状态
  getStatus(): PipelineStatus {
    const running = this.ftpReceiver.isRunning();
    const config = this.pipelineConfig;
    const hasActiveChannels =
      running &&
      this.eventPipeline.hasActiveChannels(
        this.watchChannels,
        this.excludedWatchChannels,
      );

    return {
      running,
      state: !running ? "STOPPED" : hasActiveChannels ? "MONITORING" : "ARMED",
      startedAt: this.startedAt ?? undefined,
      watchDir: config?.watchDir,
      analysisDir: config?.analysisDir,
      channels: config
        ? formatActiveWatchChannels(
            this.watchChannels,
            this.excludedWatchChannels,
          )
        : undefined,
      stoppedChannels: this.stoppedChannels.length
        ? [...this.stoppedChannels]
        : undefined,
      ftp: config
        ? {
            host: config.ftp.host,
            port: config.ftp.port,
            listening: running,
          }
        : undefined,
      stats: this.eventPipeline.getStats(),
    };
  }


  // 获取事件列表
  listEvents(limit = 50): ReolinkAnalysisRecord[] {
    return this.eventPipeline.listEvents(limit);
  }

  // 获取事件详情
  getEvent(eventId: string): ReolinkAnalysisRecord | undefined {
    return this.eventPipeline.getEvent(eventId);
  }

  // 同步管道配置通道
  private syncPipelineConfigChannels(): void {
    if (!this.pipelineConfig) {
      return;
    }
    if (this.watchChannels === null) {
      this.pipelineConfig.channels = "all";
      return;
    }
    this.pipelineConfig.channels = [...this.watchChannels].sort((a, b) => a - b);
  }

  private assertFtpEventConfig(input: {
    events?: ReolinkFtpEventType[];
    channelConfigs?: ChannelFtpEventConfig[];
  }): void {
    if (!input.events?.length && !input.channelConfigs?.length) {
      throw new Error("events or channelConfigs is required");
    }
  }

  // 构建设备 FTP 配置
  private buildDeviceFtpInput(
    device: { host: string; username: string; password: string },
    ftp: {
      pasvUrl: string;
      port: number;
      username: string;
      password: string;
    },
    options: {
      events?: ReolinkFtpEventType[];
      channelConfigs?: ChannelFtpEventConfig[];
      passiveMode?: boolean;
      onlyFtps?: boolean;
    },
  ): PipelineDeviceFtpInput {
    return {
      host: device.host,
      username: device.username,
      password: device.password,
      ftpServer: {
        address: ftp.pasvUrl,
        port: ftp.port,
        username: ftp.username,
        password: ftp.password,
        remoteDir: "/",
      },
      events: options.events,
      channelConfigs: options.channelConfigs,
      passiveMode: options.passiveMode,
      onlyFtps: options.onlyFtps,
    };
  }

  private buildConfigureDeviceFtpOptions(
    input: PipelineDeviceFtpInput,
    channels: number[] | "all",
    nvrChannelCount: number,
    enableFlags: DeviceFtpEnableFlags,
  ): ConfigureDeviceFtpOptions {
    const channelConfigs = input.channelConfigs?.length
      ? this.filterChannelConfigsForTargets(channels, input.channelConfigs)
      : undefined;

    return {
      host: input.host,
      username: input.username,
      password: input.password,
      channels,
      nvrChannelCount,
      events: channelConfigs ? undefined : input.events,
      channelConfigs,
      ftpServer: {
        address: input.ftpServer.address,
        port: input.ftpServer.port,
        username: input.ftpServer.username,
        password: input.ftpServer.password,
        remoteDir: input.ftpServer.remoteDir ?? "/",
      },
      passiveMode: input.passiveMode ?? DEFAULT_FTP_PASSIVE_MODE,
      onlyFtps: input.onlyFtps ?? false,
      testAfterSet: false,
      enableFlags,
    };
  }

  private filterChannelConfigsForTargets(
    channels: number[] | "all",
    channelConfigs: ChannelFtpEventConfig[],
  ): ChannelFtpEventConfig[] {
    const filtered =
      channels === "all"
        ? [...channelConfigs]
        : channelConfigs.filter((item) => channels.includes(item.channel));

    if (!filtered.length) {
      throw new Error(
        "channelConfigs has no entries matching the requested channels",
      );
    }

    const seen = new Set<number>();
    const normalized: ChannelFtpEventConfig[] = [];
    for (const item of filtered) {
      if (seen.has(item.channel)) {
        throw new Error(`Duplicate channel in channelConfigs: ${item.channel}`);
      }
      if (!item.events.length) {
        throw new Error(`events is required for channel ${item.channel}`);
      }
      seen.add(item.channel);
      normalized.push({
        channel: item.channel,
        events: [...new Set(item.events)],
      });
    }

    return normalized.sort((a, b) => a.channel - b.channel);
  }

  private async enableDeviceFtpForChannels(
    input: PipelineDeviceFtpInput,
    channels: number[] | "all",
    nvrChannelCount: number,
    enableFlags: { enable: number; scheduleEnable: number },
    options?: { requireEventConfig?: boolean },
  ): Promise<{ channels: unknown[]; message: string }> {
    if (options?.requireEventConfig) {
      if (Array.isArray(channels)) {
        this.assertFtpEventConfigForChannels(input, channels);
      } else {
        this.assertFtpEventConfig(input);
      }
    } else if (Array.isArray(channels)) {
      this.assertFtpEventConfigForChannels(input, channels);
    }

    return this.deviceClient.configureDeviceFtp(
      this.buildConfigureDeviceFtpOptions(
        input,
        channels,
        nvrChannelCount,
        enableFlags,
      ),
    ).then((results) => ({
      channels: results,
      message:
        `NVR FTP 已启动: enable=${enableFlags.enable}, ` +
        `scheduleEnable=${enableFlags.scheduleEnable}`,
    }));
  }

  private assertFtpEventConfigForChannels(
    input: PipelineDeviceFtpInput,
    channels: number[],
  ): void {
    if (input.channelConfigs?.length) {
      const configured = new Set(input.channelConfigs.map((item) => item.channel));
      const missing = channels.filter((channel) => !configured.has(channel));
      if (missing.length) {
        throw new Error(
          `channelConfigs is missing FTP event config for channels: ${missing.join(",")}`,
        );
      }
      return;
    }

    this.assertFtpEventConfig(input);
  }

  // 从 channels:"all" 部分停止后，转为显式剩余通道列表（如 1,2,3）
  private materializeWatchChannelsIfNeeded(): void {
    if (this.watchChannels !== null || this.excludedWatchChannels.size === 0) {
      return;
    }

    const nvrCount =
      this.pipelineConfig?.nvrChannelCount ?? DEFAULT_NVR_CHANNEL_COUNT;
    this.watchChannels = new Set(
      Array.from({ length: nvrCount }, (_, i) => i).filter(
        (ch) => !this.excludedWatchChannels.has(ch),
      ),
    );
    this.excludedWatchChannels.clear();
  }


  // POST /reolink/control/pipeline/start 参数配置
  private buildPipelineConfig(
    input: StartPipelineInput,
    nvrChannelCount: number,
    channels: number[] | "all",
  ): PipelineConfig {
    const cwd = process.cwd();
    return {
      watchDir: path.resolve(cwd, input.watchDir ?? DEFAULT_WATCH_DIR),
      analysisDir: path.resolve(cwd, input.analysisDir ?? DEFAULT_ANALYSIS_DIR),
      channels,
      nvrChannelCount,
      ftp: {
        host: input.ftp.host ?? DEFAULT_FTP_HOST,
        port: input.ftp.port ?? DEFAULT_FTP_PORT,
        username: input.ftp.username ?? DEFAULT_FTP_USERNAME,
        password: input.ftp.password ?? DEFAULT_FTP_PASSWORD,
        pasvUrl: resolveFtpPasvUrl(input.ftp.pasvUrl),
        pasvMin: DEFAULT_FTP_PASV_MIN,
        pasvMax: DEFAULT_FTP_PASV_MAX,
      },
      aggregation: {
        gapSeconds: DEFAULT_EVENT_GAP_SECONDS,
        finalizeDelaySeconds: DEFAULT_EVENT_FINALIZE_DELAY_SECONDS,
        maxDurationSeconds: DEFAULT_EVENT_MAX_DURATION_SECONDS,
      },
      sampling: {
        maxFrames: DEFAULT_LLM_SAMPLE_MAX_FRAMES,
      },
      analysisEnabled: true,
      pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
      processExisting: false,
    };
  }
}
