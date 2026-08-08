import { Injectable } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import * as https from "https";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import {
  AI_EVENT_SCHEDULE_KEYS,
  DEFAULT_PIC_CAPTURE_MODE,
  DEFAULT_PIC_UPLOAD_INTERVAL_SECONDS,
  DISABLED_SCHEDULE_KEYS,
  type ReolinkFtpEventType,
} from "../reolink.constants";
import {
  ChannelFtpEventConfig,
  ConfigureDeviceFtpOptions,
  DeviceFtpEnableFlags,
  DisableDeviceFtpOptions,
} from "../reolink.types";

export interface ReolinkCredentials {
  host: string;
  username: string;
  password: string;
}

export interface ReolinkFtpConfigResult {
  channel: number;
  action: string;
  ftp: Record<string, unknown>;
}


@Injectable()
export class ReolinkDeviceClient {
  private readonly httpsAgent = new https.Agent({ rejectUnauthorized: false });

  constructor(
    @InjectPinoLogger(ReolinkDeviceClient.name)
    private readonly logger: PinoLogger,
  ) {}

  parseRtspUrl(rtspUrl: string): ReolinkCredentials {
    const parsed = new URL(rtspUrl);
    if (parsed.protocol !== "rtsp:") {
      throw new Error("RTSP URL must start with rtsp://");
    }
    if (!parsed.hostname || !parsed.username || parsed.password === "") {
      throw new Error("RTSP URL must contain username, password, and host");
    }
    return {
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      host: parsed.hostname,
    };
  }


  async configureDeviceFtp(
    options: ConfigureDeviceFtpOptions,
  ): Promise<ReolinkFtpConfigResult[]> {
    const session = this.createSession();
    const token = await this.login(session, options);
    const results: ReolinkFtpConfigResult[] = [];

    const channelConfigs = this.resolveChannelFtpConfigs(options);

    try {
      for (const { channel: ch, events } of channelConfigs) {
        const getResult = await this.callApi(
          session,
          options,
          token,
          "GetFtpV20",
          [{ cmd: "GetFtpV20", action: 1, param: { channel: ch } }],
        );
        const ftpParam = this.getFtpValue(getResult);

        this.updateV20FtpConfig(ftpParam, {
          channel: ch,
          serverAddress: options.ftpServer.address,
          ftpPort: options.ftpServer.port,
          ftpUsername: options.ftpServer.username,
          ftpPassword: options.ftpServer.password,
          remoteDir: options.ftpServer.remoteDir,
          passiveMode: options.passiveMode,
          onlyFtps: options.onlyFtps,
          enabledEvents: events,
        }, options.enableFlags ?? "preserve");
        await this.setFtpV20ForChannel(session, options, token, ftpParam);
        const enableFlags = options.enableFlags ?? "preserve";
        results.push({
          channel: ch,
          action:
            enableFlags !== "preserve" && enableFlags.enable === 1
              ? enableFlags.scheduleEnable === 1
                ? `已启用 FTP 上传 (${events.join(",")})`
                : "已启用 FTP 总开关，通道计划保持关闭"
              : `已配置 FTP 上传目标 (${events.join(",")})`,
          ftp: ftpParam.Ftp as Record<string, unknown>,
        });
        this.logger.info(
          { channel: ch, events, enableFlags },
          "SetFtpV20: FTP configured",
        );
      }

      if (options.testAfterSet) {
        const firstEnabled = results.find((r) =>
          r.action.includes("启用"),
        );
        if (firstEnabled) {
          await this.testFtp(session, options, token, {
            Ftp: firstEnabled.ftp,
          });
        }
      }
    } finally {
      await this.logout(session, options, token);
    }
    return results;
  }

  async disableDeviceFtp(
    options: DisableDeviceFtpOptions,
  ): Promise<ReolinkFtpConfigResult[]> {
    const session = this.createSession();
    const token = await this.login(session, options);
    const results: ReolinkFtpConfigResult[] = [];

    const requestedChannels = options.channels;
    let channelsToDisable: number[];
    if (requestedChannels === "all") {
      channelsToDisable = Array.from(
        { length: options.nvrChannelCount },
        (_, i) => i,
      );
    } else {
      channelsToDisable = [...new Set(requestedChannels)].sort((a, b) => a - b);
    }
    const disableAll = requestedChannels === "all";
    const disabledSet = new Set(channelsToDisable);

    try {
      let clearGlobalEnable =
        options.clearGlobalEnable ?? disableAll;
      if (options.clearGlobalEnable === undefined && !disableAll) {
        clearGlobalEnable = true;
        for (let ch = 0; ch < options.nvrChannelCount; ch++) {
          if (disabledSet.has(ch)) continue;
          const getResult = await this.callApi(
            session,
            options,
            token,
            "GetFtpV20",
            [{ cmd: "GetFtpV20", action: 1, param: { channel: ch } }],
          );
          const ftp = this.getFtpValue(getResult).Ftp as Record<string, unknown>;
          if (ftp.scheduleEnable === 1) {
            clearGlobalEnable = false;
            break;
          }
        }
      }

      for (const ch of channelsToDisable) {
        const getResult = await this.callApi(
          session,
          options,
          token,
          "GetFtpV20",
          [{ cmd: "GetFtpV20", action: 1, param: { channel: ch } }],
        );
        const ftpParam = this.getFtpValue(getResult);

        this.disableV20FtpConfig(ftpParam, ch, { clearGlobalEnable });
        await this.setFtpV20ForChannel(session, options, token, ftpParam);
        results.push({
          channel: ch,
          action: clearGlobalEnable
            ? "已关闭 FTP 上传"
            : "已关闭通道 FTP 计划（保留 NVR 全局 enable）",
          ftp: ftpParam.Ftp as Record<string, unknown>,
        });
        this.logger.info(
          { channel: ch, clearGlobalEnable },
          "SetFtpV20: FTP disabled",
        );
      }
    } finally {
      await this.logout(session, options, token);
    }
    return results;
  }

  async getDeviceFtpConfig(
    creds: ReolinkCredentials,
    channel: number,
  ): Promise<Record<string, unknown>> {
    const session = this.createSession();
    const token = await this.login(session, creds);
    try {
      const getResult = await this.callApi(
        session,
        creds,
        token,
        "GetFtpV20",
        [{ cmd: "GetFtpV20", action: 1, param: { channel } }],
      );
      return this.getFtpValue(getResult);
    } finally {
      await this.logout(session, creds, token);
    }
  }

  async getDeviceFtpConfigs(
    creds: ReolinkCredentials,
    nvrChannelCount: number,
  ): Promise<ReolinkFtpConfigResult[]> {
    const session = this.createSession();
    const token = await this.login(session, creds);
    const results: ReolinkFtpConfigResult[] = [];

    try {
      for (let channel = 0; channel < nvrChannelCount; channel++) {
        const getResult = await this.callApi(
          session,
          creds,
          token,
          "GetFtpV20",
          [{ cmd: "GetFtpV20", action: 1, param: { channel } }],
        );
        const ftpParam = this.getFtpValue(getResult);
        const ftp = ftpParam.Ftp as Record<string, unknown>;
        const channelOn = ftp.scheduleEnable === 1;
        results.push({
          channel,
          action: channelOn ? "FTP 计划已开启" : "FTP 计划已关闭",
          ftp,
        });
      }
    } finally {
      await this.logout(session, creds, token);
    }

    return results;
  }

  // 测试指定通道 FTP 配置
  async testDeviceFtp(
    creds: ReolinkCredentials,
    channel: number,
  ): Promise<void> {
    const session = this.createSession();
    const token = await this.login(session, creds);
    try {
      const getResult = await this.callApi(
        session,
        creds,
        token,
        "GetFtpV20",
        [{ cmd: "GetFtpV20", action: 1, param: { channel } }],
      );
      const ftpParam = this.getFtpValue(getResult);
      await this.testFtp(session, creds, token, ftpParam);
    } finally {
      await this.logout(session, creds, token);
    }
  }

  private createSession(): AxiosInstance {
    return axios.create({
      httpsAgent: this.httpsAgent,
      timeout: 20000,
    });
  }


  private async login(
    session: AxiosInstance,
    creds: ReolinkCredentials,
  ): Promise<string> {
    const url = `https://${creds.host}/api.cgi?cmd=Login`;
    const payload = [
      {
        cmd: "Login",
        param: {
          User: {
            userName: creds.username,
            password: creds.password,
          },
        },
      },
    ];

    const response = await session.post(url, payload, { timeout: 10000 });
    const data = response.data;

    if (!Array.isArray(data) || !data.length) {
      throw new Error(`Unexpected login response: ${JSON.stringify(data)}`);
    }

    const result = data[0];
    if (result.code !== 0) {
      const err = result.error || {};
      if (err.rspCode === -5 || err.detail === "max session") {
        throw new Error(
          `Login failed: max session (NVR API 登录会话已满)。请关闭浏览器中的 NVR 页面（${creds.host}），或等待旧会话过期后重试。`,
        );
      }
      throw new Error(`Login failed: ${JSON.stringify(result)}`);
    }

    const token = result?.value?.Token?.name;
    if (!token) {
      throw new Error(`Token not found in login response: ${JSON.stringify(result)}`);
    }
    return token;
  }


  private async logout(
    session: AxiosInstance,
    creds: ReolinkCredentials,
    token: string,
  ): Promise<void> {
    const url = `https://${creds.host}/api.cgi?cmd=Logout&token=${token}`;
    const payload = [{ cmd: "Logout", action: 0, param: {} }];
    try {
      await session.post(url, payload, { timeout: 10000 });
    } catch {
    }
  }


  private async callApi(
    session: AxiosInstance,
    creds: ReolinkCredentials,
    token: string,
    cmd: string,
    payload: object[],
  ): Promise<Record<string, unknown>> {
    const url = `https://${creds.host}/api.cgi?cmd=${cmd}&token=${token}`;
    const response = await session.post(url, payload);
    const data = response.data;
    
    if (!Array.isArray(data) || !data.length) {
      throw new Error(`Unexpected ${cmd} response: ${JSON.stringify(data)}`);
    }

    const result = data[0];
    if (result.code !== 0) {
      throw new Error(`${cmd} failed: ${JSON.stringify(result)}`);
    }

    return result;
  }


  // 写入指定通道 FTP 配置
  private async setFtpV20ForChannel(
    session: AxiosInstance,
    creds: ReolinkCredentials,
    token: string,
    ftpParam: Record<string, unknown>,
  ): Promise<void> {
    await this.callApi(session, creds, token, "SetFtpV20", [
      { cmd: "SetFtpV20", param: ftpParam },
    ]);
  }


  // 测试指定通道 FTP 配置
  private async testFtp(
    session: AxiosInstance,
    creds: ReolinkCredentials,
    token: string,
    ftpParam: Record<string, unknown>,
  ): Promise<void> {
    await this.callApi(session, creds, token, "TestFtp", [
      { cmd: "TestFtp", action: 0, param: ftpParam },
    ]);
  }


  // 从 GetFtpV20 响应提取 FTP 配置对象，并包装成 { Ftp: ftp } 格式，传给 SetFtpV20 写回
  private getFtpValue(getResult: Record<string, unknown>): Record<string, unknown> {
    const value = getResult.value as Record<string, unknown> | undefined;
    if (!value || typeof value !== "object") {
      throw new Error(`Invalid GetFtpV20 response: ${JSON.stringify(getResult)}`);
    }

    const realValue =
      typeof value.value === "object" && value.value !== null
        ? (value.value as Record<string, unknown>)
        : value;

    // 获取 FTP 配置对象
    const ftp = realValue.Ftp;
    if (!ftp || typeof ftp !== "object") {
      throw new Error(`Ftp config not found in response: ${JSON.stringify(getResult)}`);
    }

    return { Ftp: ftp };
  }


  // 解析各通道 FTP 监测事件：channelConfigs 优先，否则 channels + events
  private resolveChannelFtpConfigs(
    options: ConfigureDeviceFtpOptions,
  ): ChannelFtpEventConfig[] {
    if (options.channelConfigs?.length) {
      const seen = new Set<number>();
      const configs: ChannelFtpEventConfig[] = [];
      for (const item of options.channelConfigs) {
        if (seen.has(item.channel)) {
          throw new Error(`Duplicate channel in channelConfigs: ${item.channel}`);
        }
        if (!item.events.length) {
          throw new Error(`events is required for channel ${item.channel}`);
        }
        seen.add(item.channel);
        configs.push({
          channel: item.channel,
          events: [...new Set(item.events)],
        });
      }
      return configs.sort((a, b) => a.channel - b.channel);
    }

    const channels =
      options.channels === "all"
        ? Array.from({ length: options.nvrChannelCount }, (_, i) => i)
        : [...options.channels].sort((a, b) => a - b);
    const events =
      options.events?.length
        ? [...new Set(options.events)]
        : [...AI_EVENT_SCHEDULE_KEYS];

    return channels.map((channel) => ({ channel, events }));
  }


  // 每周定时上传事件 schedule.table 每个告警类型是 7 * 24 = 168 位
  private weeklySchedule(enabled: boolean): string {
    // 生成一周 168 小时的开关字符串 (1：启用，0：关闭)
    return (enabled ? "1" : "0").repeat(168);
  }


  // 关闭指定通道 FTP 计划
  private disableV20FtpConfig(
    ftpParam: Record<string, unknown>,
    channel: number,
    options: { clearGlobalEnable: boolean } = { clearGlobalEnable: true },
  ): void {
    const ftpConfig = ftpParam.Ftp as Record<string, unknown>;

    if (options.clearGlobalEnable) {
      ftpConfig.enable = 0;
    }
    ftpConfig.scheduleEnable = 0;

    const schedule = (ftpConfig.schedule as Record<string, unknown>) ?? {
      channel,
      table: {},
    };
    schedule.channel = channel;
    schedule.enable = 0;
    const table = (schedule.table as Record<string, string>) ?? {};
    for (const key of [...AI_EVENT_SCHEDULE_KEYS, ...DISABLED_SCHEDULE_KEYS]) {
      table[key] = this.weeklySchedule(false);
    }
    schedule.table = table;
    ftpConfig.schedule = schedule;
  }


  // 更新指定通道 FTP 配置
  private updateV20FtpConfig(
    ftpParam: Record<string, unknown>,
    options: {
      channel: number;
      serverAddress: string;
      ftpPort: number;
      ftpUsername: string;
      ftpPassword: string;
      remoteDir: string;
      passiveMode: boolean;
      onlyFtps: boolean;
      enabledEvents: ReolinkFtpEventType[];
    },
    enableFlags: DeviceFtpEnableFlags = "preserve",
  ): void {
    const ftpConfig = ftpParam.Ftp as Record<string, unknown>;
    const picUploadIntervalSeconds = DEFAULT_PIC_UPLOAD_INTERVAL_SECONDS;
    const streamType = 3; // 只上传图片

    // 更新 FTP 配置对象
    Object.assign(ftpConfig, {
      server: options.serverAddress,
      port: options.ftpPort,
      anonymous: 0,                   // 不使用匿名登录
      userName: options.ftpUsername,
      password: options.ftpPassword,
      remoteDir: options.remoteDir,
      streamType,
      mode: options.passiveMode ? 2 : 0,
      onlyFtps: options.onlyFtps ? 1 : 0,
      bpicSingle: 0,
      bvideoSingle: 0,
      picInterval: picUploadIntervalSeconds,
      picCaptureMode: DEFAULT_PIC_CAPTURE_MODE,
      picWidth: 0,
      picHeight: 0,
    });

    if (enableFlags !== "preserve") {
      ftpConfig.enable = enableFlags.enable;
      ftpConfig.scheduleEnable = enableFlags.scheduleEnable;
    }

    ftpConfig.interval = Math.max(1, picUploadIntervalSeconds);

    // 创建定时上传时间表
    const schedule = (ftpConfig.schedule as Record<string, unknown>) ?? {
      channel: options.channel,
      table: {},
    };
    schedule.channel = options.channel;
    if (enableFlags !== "preserve") {
      schedule.enable = enableFlags.scheduleEnable;
    }
    const table = (schedule.table as Record<string, string>) ?? {};
    const enabled = new Set(options.enabledEvents);
    for (const key of AI_EVENT_SCHEDULE_KEYS) {
      table[key] = this.weeklySchedule(enabled.has(key));
    }
    for (const key of DISABLED_SCHEDULE_KEYS) {
      table[key] = this.weeklySchedule(false);
    }
    schedule.table = table;
    ftpConfig.schedule = schedule;
  }
}
