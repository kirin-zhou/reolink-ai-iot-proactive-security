import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import {
  ResponseBody,
  ResponseMeta_IoTServer,
  createResponseBody,
} from "../../common/response.model";
import { DEFAULT_FTP_PASSIVE_MODE, DEFAULT_NVR_CHANNEL_COUNT } from "../reolink.constants";
import { ConfigureDeviceFtpOptions, DisableDeviceFtpOptions } from "../reolink.types";
import { ReolinkControlService } from "./reolink-control.service";
import {
  ConfigureDeviceFtpDto,
  AddPipelineChannelsDto,
  DisableDeviceFtpDto,
  GetDeviceFtpDto,
  StartPipelineDto,
  StopPipelineDto,
  DeletePipelineChannelsDto,
  TestDeviceFtpDto,
} from "./dto/reolink-control.dto";


@Controller("reolink/control")
export class ReolinkControlController {
  constructor(
    private readonly controlService: ReolinkControlService,
    @InjectPinoLogger(ReolinkControlController.name)
    private readonly logger: PinoLogger,
  ) {}

  // POST /reolink/control/device/ftp/configure 批量配置 NVR/摄像头 FTP 上传
  @Post("device/ftp/configure")
  async configureDeviceFtp(
    @Body() dto: ConfigureDeviceFtpDto,
  ): Promise<ResponseBody<unknown>> {
    const options: ConfigureDeviceFtpOptions = {
      host: dto.host,
      username: dto.username,
      password: dto.password,
      channels: dto.channels ?? "all",
      nvrChannelCount: dto.nvrChannelCount ?? DEFAULT_NVR_CHANNEL_COUNT,
      events: dto.events,
      channelConfigs: dto.channelConfigs,
      ftpServer: {
        address: dto.ftpServer.address,
        port: dto.ftpServer.port,
        username: dto.ftpServer.username,
        password: dto.ftpServer.password,
        remoteDir: dto.ftpServer.remoteDir ?? "/",
      },
      passiveMode: DEFAULT_FTP_PASSIVE_MODE,
      onlyFtps: dto.onlyFtps ?? false,
      testAfterSet: dto.testAfterSet ?? false,
    };

    try {
      const result = await this.controlService.configureDeviceFtp(options);
      return createResponseBody(ResponseMeta_IoTServer.T_20000, result);
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "configureDeviceFtp failed",
      );
      throw new BadRequestException(
        e instanceof Error ? e.message : "configureDeviceFtp failed",
      );
    }
  }


  // POST /reolink/control/device/ftp/disable 关闭 NVR 指定通道 FTP 上传
  @Post("device/ftp/disable")
  async disableDeviceFtp(
    @Body() dto: DisableDeviceFtpDto,
  ): Promise<ResponseBody<unknown>> {
    if (
      dto.channels === undefined ||
      (Array.isArray(dto.channels) && dto.channels.length === 0)
    ) {
      throw new BadRequestException("channels is required");
    }

    const options: DisableDeviceFtpOptions = {
      host: dto.host,
      username: dto.username,
      password: dto.password,
      channels: dto.channels,
      nvrChannelCount: dto.nvrChannelCount ?? DEFAULT_NVR_CHANNEL_COUNT,
    };

    try {
      const result = await this.controlService.disableDeviceFtp(options);
      return createResponseBody(ResponseMeta_IoTServer.T_20000, result);
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "disableDeviceFtp failed",
      );
      throw new BadRequestException(
        e instanceof Error ? e.message : "disableDeviceFtp failed",
      );
    }
  }


  // POST /reolink/control/device/ftp/test 测试 FTP 连接
  @Post("device/ftp/test")
  async testDeviceFtp(
    @Body() dto: TestDeviceFtpDto,
  ): Promise<ResponseBody<{ message: string }>> {
    try {
      const result = await this.controlService.testDeviceFtp(
        dto.host,
        dto.username,
        dto.password,
        dto.channel,
      );
      return createResponseBody(ResponseMeta_IoTServer.T_20000, result);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "testDeviceFtp failed",
      );
    }
  }


  // POST /reolink/control/device/ftp/get 获取 FTP 配置
  @Post("device/ftp/get")
  async getDeviceFtp(
    @Body() dto: GetDeviceFtpDto,
  ): Promise<ResponseBody<Record<string, unknown>>> {
    try {
      const result = await this.controlService.getDeviceFtpConfig(
        dto.host,
        dto.username,
        dto.password,
        dto.channel,
      );
      return createResponseBody(ResponseMeta_IoTServer.T_20000, result);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "getDeviceFtp failed",
      );
    }
  }


  // POST /reolink/control/pipeline/start 启动 FTP 监测 + 聚合 + LLM
  @Post("pipeline/start")
  async startPipeline(
    @Body() dto: StartPipelineDto,
  ): Promise<ResponseBody<unknown>> {
    try {
      const status = await this.controlService.startPipeline({
        watchDir: dto.watchDir,
        analysisDir: dto.analysisDir,
        channels: dto.channels,
        device: dto.device,
        events: dto.events,
        channelConfigs: dto.channelConfigs,
        onlyFtps: dto.onlyFtps,
        nvrChannelCount: dto.nvrChannelCount,
        ftp: dto.ftp,
      });
      return createResponseBody(ResponseMeta_IoTServer.T_20000, status);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "startPipeline failed",
      );
    }
  }

  
  // POST /reolink/control/pipeline/stop 完全停止 FTP 和所有 channel
  @Post("pipeline/stop")
  async stopPipeline(
    @Body() dto: StopPipelineDto,
  ): Promise<ResponseBody<unknown>> {
    try {
      const status = await this.controlService.stopPipeline({
        device: dto.device,
        nvrChannelCount: dto.nvrChannelCount,
      });
      return createResponseBody(ResponseMeta_IoTServer.T_20000, status);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "stopPipeline failed",
      );
    }
  }


  // POST /reolink/control/pipeline/channels/delete 关闭全部或指定 channel（保留 FTP 总开关）
  @Post("pipeline/channels/delete")
  async deletePipelineChannels(
    @Body() dto: DeletePipelineChannelsDto,
  ): Promise<ResponseBody<unknown>> {
    try {
      const status = await this.controlService.deletePipelineChannels({
        device: dto.device,
        channels: dto.channels,
        nvrChannelCount: dto.nvrChannelCount,
      });
      return createResponseBody(ResponseMeta_IoTServer.T_20000, status);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "deletePipelineChannels failed",
      );
    }
  }


  // POST /reolink/control/pipeline/channels/add 管道运行中追加监听 channel
  @Post("pipeline/channels/add")
  async addPipelineChannels(
    @Body() dto: AddPipelineChannelsDto,
  ): Promise<ResponseBody<unknown>> {
    try {
      const status = await this.controlService.addPipelineChannels({
        device: dto.device,
        channels: dto.channels,
        events: dto.events,
        channelConfigs: dto.channelConfigs,
        onlyFtps: dto.onlyFtps,
        nvrChannelCount: dto.nvrChannelCount,
      });
      return createResponseBody(ResponseMeta_IoTServer.T_20000, status);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "addPipelineChannels failed",
      );
    }
  }


  // GET /reolink/control/pipeline/status 获取 FTP 监测 + 聚合 + LLM 状态
  @Get("pipeline/status")
  getPipelineStatus(): ResponseBody<unknown> {
    return createResponseBody(
      ResponseMeta_IoTServer.T_20000,
      this.controlService.getStatus(),
    );
  }


  // GET /reolink/control/events 查询事件列表
  @Get("events")
  listEvents(
    @Query("limit") limit?: string,
  ): ResponseBody<unknown> {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return createResponseBody(
      ResponseMeta_IoTServer.T_20000,
      this.controlService.listEvents(
        Number.isFinite(parsedLimit) ? parsedLimit : 50,
      ),
    );
  }


  // GET /reolink/control/events/:eventId 获取事件详情
  @Get("events/:eventId")
  getEvent(@Param("eventId") eventId: string): ResponseBody<unknown> {
    const event = this.controlService.getEvent(eventId);
    if (!event) {
      throw new NotFoundException(`Event not found: ${eventId}`);
    }
    return createResponseBody(ResponseMeta_IoTServer.T_20000, event);
  }
}
