import { Module } from "@nestjs/common";
import { ReolinkControlController } from "./control/reolink-control.controller";
import { ReolinkControlService } from "./control/reolink-control.service";
import { ReolinkDeviceClient } from "./device/reolink-device.client";
import { ReolinkFtpReceiverService } from "./ftp/reolink-ftp-receiver.service";
import { ReolinkEventPipelineService } from "./pipeline/reolink-event-pipeline.service";
import { ReolinkVisionController } from "./vision/reolink-vision.controller";
import { ReolinkVisionService } from "./vision/reolink-vision.service";

@Module({
  controllers: [ReolinkVisionController, ReolinkControlController],
  providers: [
    ReolinkVisionService,
    ReolinkDeviceClient,
    ReolinkFtpReceiverService,
    ReolinkEventPipelineService,
    ReolinkControlService,
  ],
  exports: [
    ReolinkVisionService,
    ReolinkControlService,
    ReolinkEventPipelineService,
  ],
})
export class ReolinkModule {}
