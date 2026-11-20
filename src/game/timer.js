export function createTimer(seconds) {
  let remaining = seconds;
  let paused = false;
  return {
    update(dt) { if (!paused) remaining = Math.max(0, remaining - dt); },
    pause() { paused = true; },
    resume() { paused = false; },
    isOver() { return remaining <= 0; },
    get remaining() { return remaining; },
    get paused() { return paused; },
  };
}
