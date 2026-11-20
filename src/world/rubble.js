// 止まった破片を、静かな瓦礫として残す。three には依存しない。
// 置いた瓦礫は動かさない（毎フレームの計算はない）。描く側には、変わった slot だけを takeChanges で知らせる。
// slot は置いた順に 0..limit-1 を輪のように使うので、次に使う slot にいるのがいつも一番古い瓦礫になる。
// 上限まで埋まったら、古いものから土煙（DustEvent）にして置き換える。穴が広がって下の地面がなくなった瓦礫も消す（sweep）。
// add: { pos, rot: [x,y,z]（オイラー角）, dims: [w,h,d], size, color: [r,g,b] }

const SWEEP_MARGIN = 0.5; // m。穴の面が瓦礫の底からこれ以上下がったら呑まれたとする

export function createRubble(capacity) {
  const F = () => new Float32Array(capacity);
  const data = {
    px: F(), py: F(), pz: F(), rx: F(), ry: F(), rz: F(),
    sx: F(), sy: F(), sz: F(), cr: F(), cg: F(), cb: F(), size: F(),
    reach: F(), // 中心からの距離 + 厚みの半分 + 余裕。穴の半径がこれを超えたら呑まれる
  };
  const seq = new Uint32Array(capacity); // 置いた順の番号。0 = 空き
  const FIELDS = Object.keys(data);
  let next = 0, counter = 0, count = 0, limit = capacity, highWater = 0;
  let minReach = Infinity; // これより小さい穴では sweep は何もしない（走査もしない）
  const dirty = new Set();

  const dustOf = (s) => ({ pos: [data.px[s], data.py[s], data.pz[s]], size: data.size[s] });
  const remove = (s, out) => {
    out?.push(dustOf(s));
    seq[s] = 0;
    count--;
    dirty.add(s);
  };

  return {
    data,
    get count() { return count; },
    get capacity() { return capacity; },
    isLive(s) { return seq[s] !== 0; },
    // 画質が下がったときの上限。下げたら古いものから消して残りを前へ詰め、その DustEvent を返す
    setLimit(n) {
      const lim = Math.max(1, Math.min(capacity, Math.floor(n)));
      const out = [];
      if (lim < limit) {
        const live = [];
        for (let s = 0; s < highWater; s++) if (seq[s]) live.push(s);
        live.sort((a, b) => seq[a] - seq[b]);
        const drop = Math.max(0, live.length - lim);
        for (let i = 0; i < drop; i++) remove(live[i], out);
        const keep = live.slice(drop);
        // 前へ詰める（古い順に 0..）。輪が一周していると詰める先に別の残す瓦礫がいるので、先に写してから書く
        const copy = keep.map((s) => [FIELDS.map((k) => data[k][s]), seq[s]]);
        for (const s of keep) { seq[s] = 0; dirty.add(s); }
        copy.forEach(([vals, q], i) => {
          FIELDS.forEach((k, j) => { data[k][i] = vals[j]; });
          seq[i] = q;
          dirty.add(i);
        });
        highWater = Math.min(highWater, lim);
        next = keep.length % lim;
      }
      limit = lim;
      return out;
    },
    add(p, dustOut) {
      if (next >= limit) next = 0;
      const s = next;
      next = (next + 1) % limit;
      if (seq[s]) remove(s, dustOut); // 一番古い瓦礫を置き換える
      const d = data;
      d.px[s] = p.pos[0]; d.py[s] = p.pos[1]; d.pz[s] = p.pos[2];
      d.rx[s] = p.rot[0]; d.ry[s] = p.rot[1]; d.rz[s] = p.rot[2];
      d.sx[s] = p.dims[0]; d.sy[s] = p.dims[1]; d.sz[s] = p.dims[2];
      d.cr[s] = p.color[0]; d.cg[s] = p.color[1]; d.cb[s] = p.color[2];
      d.size[s] = p.size;
      d.reach[s] = Math.hypot(p.pos[0], p.pos[1], p.pos[2]) + p.size * 0.5 + SWEEP_MARGIN;
      minReach = Math.min(minReach, d.reach[s]);
      seq[s] = ++counter;
      count++;
      highWater = Math.max(highWater, s + 1);
      dirty.add(s);
    },
    // 穴（原点中心の球の下半分）の半径が crater まで広がった。下の地面がなくなった瓦礫を消し、DustEvent を返す
    sweep(crater) {
      const out = [];
      if (!(crater > minReach)) return out;
      minReach = Infinity;
      for (let s = 0; s < highWater; s++) {
        if (!seq[s]) continue;
        if (data.reach[s] < crater) remove(s, out);
        else minReach = Math.min(minReach, data.reach[s]);
      }
      return out;
    },
    // 前回から変わった slot（置いた・消えた・詰めた）と、描く数。呼ぶと変更の印は消える
    takeChanges() {
      const slots = [...dirty];
      dirty.clear();
      return { slots, highWater };
    },
  };
}
