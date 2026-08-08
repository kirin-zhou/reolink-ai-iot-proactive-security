export function sampleEventFrames(
  frames: string[],
  maxSamples: number,
): string[] {
  if (maxSamples <= 0) {
    return [];
  }

  const n = frames.length;
  if (n <= maxSamples) {
    return [...frames];
  }
  if (maxSamples === 1) {
    return [frames[0]];
  }

  const lastIdx = n - 1;
  const picked: number[] = [];

  /**
   按抽样数量生成等间距位置：
   frames = [0,1,2,3,4,5,6,7,8], 图片总数 n = 9, maxSamples = 5
   最后一张索引 lastIdx = 8
   计算 5 个均匀位置：
      i=0: pos = 0 * 8 / 4 = 0   -> idx 0
      i=1: pos = 1 * 8 / 4 = 2   -> idx 2
      i=2: pos = 2 * 8 / 4 = 4   -> idx 4
      i=3: pos = 3 * 8 / 4 = 6   -> idx 6
      i=4: pos = 4 * 8 / 4 = 8   -> idx 8
   picked = [0, 2, 4, 6, 8]
   */
  for (let i = 0; i < maxSamples; i++) {
    const pos = (i * lastIdx) / (maxSamples - 1);
    let idx = Math.floor(pos + 0.5);

    if (idx < 0) {
      idx = 0;
    } else if (idx > lastIdx) {
      idx = lastIdx;
    }
    if (!picked.length || picked[picked.length - 1] !== idx) {
      picked.push(idx);
    }
  }

  if (picked.length < maxSamples) {
    const used = new Set(picked);
    const center = lastIdx / 2;
    const candidates = Array.from({ length: n }, (_, j) => j)
      .filter((j) => !used.has(j))
      .sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);

    for (const j of candidates) {
      picked.push(j);
      if (picked.length >= maxSamples) {
        break;
      }
    }
    picked.sort((a, b) => a - b);
    const unique = [...new Set(picked)];
    return unique.map((i) => frames[i]);
  }

  return picked.map((i) => frames[i]);
}
