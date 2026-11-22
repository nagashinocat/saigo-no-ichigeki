// R1c: input/bindDom.js を試す身代わりの画面と時計（bindDom.test.js・introFlow.test.js が使う）
// 身代わりの時計と画面: perf.now() は ms。timeOrigin は古い WebKit のエポックの timeStamp を戻すのに使う
export function fakeDom({ timeOrigin = 1.7e12 } = {}) {
  let ms = 1000;
  const perf = { now: () => ms, timeOrigin };
  const handlers = {};
  const captured = new Set();
  const target = {
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] ?? []).filter((f) => f !== fn); },
    setPointerCapture(id) { captured.add(id); },
  };
  const fire = (type, props = {}) => {
    const e = { type, pointerId: 1, pointerType: 'touch', button: 0, buttons: 0, clientX: 100, clientY: 100, timeStamp: ms, ...props };
    for (const fn of handlers[type] ?? []) fn(e);
    return e;
  };
  return { perf, target, fire, captured, advance: (sec) => { ms += sec * 1000; }, get ms() { return ms; } };
}
