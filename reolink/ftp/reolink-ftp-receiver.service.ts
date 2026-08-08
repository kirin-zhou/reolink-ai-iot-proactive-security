import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import * as fs from "fs";
import * as path from "path";
import { FtpSrv } from "ftp-srv";
import { PipelineFtpConfig } from "../reolink.types";
import {
  channelFromUploadFilename,
  formatWatchChannels,
  uploadMatchesWatchChannels,
} from "../pipeline/reolink-filename.utils";
import {
  isImageFile,
  iterUploadedMedia,
  waitUntilUploadedMediaComplete,
} from "../pipeline/reolink-upload.utils";
import { resolveFtpPasvUrl } from "./reolink-ftp-pasv.util";

export type UploadReceivedHandler = (params: {
  filePath: string;
  channel: number;
  mtime: number;
}) => void;


export interface FtpReceiverStartOptions {
  watchDir: string;
  ftp: PipelineFtpConfig;
  channels: Set<number> | null;
  pollIntervalSeconds: number;
  processExisting: boolean;
  onUpload: UploadReceivedHandler;
}


// 本地 FTP 接收 + 上传目录监听
@Injectable()
export class ReolinkFtpReceiverService implements OnModuleDestroy {
  private ftpServer: FtpSrv | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenFiles = new Set<string>();
  private pollInFlight = false;
  private watchChannels: Set<number> | null = null;
  private excludedWatchChannels = new Set<number>();
  private pollIntervalSeconds = 0.5;
  private running = false;
  private watchDir = "";
  private onUpload: UploadReceivedHandler | null = null;

  constructor(
    @InjectPinoLogger(ReolinkFtpReceiverService.name)
    private readonly logger: PinoLogger,
  ) {}

  // 停止 FTP Receiver 时清理资源
  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  // 判断 FTP Receiver 是否正在运行
  isRunning(): boolean {
    return this.running;
  }

  // 获取上传目录
  getWatchDir(): string {
    return this.watchDir;
  }

  // 启动 FTP Receiver
  async start(options: FtpReceiverStartOptions): Promise<void> {
    if (this.running) {
      throw new Error("FTP receiver is already running");
    }

    this.watchDir = path.resolve(options.watchDir);
    fs.mkdirSync(this.watchDir, { recursive: true });

    this.onUpload = options.onUpload;
    this.watchChannels = options.channels;
    this.excludedWatchChannels = new Set();
    this.pollIntervalSeconds = options.pollIntervalSeconds;

    const pasvUrl = resolveFtpPasvUrl(options.ftp.pasvUrl);
    const ftpUrl = `ftp://${options.ftp.host}:${options.ftp.port}`;
    const preexistingSignalListeners = this.snapshotProcessSignalListeners();
    this.ftpServer = new FtpSrv({
      url: ftpUrl,
      anonymous: false,
      pasv_url: pasvUrl,
      pasv_min: options.ftp.pasvMin,
      pasv_max: options.ftp.pasvMax,
      greeting: ["Reolink FTP upload receiver ready."],
    });
    this.detachFtpSrvProcessSignalHandlers(preexistingSignalListeners);

    // 处理 FTP 登录请求
    this.ftpServer.on("login", ({ username, password }, resolve, reject) => {
      if (
        username === options.ftp.username &&
        password === options.ftp.password
      ) {
        resolve({ root: this.watchDir });
      } else {
        reject(new Error("Invalid username or password"));
      }
    });

    this.ftpServer.on("client-error", ({ context, error }) => {
      this.logger.warn(
        { context, err: error.message },
        "FTP client error",
      );
    });

    await this.ftpServer.listen();
    this.running = true;

    this.seenFiles = new Set();
    if (!options.processExisting) {
      for (const filePath of iterUploadedMedia(this.watchDir)) {
        this.seenFiles.add(path.resolve(filePath));
      }
    }

    const channelsDesc = formatWatchChannels(options.channels);
    this.logger.info(
      {
        ftpUrl,
        pasvUrl,
        pasvRange: `${options.ftp.pasvMin}-${options.ftp.pasvMax}`,
        watchDir: this.watchDir,
        channels: channelsDesc,
      },
      "Local FTP server started",
    );

    this.pollTimer = setInterval(() => {
      void this.pollUploads();
    }, this.pollIntervalSeconds * 1000);
  }

  // 更新监听通道
  updateWatchChannels(
    channels: Set<number> | null,
    excludedChannels: Set<number>,
  ): void {
    this.watchChannels = channels;
    this.excludedWatchChannels = new Set(excludedChannels);
  }

  getWatchChannelFilter(): {
    channels: Set<number> | null;
    excludedChannels: Set<number>;
  } {
    return {
      channels: this.watchChannels,
      excludedChannels: new Set(this.excludedWatchChannels),
    };
  }

  // 停止 FTP Receiver
  async stop(): Promise<void> {
    this.running = false;
    this.onUpload = null;
    this.watchChannels = null;
    this.excludedWatchChannels.clear();

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.ftpServer) {
      try {
        await this.ftpServer.close();
      } catch (e) {
        this.logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "Error closing FTP server",
        );
      }
      this.ftpServer = null;
    }

    this.logger.info("FTP receiver stopped");
  }

  private static readonly FTP_SRV_PROCESS_SIGNALS = [
    "SIGINT",
    "SIGTERM",
    "SIGQUIT",
  ] as const;

  private snapshotProcessSignalListeners(): Map<string, Set<NodeJS.SignalsListener>> {
    const snapshot = new Map<string, Set<NodeJS.SignalsListener>>();
    for (const signal of ReolinkFtpReceiverService.FTP_SRV_PROCESS_SIGNALS) {
      snapshot.set(
        signal,
        new Set(process.listeners(signal) as NodeJS.SignalsListener[]),
      );
    }
    return snapshot;
  }

  // 去掉 ftp-srv 在构造时挂上的 process 信号钩子，避免 Ctrl+C 时 process.exit(0)
  private detachFtpSrvProcessSignalHandlers(
    preexisting: Map<string, Set<NodeJS.SignalsListener>>,
  ): void {
    for (const signal of ReolinkFtpReceiverService.FTP_SRV_PROCESS_SIGNALS) {
      const before = preexisting.get(signal) ?? new Set();
      for (const listener of process.listeners(signal) as NodeJS.SignalsListener[]) {
        if (!before.has(listener)) {
          process.removeListener(signal, listener);
        }
      }
    }
  }

  private async pollUploads(): Promise<void> {
    if (!this.running || !this.onUpload || this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    try {
      await this.scanUploads();
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "FTP upload poll failed",
      );
    } finally {
      this.pollInFlight = false;
    }
  }

  private async scanUploads(): Promise<void> {
    if (!this.running || !this.onUpload) {
      return;
    }

    for (const uploadedFile of iterUploadedMedia(this.watchDir)) {
      if (!this.running || !this.onUpload) {
        return;
      }

      const resolved = path.resolve(uploadedFile);

      if (this.seenFiles.has(resolved)) {
        continue;
      }

      if (
        !uploadMatchesWatchChannels(
          resolved,
          this.watchChannels,
          this.excludedWatchChannels,
        )
      ) {
        this.seenFiles.add(resolved);
        continue;
      }

      const fileChannel = channelFromUploadFilename(resolved);
      if (fileChannel === null) {
        this.seenFiles.add(resolved);
        continue;
      }

      this.seenFiles.add(resolved);

      const stable = await waitUntilUploadedMediaComplete(resolved);
      if (!this.running || !this.onUpload) {
        return;
      }
      if (!stable) {
        this.seenFiles.delete(resolved);
        this.logger.warn({ file: resolved }, "File not stable or disappeared");
        continue;
      }
      const stat = fs.statSync(resolved);

      this.logger.info(
        {
          channel: fileChannel,
          file: path.relative(this.watchDir, resolved),
          bytes: stat.size,
          kind: isImageFile(resolved) ? "image" : "media",
        },
        "Received Reolink FTP upload",
      );

      if (isImageFile(resolved)) {
        const onUpload = this.onUpload;
        if (!onUpload) {
          return;
        }
        onUpload({
          filePath: resolved,
          channel: fileChannel,
          mtime: stat.mtimeMs / 1000,
        });
      }
    }
  }
}
