// Reolink 控制层请求 DTO
import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import {
  AI_EVENT_SCHEDULE_KEYS,
  type ReolinkFtpEventType,
} from "../../reolink.constants";


export class DeviceChannelFtpEventDto {
  @IsInt()
  @Min(0)
  channel!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(AI_EVENT_SCHEDULE_KEYS, { each: true })
  events!: ReolinkFtpEventType[];
}

// POST /reolink/control/device/ftp/configure 写入摄像头的 FTP 目标地址
export class DeviceFtpServerDto {
  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsInt()
  @Min(1)
  port!: number;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsOptional()
  remoteDir?: string;
}

// POST /reolink/control/device/ftp/configure 请求体：批量配置 NVR/摄像头 FTP 上传
export class ConfigureDeviceFtpDto {
  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  channels?: number[] | "all";

  @IsArray()
  @IsOptional()
  @IsIn(AI_EVENT_SCHEDULE_KEYS, { each: true })
  events?: ReolinkFtpEventType[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceChannelFtpEventDto)
  @IsOptional()
  channelConfigs?: DeviceChannelFtpEventDto[];
  
  @IsInt()
  @Min(1)
  @IsOptional()
  nvrChannelCount?: number;

  @ValidateNested()
  @Type(() => DeviceFtpServerDto)
  ftpServer!: DeviceFtpServerDto;

  @IsBoolean()
  @IsOptional()
  onlyFtps?: boolean; 

  @IsBoolean()
  @IsOptional()
  testAfterSet?: boolean;
}

// 登录信息
export class DeviceCredentialsDto {
  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

// POST /reolink/control/device/ftp/disable 关闭指定通道 FTP 上传
export class DisableDeviceFtpDto extends DeviceCredentialsDto {
  @IsOptional()
  channels?: number[] | "all";

  @IsInt()
  @Min(1)
  @IsOptional()
  nvrChannelCount?: number;
}

// 测试 FTP 连接
export class TestDeviceFtpDto extends DeviceCredentialsDto {
  @IsInt()
  @Min(0)
  channel!: number;
}

// 获取 FTP 配置
export class GetDeviceFtpDto extends DeviceCredentialsDto {
  @IsInt()
  @Min(0)
  channel!: number;
}


// NVR 设备 FTP 配置
export class PipelineDeviceFtpDto extends DeviceCredentialsDto {
  @ValidateNested()
  @Type(() => DeviceFtpServerDto)
  ftpServer!: DeviceFtpServerDto;

  @IsArray()
  @IsOptional()
  @IsIn(AI_EVENT_SCHEDULE_KEYS, { each: true })
  events?: ReolinkFtpEventType[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceChannelFtpEventDto)
  @IsOptional()
  channelConfigs?: DeviceChannelFtpEventDto[];
  
  @IsBoolean()
  @IsOptional()
  onlyFtps?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  nvrChannelCount?: number;
}

export class PipelineFtpDto {
  @IsString()
  @IsOptional()
  host?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  port?: number;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  pasvUrl?: string;
}


// POST /reolink/control/pipeline/start 请求体
export class StartPipelineDto {
  @IsString()
  @IsOptional()
  watchDir?: string;

  @IsString()
  @IsOptional()
  analysisDir?: string;

  @IsOptional()
  channels?: number[] | "all";

  @ValidateNested()
  @Type(() => DeviceCredentialsDto)
  @IsOptional()
  device?: DeviceCredentialsDto;

  @IsArray()
  @IsOptional()
  @IsIn(AI_EVENT_SCHEDULE_KEYS, { each: true })
  events?: ReolinkFtpEventType[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceChannelFtpEventDto)
  @IsOptional()
  channelConfigs?: DeviceChannelFtpEventDto[];

  @IsBoolean()
  @IsOptional()
  onlyFtps?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  nvrChannelCount?: number;

  @ValidateNested()
  @Type(() => PipelineFtpDto)
  ftp!: PipelineFtpDto;
}

// POST /reolink/control/pipeline/stop 请求体
export class StopPipelineDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  nvrChannelCount?: number;

  @ValidateNested()
  @Type(() => DeviceCredentialsDto)
  device!: DeviceCredentialsDto;
}

// POST /reolink/control/pipeline/channels/delete 请求体
export class DeletePipelineChannelsDto {
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @IsOptional()
  channels?: number[];

  @IsInt()
  @Min(1)
  @IsOptional()
  nvrChannelCount?: number;

  @ValidateNested()
  @Type(() => DeviceCredentialsDto)
  device!: DeviceCredentialsDto;
}

// POST /reolink/control/pipeline/channels/add 管道运行中追加监听通道
export class AddPipelineChannelsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  channels!: number[];

  @ValidateNested()
  @Type(() => DeviceCredentialsDto)
  device!: DeviceCredentialsDto;

  @IsArray()
  @IsOptional()
  @IsIn(AI_EVENT_SCHEDULE_KEYS, { each: true })
  events?: ReolinkFtpEventType[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceChannelFtpEventDto)
  @IsOptional()
  channelConfigs?: DeviceChannelFtpEventDto[];

  @IsBoolean()
  @IsOptional()
  onlyFtps?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  nvrChannelCount?: number;
}

export class ListEventsQueryDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;
}
