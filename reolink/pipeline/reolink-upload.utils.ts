import * as fs from "fs";
import * as path from "path";
import { IMAGE_SUFFIXES, MEDIA_SUFFIXES, VIDEO_SUFFIXES } from "../reolink.constants";

export function iterUploadedMedia(watchDir: string): string[] {
  if (!fs.existsSync(watchDir)) {
    return [];
  }

  const results: { path: string; mtime: number }[] = [];

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (MEDIA_SUFFIXES.has(ext)) {
          const stat = fs.statSync(fullPath);
          results.push({ path: fullPath, mtime: stat.mtimeMs });
        }
      }
    }
  };

  walk(watchDir);
  results.sort((a, b) => a.mtime - b.mtime);

  return results.map((r) => r.path);
}


export async function waitUntilFileStable(
  filePath: string,
  stableChecks = 3,
  checkIntervalMs = 300,
): Promise<boolean> {
  let unchangedCount = 0;
  let lastSize = -1;

  while (fs.existsSync(filePath)) {
    const currentSize = fs.statSync(filePath).size;
    if (currentSize > 0 && currentSize === lastSize) {
      unchangedCount += 1;
      if (unchangedCount >= stableChecks) {
        return true;
      }
    } else {
      unchangedCount = 0;
      lastSize = currentSize;
    }
    await sleep(checkIntervalMs);
  }

  return false;
}


export async function waitUntilUploadedMediaComplete(
  filePath: string,
): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_SUFFIXES.has(ext)) {
    return waitUntilFileStable(filePath, 8, 1000);
  }
  return waitUntilFileStable(filePath);
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_SUFFIXES.has(path.extname(filePath).toLowerCase());
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
