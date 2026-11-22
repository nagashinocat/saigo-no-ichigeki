import { formatYen, budgetLine } from './format.js';

// ゲームのタイトル（持ち主 2026-11-21 15:57。仮題「街破壊」から変更）
export const GAME_TITLE = '最後の一撃';
// 金額の見出し（持ち主 16:48「被害額だけでおまけは書かなくていいよ」）。勝ち負けの見出しより小さく出す
export const AMOUNT_LABEL = '被害額';

// 今のページ。R3 fix1: iframe の中（artifact）のアドレスは友達が開けないので出さない（null）
const framed = () => { try { return window.self !== window.top; } catch { return true; } };
const pageUrl = () => (typeof location === 'undefined' || (typeof window !== 'undefined' && framed()) ? null : location.origin + location.pathname);

// S9（持ち主 13:16）: 放った一発で街の軍勢を全員倒せたら撃退成功、一人でも残れば撃退失敗（残り N 体）。
// outcome: game.outcome（{ clear, total, survivors }）。時間切れはブラックホール（勝ち負けも破壊額もない）
export function headlineText(reason, outcome) {
  if (reason === 'blackhole' || !outcome) return 'ブラックホールになった';
  return outcome.clear ? '撃退成功' : `撃退失敗　残り ${outcome.survivors.length} 体`;
}

// R3（spec §15 共有）: 題字・勝ち負け・ランク / 被害額とたとえ / 称号 / 街のリンク（?city=）/ #最後の一撃 を行に分ける。
// opts: { reason, city: { share（街の名前）, link }, titles: [{ name }] }。url: 街のリンク（無ければ今のページ）
export function shareText(total, outcome, url = pageUrl(), { reason = outcome ? 'released' : 'blackhole', city = null, titles = [] } = {}) {
  const released = reason !== 'blackhole' && !!outcome;
  const head = !released ? 'ブラックホールになった…' : outcome.clear ? '撃退成功！' : `撃退失敗…残り ${outcome.survivors.length} 体。`;
  const rank = released ? outcome.rank : 'C';
  const lines = [`「${GAME_TITLE}」${head}${rank ? ` ランク ${rank}` : ''}`];
  if (released) {
    const cmp = budgetLine(total);
    lines.push(`${AMOUNT_LABEL} ${formatYen(total)}${cmp ? `（${cmp}）` : ''}`);
  }
  if (titles.length) lines.push('称号' + titles.map((t) => `「${t.name}」`).join(''));
  // R3 fix1: リンクが無い（iframe の中で正式な URL がまだ無い）ときは街の名前だけ
  lines.push(city ? (url ? `${city.share} に挑戦 → ${url}` : `${city.share} に挑戦`) : url);
  lines.push('#最後の一撃');
  return lines.filter(Boolean).join('\n');
}

// R3: 自己ベストの行（{ best: { rank, damage }, isNew }。ベストが無ければ null）
export function bestLine(b) {
  if (!b?.best) return null;
  return { text: `自己ベスト ${b.best.rank} ${formatYen(b.best.damage)}`, isNew: !!b.isNew };
}

// R2（spec §15 ギリギリのボーナス）: 被害額にかかった倍率の内訳（結果画面の小さな行）。bonus: outcome.bonus（game.js）
const mulText = (m) => `×${m.toFixed(2)}`;
export function breakdownLines(bonus) {
  if (!bonus) return [];
  return [`残り ${bonus.timeLeft.toFixed(1)} 秒　${mulText(bonus.timeMul)}`, `すぐそばの軍勢 ${bonus.near} 体　${mulText(bonus.closeMul)}`];
}

// 結果画面に出すもの。見出しが主、被害額は見出しより小さく。ブラックホールは被害額をつけない
// R3: 被害額のたとえ（compare）。extra: { city: { label }, titles: [{ id, name, isNew }], best: records.submitBest の答え } があれば
// 街の名前・称号のバッジ・自己ベストも。ブラックホールも称号を共有できる（share は常に true）
export function resultContent(total, reason, outcome, extra = null) {
  const released = reason !== 'blackhole' && !!outcome;
  const c = {
    title: GAME_TITLE,
    headline: headlineText(reason, outcome),
    clear: released ? outcome.clear : null,
    amount: released ? formatYen(total) : null,
    compare: released ? budgetLine(total) : null,
    share: true,
  };
  if (extra) {
    if (extra.city) c.city = extra.city.label;
    c.titles = extra.titles ?? [];
    c.best = bestLine(extra.best);
  }
  // R2（spec §15 評価のランク）: ランク（game.js の outcome.rank。時間切れは C）と倍率の内訳
  const rank = released ? outcome.rank : 'C';
  if (rank) c.rank = rank;
  if (released && outcome.bonus) c.breakdown = breakdownLines(outcome.bonus);
  return c;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// R3: 共有。Web Share が使えればそれ、無ければクリップボードへ写して「コピーしました」（サーバーは持たない）
export async function shareOrCopy(text, { nav = typeof navigator === 'undefined' ? null : navigator, doc = typeof document === 'undefined' ? null : document } = {}) {
  if (nav?.share) {
    try { await nav.share({ text }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancel'; /* 共有できなければ写す */ }
  }
  try { await nav.clipboard.writeText(text); return 'copied'; } catch { /* クリップボードが使えない（iframe の許可など） */ }
  try {
    const ta = doc.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    doc.body.append(ta); ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    if (ok) return 'copied';
  } catch { /* 写せない */ }
  return 'failed';
}
export const SHARE_NOTE = { copied: 'コピーしました' };

// R3 fix1（点検 Important 1）: 共有を押したあと。写せたら「コピーしました」、どれも使えなければ（artifact の iframe など）
// 文を手で写せる箱（fallback）を出す。取り消しは何も出さない
export async function shareFlow(text, { share = shareOrCopy, note, fallback }) {
  const r = await share(text);
  if (r === 'failed') fallback(text);
  else if (SHARE_NOTE[r]) note(SHARE_NOTE[r]);
  return r;
}

// fix2: 長押しのメニュー（contextmenu）を止めないところ: 手で写す箱の中（携帯で長押しして選び、コピーする）
export function allowsNativeMenu(target) {
  const node = typeof target?.closest === 'function' ? target : target?.parentElement;
  return typeof node?.closest === 'function' && !!node.closest('.result-copybox');
}

// 手で写す箱: 一言・読み取り専用で全部を選んだ textarea・閉じるボタン
export function buildCopyFallback(doc, text, onClose) {
  const box = doc.createElement('div');
  box.className = 'result-copybox';
  const msg = doc.createElement('p');
  msg.textContent = '自動でコピーできませんでした。下の文を長押しで選んで、手でコピーしてください';
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-label', '共有の文');
  const close = doc.createElement('button');
  close.className = 'result-btn';
  close.textContent = '閉じる';
  close.addEventListener('click', () => onClose());
  box.append(msg, ta, close);
  ta.addEventListener('focus', () => ta.select());
  ta.select();
  return box;
}

// R4（spec §15 爆発の短い縦動画）: 下の段のボタン。「リプレイ」（最後の一発を見せ直せるとき）と「動画で共有」（録画できる端末で、
// 最後の一発のリプレイの写しがあるとき・ブラックホールの結末）。どちらも無ければ下の段ごと出さない
export function subButtons({ canReplay = false, canClip = false } = {}) {
  return { replay: !!canReplay, clip: !!canClip, row: !!(canReplay || canClip) };
}
export const CLIP_LABEL = '動画で共有';

// 結果画面。「もう一度」は onRetry、「リプレイ」は onReplay（最後の一発をもう一度見る）、「動画で共有」は onClip（R4）、
// 「共有」は Web Share か、使えなければクリップボードへ写す（R3）。getShare: () => ({ url, city, titles })（街のリンクと称号）
export function createResult(root, { onRetry, onReplay = null, onClip = null, share: shareFn = shareOrCopy }) {
  const title = el('div', 'result-title', GAME_TITLE);
  // R3: 街の名前（題字の下）・称号のバッジ（見出しの下）・被害額のたとえ（被害額の下）・自己ベスト（内訳の下）・共有の知らせ
  const cityEl = el('div', 'result-city');
  const titlesEl = el('div', 'result-titles');
  const compare = el('div', 'result-compare');
  const bestEl = el('div', 'result-best');
  const note = el('div', 'result-note');
  const headline = el('div', 'result-headline');
  const amount = el('div', 'result-amount');
  const label = el('div', 'result-label', AMOUNT_LABEL);
  // R2: ランクは大きく（見出しの上）、内訳は被害額の下に小さな行で
  const rankEl = el('div', 'result-rank');
  const rankLetter = el('b', null), rankCap = el('small', null, 'ランク');
  rankEl.append(rankCap, rankLetter);
  const breakdown = el('div', 'result-breakdown');
  const retry = el('button', 'result-btn primary', 'もう一度');
  const share = el('button', 'result-btn', '共有');
  const replay = el('button', 'result-btn ghost', 'リプレイ');
  const row = el('div', 'result-row');
  row.append(retry, share);
  const clipBtn = el('button', 'result-btn ghost clip', CLIP_LABEL);
  const row2 = el('div', 'result-row sub');
  row2.append(replay, clipBtn);
  root.append(title, cityEl, rankEl, headline, titlesEl, label, amount, compare, breakdown, bestEl, row, row2, note);
  root.hidden = true;
  let total = 0, outcome = null, reason = null, extra = null, noteTimer = 0;
  retry.addEventListener('click', () => onRetry());
  replay.addEventListener('click', () => onReplay?.());
  clipBtn.addEventListener('click', () => onClip?.({ total, outcome, reason, extra }));
  let copyBox = null;
  const closeCopyBox = () => { copyBox?.remove(); copyBox = null; };
  share.addEventListener('click', async () => {
    // R3 fix1: 街の情報があればその link（無ければ null = URL を出さない）。iframe の中のアドレスは使わない
    const url = extra?.city ? (extra.city.link ?? null) : pageUrl();
    const text = shareText(total, outcome, url, { reason, city: extra?.city ?? null, titles: extra?.titles ?? [] });
    await shareFlow(text, {
      share: shareFn,
      note: (m) => {
        note.textContent = m;
        note.hidden = false;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => { note.hidden = true; }, 2200);
      },
      fallback: (t) => {
        closeCopyBox();
        copyBox = buildCopyFallback(document, t, closeCopyBox);
        root.append(copyBox);
        copyBox.querySelector('textarea').select();
      },
    });
  });
  return {
    // o: game.outcome（時間切れは null）。opts.replay: 「リプレイ」を出す（最後の一発を見せ直せるとき）。
    // opts.extra（R3）: { city: { label, share, link }, titles: [{ id, name, isNew }], best: records.submitBest の答え }
    // opts.clip（R4）: 「動画で共有」を出す（録画できる端末で、動画にできる一発・結末のとき）
    show(t, why, o = null, { replay: canReplay = false, clip: canClip = false, extra: ex = null } = {}) {
      total = t; outcome = o; reason = why; extra = ex;
      const c = resultContent(t, why, o, ex);
      cityEl.textContent = c.city ?? '';
      cityEl.hidden = !c.city;
      titlesEl.replaceChildren(...(c.titles ?? []).map((tt) => {
        const b = el('span', 'result-badge' + (tt.isNew ? ' new' : '') + (tt.rarity ? ' r' + tt.rarity : ''), tt.name);
        // R3 fix1: 珍しさを小さな星で（1〜5）
        if (tt.rarity) b.append(el('small', 'result-stars', '★'.repeat(tt.rarity)));
        if (tt.isNew) b.append(el('i', null, 'NEW'));
        return b;
      }));
      titlesEl.hidden = !c.titles?.length;
      compare.textContent = c.compare ?? '';
      compare.hidden = !c.compare;
      bestEl.replaceChildren(...(c.best ? [document.createTextNode(c.best.text), ...(c.best.isNew ? [el('b', null, 'NEW!')] : [])] : []));
      bestEl.hidden = !c.best;
      note.hidden = true;
      closeCopyBox();
      // R3: 折り返すときは全角の間で（「撃退失敗」「残り N 体」をそれぞれ切らない）。文字は同じ
      headline.replaceChildren(...c.headline.split('　').flatMap((part, i) => [...(i ? [document.createTextNode('　')] : []), el('span', 'nobr', part)]));
      // 勝ち負けで色を変える（撃退成功は明るく、失敗は生き残りの光と同じ赤緑の気配）
      root.classList.toggle('clear', c.clear === true);
      root.classList.toggle('fail', c.clear === false);
      root.classList.toggle('blackhole', why === 'blackhole'); // R3: 長い見出しを画面の幅に収める
      amount.textContent = c.amount ?? '';
      rankLetter.textContent = c.rank ?? '';
      rankEl.hidden = !c.rank;
      for (const r of ['S', 'A', 'B', 'C']) rankEl.classList.toggle('rank-' + r.toLowerCase(), c.rank === r);
      breakdown.replaceChildren(...(c.breakdown ?? []).map((t) => el('div', 'result-bline', t)));
      breakdown.hidden = !c.breakdown?.length;
      label.hidden = amount.hidden = c.amount === null;
      share.hidden = !c.share;
      const sub = subButtons({ canReplay: canReplay && !!onReplay, canClip: canClip && !!onClip });
      replay.hidden = !sub.replay;
      clipBtn.hidden = !sub.clip;
      row2.hidden = !sub.row;
      root.hidden = false;
    },
    hide() { closeCopyBox(); root.hidden = true; },
    // R4: 録画の間は結果画面のボタンを押せなくする（キーの Space で「もう一度」が押されない）
    setBusy(on) { root.inert = !!on; root.classList.toggle('busy', !!on); },
    // R4: 結果画面の小さな知らせ（動画を保存した・保存できないかもしれない、など）
    notify(m, ms = 4200) {
      note.textContent = m;
      note.hidden = false;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { note.hidden = true; }, ms);
    },
  };
}
