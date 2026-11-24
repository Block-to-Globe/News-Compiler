# Theme

The page uses one theme, **Dusk**: deep blue-slate background, soft off-white text, periwinkle links. The colours are the variables at the top of `assets/style.css`. `index.html` (`theme-color`) and `manifest.webmanifest` carry the same background colour.

To restyle, change those variables, keep text, muted and accent colours at 4.5:1 contrast or better against `--bg`, and bump `CACHE` in `sw.js`.

## Alternates (not in use)

| Name | bg | text | muted | line | accent | notes |
|---|---|---|---|---|---|---|
| Paper | #faf6ee | #2b2118 | #6b5d4f | #e0d4bd | #9a3f2a | light; serif stack `Charter, "Iowan Old Style", Georgia, serif` |
| Sage | #f1f4ee | #1f3a2a | #4f6657 | #d3dccf | #2d5a3d | light; `letter-spacing: .01em` |

For a light alternate, also set `color-scheme: light`.
