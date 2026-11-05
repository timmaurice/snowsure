"""Turn the EAWS danger-level SVGs into compact path data for the card.

Keeps the diamond outline, mountain, snow, clouds and slide lines; drops the
white page mask, the level number outside the diamond and the symbol (tick,
exclamation mark, cross) in the coloured half, so the card can put its own
colour and number there, like lawinen.report does.
"""

import json
import re
import sys

TOKEN = re.compile(r"[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?")
ARGS = dict(M=2, L=2, H=1, V=1, C=6, S=4, Q=4, T=2, A=7, Z=0)


def subpaths(d):
    """Split into subpaths, each starting with an absolute M; bbox from all points (control points included)."""
    toks = TOKEN.findall(d)
    i = 0
    cx = cy = sx = sy = 0.0
    out = []  # (absolute start, list of command strings, xs, ys)
    cur = None
    cmd = None
    while i < len(toks):
        t = toks[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                cx, cy = sx, sy
                cur[1].append("z")
                continue
        n = ARGS[cmd.upper()]
        vals = [float(v) for v in toks[i : i + n]]
        i += n
        rel = cmd.islower()
        up = cmd.upper()
        if up == "M":
            x, y = vals
            if rel:
                x += cx
                y += cy
            cx, cy = sx, sy = x, y
            cur = [(x, y), [], [x], [y]]
            out.append(cur)
            cmd = "l" if rel else "L"  # implicit lineto after moveto
            continue
        pts = []
        if up == "H":
            nx = vals[0] + (cx if rel else 0)
            pts = [(nx, cy)]
        elif up == "V":
            ny = vals[0] + (cy if rel else 0)
            pts = [(cx, ny)]
        elif up == "A":
            ex, ey = vals[5], vals[6]
            if rel:
                ex += cx
                ey += cy
            pts = [(ex, ey)]
        else:
            for k in range(0, n, 2):
                px, py = vals[k], vals[k + 1]
                if rel:
                    px += cx
                    py += cy
                pts.append((px, py))
        # write every segment in absolute form so subpaths stand alone
        if up in "HV":
            seg = f"L{pts[0][0]:.1f} {pts[0][1]:.1f}"
        elif up == "A":
            a = vals[:5]
            seg = f"A{a[0]:.1f} {a[1]:.1f} {a[2]:g} {int(a[3])} {int(a[4])} {pts[0][0]:.1f} {pts[0][1]:.1f}"
        else:
            seg = up + " ".join(f"{px:.1f} {py:.1f}" for px, py in pts)
        cur[1].append(seg)
        for px, py in pts:
            cur[2].append(px)
            cur[3].append(py)
        cx, cy = pts[-1]
    return [
        dict(d=f"M{s[0][0]:.1f} {s[0][1]:.1f}" + "".join(s[1]), box=(min(s[2]), min(s[3]), max(s[2]), max(s[3])))
        for s in out
    ]


def is_black(fill):
    return fill is None or fill.lower() in ("#000", "#000000", "#020201", "#020202")


def convert(path):
    with open(path, encoding="utf-8") as file:
        svg = file.read()
    elems = re.findall(r"<path\b([^>]*)/>", svg, re.S)
    parsed = []
    for attrs in elems:
        if 'display="none"' in attrs:  # hidden Illustrator layers
            continue
        fill = re.search(r'fill="([^"]*)"', attrs)
        d = re.search(r'\sd="([^"]*)"', attrs, re.S).group(1)
        parsed.append((fill.group(1) if fill else None, subpaths(d)))
    # The page mask starts far outside the picture.
    parsed = [p for p in parsed if p[1][0]["box"][0] > -100]
    coloured = [p for p in parsed if not is_black(p[0]) and p[0].upper() not in ("#FFF", "#FFFFFF")]
    # No-rating icon has no coloured half: its lower half is the white inside of the outline.
    bottom = coloured[0][1][0] if coloured else None
    divider = bottom["box"][1] if bottom else None
    keep = []
    for fill, subs in parsed:
        if bottom and subs is coloured[0][1]:
            continue
        kept = []
        for s in subs:
            x0, y0, x1, y1 = s["box"]
            if x1 < 300 and y1 < 640:  # level number outside the diamond
                continue
            if divider is not None and y0 > divider + 5 and is_black(fill):  # symbol in the coloured half
                continue
            kept.append(s)
        if kept:
            keep.append(
                dict(
                    fill="#fff" if not is_black(fill) else "#000",
                    d="".join(s["d"] for s in kept),
                    box=[
                        min(s["box"][0] for s in kept),
                        min(s["box"][1] for s in kept),
                        max(s["box"][2] for s in kept),
                        max(s["box"][3] for s in kept),
                    ],
                )
            )
    x0 = min(k["box"][0] for k in keep)
    y0 = min(k["box"][1] for k in keep)
    x1 = max(k["box"][2] for k in keep)
    y1 = max(k["box"][3] for k in keep)
    pad = 6
    return dict(
        viewBox=f"{x0 - pad:.0f} {y0 - pad:.0f} {x1 - x0 + 2 * pad:.0f} {y1 - y0 + 2 * pad:.0f}",
        bottom=bottom["d"] if bottom else None,
        bottomBox=[round(v, 1) for v in bottom["box"]] if bottom else None,
        layers=[dict(fill=k["fill"], d=k["d"]) for k in keep],
    )


HEADER = """// Generated by frontend/scripts/eaws_icons.py, do not edit.
// Avalanche danger level icons of the European Avalanche Warning Services
// (EAWS, https://www.avalanches.org/downloads/), as used on lawinen.report:
// outline, mountain, snow and clouds; the card adds the colour and the number.

export interface EawsIcon {
  viewBox: string;
  /** The lower half, filled with the level colour; absent on the no-rating icon. */
  bottom?: string;
  /** x0, y0, x1, y1 of the lower half. */
  bottomBox?: [number, number, number, number];
  layers: { fill: string; d: string }[];
}

/** Index 0 is "no rating"; 4 serves levels 4 and 5, which share the picture. */
export const EAWS_ICONS: EawsIcon[] = """


if __name__ == "__main__":
    # Usage: eaws_icons.py level_0.svg … level_4.svg > avalanche-icons.ts,
    # then prettier on the result.
    icons = []
    for path in sys.argv[1:]:
        icon = convert(path)
        entry = dict(viewBox=icon["viewBox"], layers=icon["layers"])
        if icon["bottom"]:
            entry["bottom"] = icon["bottom"]
            entry["bottomBox"] = icon["bottomBox"]
        icons.append(entry)
    sys.stdout.write(HEADER + json.dumps(icons, indent=2) + ";\n")
