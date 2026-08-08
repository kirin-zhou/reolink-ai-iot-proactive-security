# Reolink AI IoT Proactive Security

## 1. Feature Overview

A proactive smart-home security system based on **Reolink NVR/camera integration**, **FTP event collection**, **event aggregation**, and **multimodal Large Language Model (LLM) analysis**.

The system transforms conventional motion and AI detection alerts from Reolink cameras into context-aware security events. Instead of treating every camera detection as a security incident, it aggregates related snapshots, samples representative frames, and uses a multimodal LLM to determine whether the event actually requires attention.

Key Features:

| **Feature**               |  **Description**                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Reolink FTP Configuration | Configure NVR FTP behaviour through Reolink CGI APIs such as `Login`, `GetFtpV20`, `SetFtpV20`, and `TestFtp` |
| Local FTP Receiver        | Receive Reolink alert snapshots using an `ftp-srv` server in passive mode                                     |
| Event Aggregation         | Group consecutive snapshots from the same channel into a single security event                                |
| Frame Sampling            | Select representative images from an event before LLM analysis                                                |
| Multimodal LLM Analysis   | Analyse multiple camera frames and determine whether security intervention is required                        |
| Multi-channel Management  | Start, stop, add, or remove monitored Reolink channels dynamically                                            |
| Pipeline State Management | Supports `STOPPED`, `ARMED`, and `MONITORING` states                                                          |
| Vision REST API           | Analyse uploaded images through multipart or Base64 APIs without requiring the full camera pipeline           |
| Event Persistence         | Store the LLM analysis result for every completed event as JSON                                               |

---

## 2. System Architecture

```text
┌─────────────┐       CGI SetFtpV20       ┌────────────────────┐
│ Reolink NVR │ ────────────────────────► │ Local AI FTP Server│
│             │      FTP JPG upload       │   ftp-srv: 2121    │
└─────────────┘                           └──────────┬─────────┘
                                                     │
                                                     │ Directory polling
                                                     ▼
                                        ┌────────────────────────┐
                                        │     EventPipeline      │
                                        │                        │
                                        │ Aggregate → Sample     │
                                        │          → LLM         │
                                        └───────────┬────────────┘
                                                    │
                                  ┌─────────────────┴─────────────────┐
                                  ▼                                   ▼
                          analysis/*.json                    Vision REST API
```

---

## 3. End-to-End Workflow

### 3.1 Start Monitoring (`MONITORING`)

1. Call `POST /reolink/control/pipeline/start`
2. If `device` is provided, log in to the NVR and execute `SetFtpV20` for the target channels:

   * `enable=1` (global FTP master switch)
   * `scheduleEnable=1` (channel schedule enabled)
   * Optional: enable the alert schedule table according to `events` / `channelConfigs`
3. Start the local FTP Server and poll the upload directory

### 3.2 Standby Start (`ARMED`)

When `channels: []` and `device` is provided:

* NVR: `enable=1`, `scheduleEnable=0` (master switch on, channel schedule off)
* Local machine: FTP Server is running, but no channels are being monitored
* State: `ARMED`, and monitoring can later be started through `channels/add`

### 3.3 Alert Processing

1. The NVR triggers AI person / vehicle / pet detection or MD, and uploads JPG images through FTP according to the schedule
2. The filename must match the channel rule: `test1_{two-digit channel}_{14-digit timestamp}.jpg` (e.g. `test1_01_20260714171805.jpg`)
3. The receiver waits until the file size becomes stable, then passes the image to the corresponding channel
4. Continuous frames from the same channel are aggregated into one alert event based on time
5. After the event ends, uniformly sample frames (up to 5 images) → LLM analysis → write to `analysisDir/{event_id}.json`

### 3.4 Disarm / Exit

| Scenario                              | Behaviour                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pipeline/stop`                       | Disable all channel schedules + clear global `enable`, stop the FTP Server and channels           |
| `channels/delete` (specified channel) | Disable only the corresponding channel schedule, while keeping global `enable` and the FTP Server |
| Process exit (`Ctrl+C` / `SIGTERM`)   | Automatically clear NVR FTP and stop local channels                                               |

---

## 4. NVR FTP Alert Event Types (`schedule.table`)

| Key          | Meaning          | Default        |
| ------------ | ---------------- | -------------- |
| `AI_PEOPLE`  | AI Person        | Can be enabled |
| `AI_VEHICLE` | AI Vehicle       | Can be enabled |
| `AI_DOG_CAT` | AI Pet           | Can be enabled |
| `MD`         | Motion Detection | Can be enabled |

---

## 5. Event Aggregation and Sampling

### 5.1 Aggregation Rules (Independent `EventAggregator` for Each Channel)

| Parameter              | Default Value | Meaning                                                                                         |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `gapSeconds`           | 20s           | If the interval between two adjacent images exceeds this value → end the previous event (`gap`) |
| `finalizeDelaySeconds` | 17s           | If the silence period after the last image reaches this value → end the event (`quiet`)         |
| `maxDurationSeconds`   | 60s           | Maximum span of a single event → end the event (`max_duration`)                                 |

Finalization reason `FinalizeReason`: `gap` | `max_duration` | `quiet` | `shutdown`

### 5.2 Sampling Rules

* Number of frames ≤ `maxFrames` (default 5): send all frames
* Number of frames > 5: uniform quantile sampling (first / approximately 25% / 50% / 75% / last); if deduplication results in insufficient frames, fill from the middle toward both sides

---

## 6. LLM Vision Analysis

### 6.1 Model and Environment

| Item          | Description                                   |
| ------------- | --------------------------------------------- |
| Model         | `REOLINK_VISION_MODEL`, default `gpt-4o-mini` |
| API Key       | `OPENAI_API_KEY` must be set                  |
| Output Format | `json_object`                                 |

### 6.2 Decision Criteria (Summary)

**Scenarios tending toward ****`security_required = true`****:**

* Suspicious intrusion / reconnaissance / intentionally covering the face combined with abnormal behaviour
* Armed threats (knives, scissors, or other sharp objects, considered together with posture and scene)
* Pet falling into water / drowning risk (`event_key` is `dog_cat`)
* Fighting, falling to the ground, open flames or heavy smoke, theft, vandalism, etc.

**`security_required = false`**: 
* Normal passing, normal pet activity, leaves or light/shadow movement, no obvious threat

### 6.3 Output JSON Fields

| Field                | Type             | Description                                                                                            |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `security_required`  | boolean          | Whether security attention is required                                                                 |
| `frame_analysis`     | string (Chinese) | Detailed frame-by-frame visual record, which must be provided regardless of whether danger is detected |
| `danger_summary`     | string (Chinese) | Dangerous frame range, time reference, and recording window extension description                      |
| `confidence`         | number [0,1]     | Confidence in `security_required`                                                                      |
| `danger_frame_start` | int | null       | Starting dangerous frame                                                                               |
| `danger_frame_end`   | int | null       | Ending dangerous frame                                                                                 |
| `clip_start`         | string | null    | Recommended recording start time `YYYY-MM-DD HH:MM:SS`                                                 |
| `clip_end`           | string | null    | Recommended recording end time; the security recording window must be > 10 seconds                     |
| `event_key`          | string | null    | Dangerous event type                                                                                   |

### 6.4 Persisted Analysis Record `ReolinkAnalysisRecord`

Path: `{analysisDir}/{event_id}.json` (default `src/reolink/analysis`)

`event_id` format: `event_YYYYMMDD_HHMMSS_{8-digit hex}`

---

## 7. REST API

Responses are uniformly wrapped using the project's common `ResponseBody` (success code `T_20000`)

| Method | Path                                        | Description                                       |
| ------ | ------------------------------------------- | ------------------------------------------------- |
| POST   | `/reolink/control/pipeline/start`           | Enable the FTP master switch                      |
| POST   | `/reolink/control/pipeline/stop`            | Disable the FTP master switch                     |  
| POST   | `/reolink/control/pipeline/channels/add`    | Add channels while running                        |              
| POST   | `/reolink/control/pipeline/channels/delete` | Disable specified channels while running          |                       
| GET    | `/reolink/control/pipeline/status`          | Query channel status and statistics               |                       
| POST   | `/reolink/control/device/ftp/get`           | Read single-channel configuration using GetFtpV20 |                       
| POST   | `/reolink/control/device/ftp/configure`     | Configure the upload destination and event table  |                       
| POST   | `/reolink/control/device/ftp/test`          | TestFtp                                           | 
| GET    | `/reolink/control/events?limit=50`          | Recent event list                                 |                       
| GET    | `/reolink/control/events/:eventId`          | Single event details                              |
| POST   | `/reolink/vision/analyze`                   | Multipart analysis                                |
| POST   | `/reolink/vision/analyze-json`              | Base64 image analysis                             |

---

## 8. Default Configuration Overview

| Configuration Item                   | Default Value             |
| ------------------------------------ | ------------------------- |
| FTP Listen                           | `0.0.0.0:2121`            |
| Passive Port Range                   | `20000–20100`             |
| Passive Mode                         | Enabled (`mode=2`)        |
| Upload Root Directory                | `reolink/ftp_uploads`     |
| Analysis Directory                   | `reolink/analysis`        |
| NVR Channel Count                    | 4                         |
| Snapshot Resolution `picCaptureMode` | 2 (Fluent)                |
| Continuous Snapshot Interval         | 3 seconds                 |
| Stream Type `streamType`             | 3 (images only)           |
| Directory Polling Interval           | 0.5 seconds               |
| Maximum LLM Sample Frames            | 5                         |
| Process Existing Files at Startup    | false                     |

---

## 9. Directory and Source Code Structure

```text
reolink/
├── reolink.module.ts          # Nest module assembly
├── reolink.constants.ts       # Default constants and event types
├── reolink.types.ts           # Shared types
├── control/                   # REST orchestration API
├── device/                    # NVR CGI client
├── ftp/                       # Local FTP reception
├── pipeline/                  # Aggregation / sampling / metadata / upload utilities
└── vision/                    # Multimodal LLM analysis API
```

Runtime outputs:

* `reolink/ftp_uploads/`   # FTP uploaded images
* `reolink/analysis/`      # Analysis JSON for each event

