# 導入（S6）の文字だけを含む woff2 を作る。
# 使い方: python3 -I scripts/build-intro-font.py <@fontsource/zen-old-mincho の files フォルダ> <出力 .woff2>
# 入力: @fontsource/zen-old-mincho（SIL Open Font License 1.1）の 900（Black）の分割 woff2。
# 文字ごとに、その文字を持つ分割ファイルを探し、ファイルごとに必要な文字だけへ切り詰めてから一つにまとめる。
import glob
import os
import sys
import tempfile

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

# 画面に出す文字（カード・題字・TAP の案内・TAP START のボタン）
TEXT = 'ありったけを' + '解き放て' + '最後の一撃' + 'TAP START'

def main(src_dir, out_path):
    files = sorted(glob.glob(os.path.join(src_dir, 'zen-old-mincho-*-900-normal.woff2')))
    need = {ord(c) for c in TEXT if c != ' '}
    owner = {}
    for f in files:
        cmap = TTFont(f).getBestCmap() or {}
        for cp in need:
            if cp in cmap and cp not in owner:
                owner[cp] = f
    missing = [chr(cp) for cp in need if cp not in owner]
    if missing:
        sys.exit('missing glyphs: ' + ''.join(missing))
    by_file = {}
    for cp, f in owner.items():
        by_file.setdefault(f, set()).add(cp)
    tmp = tempfile.mkdtemp()
    parts = []
    for i, (f, cps) in enumerate(sorted(by_file.items())):
        font = TTFont(f)
        opts = subset.Options()
        opts.layout_features = ['vert', 'vrt2', 'kern', 'palt', 'vpal']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        opts.hinting = False
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=sorted(cps))
        sub.subset(font)
        font.flavor = None
        p = os.path.join(tmp, f'part{i}.ttf')
        font.save(p)
        parts.append(p)
    merged = Merger().merge(parts) if len(parts) > 1 else TTFont(parts[0])
    merged.flavor = 'woff2'
    merged.save(out_path)
    got = TTFont(out_path).getBestCmap()
    print(out_path, os.path.getsize(out_path), 'bytes,', len(parts), 'parts,', 'glyphs:', ''.join(sorted(chr(c) for c in got)))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
