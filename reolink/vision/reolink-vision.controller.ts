import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import {
  ResponseBody,
  ResponseMeta_IoTServer,
  createResponseBody,
} from "../../common/response.model";
import { ReolinkVisionAnalyzeJsonDto } from "./dto/analyze-json.dto";
import { ReolinkVisionService } from "./reolink-vision.service";


export type ReolinkVisionAnalyzeResponseData = {
  model: string;
  analysis: unknown; // 解析后的 JSON
  rawContent: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: number;
    currency: string;
  };
};

// Reolink 视觉分析
@Controller("reolink/vision")
export class ReolinkVisionController {
  constructor(
    private readonly reolinkVisionService: ReolinkVisionService,
    @InjectPinoLogger(ReolinkVisionController.name)
    private readonly logger: PinoLogger,
  ) {}


  // POST /reolink/vision/analyze-json
  @Post("analyze-json")
  async analyzeJson( // 异步
    @Body() dto: ReolinkVisionAnalyzeJsonDto,
  ): Promise<ResponseBody<ReolinkVisionAnalyzeResponseData>> {
    const images = dto.imagesBase64.map((img) => ({
      buffer: Buffer.from(img.data, "base64"),
      mimeType: img.mimeType,
    }));
    const result = await this.reolinkVisionService.analyzeImages(
      images,
      dto.eventMeta,
    );
    return createResponseBody(ResponseMeta_IoTServer.T_20000, result);
  }


  // POST /reolink/vision/analyze
  @Post("analyze")
  async analyzeMultipart(
    @Req() req: FastifyRequest,
  ): Promise<ResponseBody<ReolinkVisionAnalyzeResponseData>> {
    if (typeof req.parts !== "function") {
      throw new BadRequestException("Multipart is not enabled on this server");
    }

    let eventMeta: Record<string, unknown> | undefined;
    const imageParts: { buffer: Buffer; mimeType: string }[] = [];

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "images") {
          this.logger.warn(`Skipping unexpected file field: ${part.fieldname}`);
          continue;
        }
        const buffer = await part.toBuffer();
        const mimeType = part.mimetype || "image/jpeg";
        imageParts.push({ buffer, mimeType });
      } else if (part.type === "field") {
        if (part.fieldname === "eventMeta") {
          const raw = String(part.value ?? "").trim();
          if (raw) {
            try {
              eventMeta = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              throw new BadRequestException("eventMeta must be valid JSON");
            }
          }
        }
      }
    }

    if (!imageParts.length) {
      throw new BadRequestException('Missing one or more file parts field "images"');
    }

    const result = await this.reolinkVisionService.analyzeImages(
      imageParts,
      eventMeta,
    );
    return createResponseBody(ResponseMeta_IoTServer.T_20000, result);
  }
}
