// R1c（M1 の見直し Minor 1・2・8）: controls（input/controls.js）の DOM 側の薄い層。画面の指・マウスの知らせを controls へつなぐ。
// main.js から出して、配線そのものを試せるようにした（tests/input/bindDom.test.js）。
//  - 一つの時計: 入力の時刻も毎フレームの update も performance.now() の時計（eventMs）。古い WebKit の timeStamp は
//    エポックの ms なので timeOrigin を引いて戻す（長押しが時間でスティックになるように）
//  - PC の右クリックは払う（左を押したままの右は pointerdown にならないので mousedown でも受ける）。
//    溜めの指の pointerup は、どのボタンでも controls.up へ（左を押したまま右クリックし、左を先に離しても放つ）。
//    左が先に離れたことは、buttons から左が消えた pointermove（chorded）と mouseup の左で知り、その場で放つ
//  - pointercancel・キャプチャが外れたら放たずに打ち切る（放つのは離したときだけ）

// 入力の時刻（ms、performance.now() と同じ時計）。無い・0・今より先なら今
export function eventMs(e, perf = globalThis.performance) {
  const now = perf.now();
  let t = e?.timeStamp;
  if (!Number.isFinite(t) || t <= 0) return now;
  // 古い WebKit: エポックからの ms（今の performance.now() よりはるかに大きい）
  if (t > 1e11) t -= Number.isFinite(perf.timeOrigin) ? perf.timeOrigin : Date.now() - now;
  return t > now || t < 0 ? now : t;
}

// target: 画面（canvas）。controls: createControls の戻り値。puff(x, y): 右クリックの払う。
// intercept(e, ms): pointerdown を先に受け取る所（導入・リプレイ）。true を返せば controls へ渡さない
export function bindPointerInput(target, { controls, puff = () => {}, intercept = () => false, perf = globalThis.performance }) {
  const sec = (e) => eventMs(e, perf) / 1000;
  const isMouse = (e) => e.pointerType === 'mouse';
  let mouseId = null; // マウスの pointerId（mouseup には pointerId が無い）
  const release = (id, e) => controls.up(id, e.clientX, e.clientY, sec(e));
  const on = {
    pointerdown(e) {
      if (isMouse(e)) mouseId = e.pointerId;
      if (isMouse(e) && e.button === 2) { puff(e.clientX, e.clientY); return; }
      if (isMouse(e) && e.button !== 0) return;
      if (intercept(e, eventMs(e, perf))) return;
      // キャプチャに失敗しても（もう離した指・一部のブラウザ）押下は始める
      try { target.setPointerCapture?.(e.pointerId); } catch { /* キャプチャなしで続ける */ }
      controls.down(e.pointerId, e.clientX, e.clientY, sec(e));
    },
    // 左を押したままの右ボタン（chorded）: 溜めている間なら払う
    mousedown(e) { if (e.button === 2 && e.buttons & 1) puff(e.clientX, e.clientY); },
    // 左を先に離した（右はまだ押している）: mouseup の左
    mouseup(e) { if (e.button === 0 && mouseId !== null && controls.chargeId === mouseId) release(mouseId, e); },
    pointermove(e) {
      // chorded: 溜めのマウスの左が buttons から消えた → 離した
      if (isMouse(e) && e.pointerId === controls.chargeId && !(e.buttons & 1)) { release(e.pointerId, e); return; }
      controls.move(e.pointerId, e.clientX, e.clientY, sec(e));
    },
    pointerup(e) {
      // 溜めの指ではない右ボタンの離す操作は捨てる（右クリックの払うは押したときに済んでいる）
      if (isMouse(e) && e.button === 2 && e.pointerId !== controls.chargeId) return;
      release(e.pointerId, e);
    },
    pointercancel(e) { controls.cancel(e.pointerId); },
    // キャプチャが外れたら押下を打ち切る（離した後に来る分は何もしない。放つのは離したときだけ）
    lostpointercapture(e) { controls.cancel(e.pointerId); },
  };
  for (const [type, fn] of Object.entries(on)) target.addEventListener(type, fn);
  return {
    // 毎フレームの controls.update に渡す今の時刻（秒。入力と同じ時計）
    now: () => perf.now() / 1000,
    detach() { for (const [type, fn] of Object.entries(on)) target.removeEventListener?.(type, fn); },
  };
}
