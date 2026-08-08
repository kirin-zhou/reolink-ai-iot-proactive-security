import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import * as fs from "fs";
import * as path from "path";
import { EventAggregator } from "../pipeline/event-aggregator";
import { buildEventMeta } from "../pipeline/event-meta.builder";
import { formatLocalDateTime } from "../pipeline/reolink-filename.utils";
import { imageMimeType } from "../pipeline/reolink-filename.utils";
import {
  AggregatedEvent,
  FinalizeReason,
  PipelineConfig,
  ReolinkAnalysisRecord,
} from "../reolink.types";
import {
  ReolinkVisionService,
} from "../vision/reolink-vision.service";

export const REOLINK_EVENT_FINALIZED = "reolink.event.finalized";

@Injectable()
export class ReolinkEventPipelineService {
  private aggregators = new Map<number, EventAggregator>(); 
  private disabledChannels = new Set<number>();
  private finalizeTimer: ReturnType<typeof setInterval> | null = null;
  private config: PipelineConfig | null = null;
  private records = new Map<string, ReolinkAnalysisRecord>();
  private stats = {
    uploadsReceived: 0,
    eventsFinalized: 0,
    analysesCompleted: 0,
    analysesFailed: 0,
  };

  constructor(
    private readonly visionService: ReolinkVisionService,
    private readonly eventEmitter: EventEmitter2,
    @InjectPinoLogger(ReolinkEventPipelineService.name)
    private readonly logger: PinoLogger,
  ) {}

  getStats() {
    return { ...this.stats };
  }

  listEvents(limit = 50): ReolinkAnalysisRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.request_event_meta.last_mtime - a.request_event_meta.last_mtime) // 按事件结束时间倒序
      .slice(0, limit);
  }

  getEvent(eventId: string): ReolinkAnalysisRecord | undefined {
    return this.records.get(eventId);
  }

  start(config: PipelineConfig): void {
    this.config = config;
    this.aggregators.clear();
    this.disabledChannels.clear();
    this.stats = {
      uploadsReceived: 0,
      eventsFinalized: 0,
      analysesCompleted: 0,
      analysesFailed: 0,
    };

    fs.mkdirSync(path.resolve(config.analysisDir), { recursive: true });

    this.finalizeTimer = setInterval(() => {
      for (const agg of this.aggregators.values()) {
        agg.pollFinalize();
      }
    }, 500);
  }

  stop(): void {
    if (this.finalizeTimer) {
      clearInterval(this.finalizeTimer);
      this.finalizeTimer = null;
    }

    for (const agg of this.aggregators.values()) {
      agg.flush();
    }
    this.aggregators.clear();
    this.disabledChannels.clear();
    this.config = null;
  }

  stopChannels(channels: number[]): void {
    for (const channel of channels) {
      const agg = this.aggregators.get(channel);
      if (agg) {
        agg.flush();
        this.aggregators.delete(channel);
      }
      this.disabledChannels.add(channel);
    }
  }

  startChannels(channels: number[]): void {
    for (const channel of channels) {
      this.disabledChannels.delete(channel);
    }
  }

  hasActiveChannels(
    watchChannels: Set<number> | null,
    excludedChannels: Set<number>,
  ): boolean {
    if (watchChannels === null) {
      return true;
    }
    return [...watchChannels].some((ch) => !excludedChannels.has(ch));
  }


  handleUpload(params: {
    filePath: string;
    channel: number;
    mtime: number;
  }): void {
    if (!this.config || this.disabledChannels.has(params.channel)) {
      return;
    }

    this.stats.uploadsReceived += 1;
    const agg = this.getAggregator(params.channel);
    agg.addImage(params.filePath, params.mtime);
  }

  private getAggregator(channel: number): EventAggregator {
    let agg = this.aggregators.get(channel);
    if (!agg) {
      const config = this.config!;
      agg = new EventAggregator(
        config.aggregation.gapSeconds,
        config.aggregation.finalizeDelaySeconds,
        config.aggregation.maxDurationSeconds,
        (event, reason) => {
          void this.onEventFinalized(channel, event, reason);
        },
      );
      this.aggregators.set(channel, agg);
    }
    return agg;
  }

  private async onEventFinalized(
    channel: number,
    event: AggregatedEvent,
    reason: FinalizeReason,
  ): Promise<void> {
    const config = this.config;
    if (!config) {
      return;
    }

    this.stats.eventsFinalized += 1;

    this.logger.info(
      {
        channel,
        reason,
        frameCount: event.frames.length,
        first: formatLocalDateTime(new Date(event.firstMtime * 1000)),
        last: formatLocalDateTime(new Date(event.lastMtime * 1000)),
      },
      "Event aggregated",
    );

    if (reason === "shutdown") {
      this.logger.info("Skipping analysis on shutdown");
      return;
    }

    const { eventMeta, sampled } = buildEventMeta({
      event,
      reason,
      channel,
      watchDir: path.resolve(config.watchDir),
      maxSamples: config.sampling.maxFrames,
    });

    if (!sampled.length) {
      this.logger.warn({ eventId: eventMeta.event_id }, "Sampled frames empty");
      return;
    }

    let record: ReolinkAnalysisRecord = {
      saved_at_local: formatLocalDateTime(new Date()),
      event_id: eventMeta.event_id,
      channel,
      finalize_reason: reason,
      request_event_meta: eventMeta,
    };

    if (!config.analysisEnabled) {
      this.persistRecord(record, config.analysisDir);
      this.records.set(eventMeta.event_id, record);
      this.eventEmitter.emit(REOLINK_EVENT_FINALIZED, record);
      return;
    }

    try {
      const images = sampled.map((filePath) => ({
        buffer: fs.readFileSync(filePath),
        mimeType: imageMimeType(filePath),
      }));

      const result = await this.visionService.analyzeImages(
        images,
        eventMeta as unknown as Record<string, unknown>,
      );

      // 合并 LLM 分析结果
      record = {
        ...record,
        analysis: result.analysis, 
        rawContent: result.rawContent,
        model: result.model,
        usage: result.usage,
      };
      this.stats.analysesCompleted += 1;
      this.logger.info(
        { eventId: eventMeta.event_id, model: result.model },
        "Event analysis completed",
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      record.error = err;
      this.stats.analysesFailed += 1;
      this.logger.error(
        { eventId: eventMeta.event_id, err },
        "Event analysis failed",
      );
    }

    this.persistRecord(record, config.analysisDir);
    this.records.set(eventMeta.event_id, record);
    this.eventEmitter.emit(REOLINK_EVENT_FINALIZED, record);
  }

  private persistRecord(record: ReolinkAnalysisRecord, analysisDir: string): void {
    const dir = path.resolve(analysisDir);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${record.event_id}.json`);
    fs.writeFileSync(out, JSON.stringify(record, null, 2), "utf-8");
    this.logger.debug({ path: out }, "Analysis record saved");
  }
}
