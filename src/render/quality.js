// 画質の段階と、FPS による自動調整(純粋なロジック。DOM には触れない)

export const TIERS = {
  high: { pixelRatioMax: 2, debrisMax: 6000, nearPhysicsMax: 400, piecesPerBuilding: 24, dustMax: 3000, rubbleMax: 3000, auraMax: 48, auraShell: true, bloom: true, heatHaze: true, shadows: true },
  mid: { pixelRatioMax: 1.5, debrisMax: 2500, nearPhysicsMax: 120, piecesPerBuilding: 12, dustMax: 1200, rubbleMax: 1500, auraMax: 24, auraShell: true, bloom: true, heatHaze: false, shadows: false },
  low: { pixelRatioMax: 1, debrisMax: 800, nearPhysicsMax: 40, piecesPerBuilding: 6, dustMax: 400, rubbleMax: 600, auraMax: 10, auraShell: false, bloom: false, heatHaze: false, shadows: false },
};

export function pickTier({ isMobile, deviceMemory, cores } = {}) {
  if (!isMobile) return 'high';
  if (deviceMemory !== undefined && deviceMemory < 4) return 'low';
  if (cores !== undefined && cores <= 4) return 'low';
  return 'mid';
}

export function nextTier(tier) {
  if (tier === 'high') return 'mid';
  return 'low';
}

const WINDOW_SEC = 0.5;

export function createFpsGovernor({ target, holdSec = 2 }) {
  const frames = [];
  let head = 0;
  let sum = 0;
  let below = 0;

  return {
    sample(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return null;
      frames.push(dt);
      sum += dt;
      while (frames.length - head > 1 && sum - frames[head] >= WINDOW_SEC) {
        sum -= frames[head++];
      }
      if (head > 64) { frames.splice(0, head); head = 0; }
      const avgFps = (frames.length - head) / sum;
      if (avgFps >= target) {
        below = 0;
        return null;
      }
      below += dt;
      if (below >= holdSec) {
        below = 0;
        return 'down';
      }
      return null;
    },
  };
}
