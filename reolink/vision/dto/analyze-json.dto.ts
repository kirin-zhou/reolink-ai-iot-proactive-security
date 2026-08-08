// 数据传输对象 DTO
import { Type } from "class-transformer";
import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,   // 嵌套对象
} from "class-validator";

export class ReolinkVisionImageBase64Dto {
  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsString()
  @IsNotEmpty()
  data!: string;
}

export class ReolinkVisionAnalyzeJsonDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReolinkVisionImageBase64Dto)
  imagesBase64!: ReolinkVisionImageBase64Dto[];

  @IsOptional()
  @IsObject()
  eventMeta?: Record<string, unknown>;
}
