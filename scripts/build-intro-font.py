# 導入（S6）の文字だけを含む woff2 を作る。
# 使い方: python3 -I scripts/build-intro-font.py [files フォルダ] [出力 .woff2]
#   既定: node_modules/@fontsource/zen-old-mincho/files（devDependency）→ src/assets/intro-mincho.woff2
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

LICENSE_NOTE = ('This Font Software is licensed under the SIL Open Font License, Version 1.1. '
                'Copyright 2021 The Zen Old Mincho Project Authors (https://github.com/googlefonts/zen-oldmincho). '
                'Subset of Zen Old Mincho Black for the game Saigo no Ichigeki.')

def main(src_dir, out_path):
    files = sorted(glob.glob(os.path.join(src_dir, 'zen-old-mincho-*-900-normal.woff2')))
    need = {ord(c) for c in TEXT}  # 空白（U+0020）も入れる（TAP START）
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
    # OFL の告知を書体の中にも入れる（nameID 13 ライセンス、14 ライセンスの URL）
    name = merged['name']
    for rec in list(name.names):
        if rec.nameID in (13, 14):
            name.removeNames(nameID=rec.nameID)
    name.setName(LICENSE_NOTE, 13, 3, 1, 0x409)
    name.setName('https://openfontlicense.org', 14, 3, 1, 0x409)
    merged.flavor = 'woff2'
    merged.save(out_path)
    got = TTFont(out_path).getBestCmap()
    print(out_path, os.path.getsize(out_path), 'bytes,', len(parts), 'parts,', 'glyphs:', repr(''.join(sorted(chr(c) for c in got))))
    print('nameID 13:', TTFont(out_path)['name'].getDebugName(13))

if __name__ == '__main__':
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'node_modules/@fontsource/zen-old-mincho/files')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, 'src/assets/intro-mincho.woff2')
    main(src, out)
