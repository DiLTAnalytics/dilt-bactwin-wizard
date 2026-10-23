# Brand assets

| File | What |
|---|---|
| `mark.svg` | The mark: two overlapping rectangles |
| `logo.svg`, `logo-dark.svg` | Logo with wordmark, for light and dark backgrounds |
| `icon.icns`, `icon.ico`, `icon.png` | App icon for macOS, Windows, Linux |

Brand green: `#5FC49C`. These are DiLT trademarks (`LicenseRef-DiLT-trademark`), not open source:
replace them before distributing a build. See [`LICENSING.md`](../../../LICENSING.md#trademarks).

## Regenerating the icon

Drawn directly, because ImageMagick's SVG renderer drops the strokes of `mark.svg`. The white ground
keeps the icon visible on light docks and taskbars.

```bash
magick -size 1024x1024 xc:none \
  -fill white -stroke none -draw "roundrectangle 0,0 1023,1023 228,228" \
  -fill none -stroke "#5FC49C" -strokewidth 32 \
  -draw "rectangle 172,516 548,892" \
  -draw "rectangle 424,132 780,756" \
  PNG32:icon-1024.png
```
