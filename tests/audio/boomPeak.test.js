// 出口の最大値（S3 の取り決め「割れない」）: いちばん重い場面（最後の一発 + 地響き + 瓦礫を毎フレーム多数 + 最高潮の BGM の
// 大きさの音）と、ふつうの段取り通しを、本物の Chrome の OfflineAudioContext でゲームと同じ audio.js から鳴らし、
// 出口の標本が 1 に届かないことを確かめる（scripts/boomRender.mjs。Chrome が無い環境では飛ばす）。
import { test, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { finaleScenes, renderScenes, CHROME } from '../../scripts/boomRender.mjs';

const hasChrome = existsSync(CHROME);

test.skipIf(!hasChrome)('最大の場面と段取り通しの出口の標本の最大値は 1 未満（0.999 に触れる標本なし）', async () => {
  const { scenes } = finaleScenes();
  const pick = scenes.filter((s) => s.name === 'stress' || s.name === 'final');
  const out = await renderScenes(pick, { SR: 24000 });
  expect(out.map((o) => o.name).sort()).toEqual(['final', 'stress']);
  for (const { name, left, right } of out) {
    let p = 0, clip = 0, energy = 0;
    for (let i = 0; i < left.length; i++) {
      const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      p = Math.max(p, v); if (v >= 0.999) clip++;
      energy += left[i] * left[i];
    }
    expect(energy, `${name} は鳴っている`).toBeGreaterThan(100);
    expect(p, `${name} の最大値`).toBeLessThan(1);
    expect(clip, `${name} の 0.999 以上の標本`).toBe(0);
  }
}, 120000);
