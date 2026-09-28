"""
Cut aurora's and broadsheet's `symbols` subset of Inter (M8): every code
point in U+2000-2BFF that Inter draws and none of Fontsource's subsets in
packages/themes/src/fonts.ts covers (arrows, math, ticks, shapes). Weight
axis only: optical size is pinned at its default, like Fontsource's files.

    npm pack inter-ui@4.1.1 && tar xzf inter-ui-4.1.1.tgz
    python3 scripts/inter-symbols.py package/variable

Writes packages/themes/fonts/inter-symbols-wght-{normal,italic}.woff2 and
prints the unicode-range for fonts.ts. Needs fontTools and brotli.
"""
import io
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.join(os.path.dirname(__file__), '..', 'packages', 'themes')
src = open(os.path.join(ROOT, 'src', 'fonts.ts')).read()
inter = src[src.index('export const INTER'):src.index('export const JETBRAINS_MONO')]
covered = set()
# Every Inter face but this subset's own.
for face, r in re.findall(r"src: '([^']+)'[^}]*unicodeRange: '([^']+)'", inter):
    if 'inter-symbols' in face:
        continue
    for part in r.split(','):
        a, _, b = part[2:].partition('-')
        covered.update(range(int(a, 16), int(b or a, 16) + 1))

def ranges(cps):
    cps = sorted(cps)
    out, start, prev = [], cps[0], cps[0]
    for c in cps[1:] + [None]:
        if c is not None and c == prev + 1:
            prev = c
            continue
        out.append(f'U+{start:04X}' + (f'-{prev:04X}' if prev != start else ''))
        if c is not None:
            start = prev = c
    return ','.join(out)


source = sys.argv[1]
for style, name in [('normal', 'InterVariable.woff2'), ('italic', 'InterVariable-Italic.woff2')]:
    # Inter's own date, not today's: the files come out the same on every run.
    f = TTFont(os.path.join(source, name), recalcTimestamp=False)
    opsz = next(a for a in f['fvar'].axes if a.axisTag == 'opsz')
    wanted = {c for c in f.getBestCmap() if 0x2000 <= c <= 0x2BFF and c not in covered}
    f = instancer.instantiateVariableFont(f, {'opsz': opsz.defaultValue})
    # Subsetting an instanced font in memory trips over its lazy gvar: round-trip it first.
    buf = io.BytesIO()
    f.flavor = None
    f.save(buf)
    buf.seek(0)
    f = TTFont(buf, recalcTimestamp=False)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(unicodes=wanted)
    s.subset(f)
    f.flavor = 'woff2'
    f.save(os.path.join(ROOT, 'fonts', f'inter-symbols-wght-{style}.woff2'))
    print(style, ranges(wanted))
