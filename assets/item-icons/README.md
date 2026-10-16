# Item icon artwork

The library contains 220 stable keys in `src/data/icons.ts`: the original 156 icons, 63 additions for version 2.0, and a magnetic tablet keyboard folio. All nine category IDs and all existing `preset-<key>` IDs are preserved. The suggested miscellaneous icon duplicates the existing generic icon and was omitted.

The artwork uses the Codex built-in ImageGen tool. The original request named `gpt-image-2.5-sunburst`; the user then clarified that they wanted the built-in image generation tool, not a separate API call. That tool exposes neither a model selector nor an actual model ID. The new records therefore use `actualModelId: null`; these assets must not be described as verified GPT Image 2.5 output. No separately billed API calls were made. This batch used 63 generation calls and one edit to remove printed text from the cleanser tube.

`prompts.json` records the shared art direction, exact per-item generation/edit prompts, and final source-image filenames. The style is a refined miniature product illustration with realistic materials, soft studio lighting, a transparent background, and no brand marks or captions.

The app-ready files are transparent 768 × 768 WebP images in `public/icons/items/`, encoded at quality 90 with full alpha quality. New images are trimmed and fitted to a 600px maximum dimension (78.125% of the canvas), with transparent margins. All new outputs passed real-alpha checks and visual review on light/dark backgrounds, including 40px thumbnails. [View all 220 icons](overview.webp) or [compare the first 12 additions with existing icons](comparison-first-12.webp).

The `tabletkeyboard` addition uses one built-in ImageGen generation with the same visual style. Its original and generation record are retained under `.tmp/tablet-keyboard/`. The icon shows an empty magnetic mounting panel with a camera opening, a keyboard and a trackpad; search aliases include 磁吸键盘, 平板键盘, 妙控键盘 and Magic Keyboard.

Original generated PNGs and per-item generation progress are retained locally under `.tmp/icon-redraw/` (original 156) and `.tmp/icon-library-v2/` (new 63). The latter includes `source-images.zip` with accepted originals, the rejected cleanser attempt, sanitized generation records, and checksums; it is a delivery artifact rather than a Git asset. Keep that archive with any long-term project backup. `prompts.json` records source filenames/SHA-256, exact generation/edit prompts, the unexposed model limitation, and final output paths/sizes/SHA-256. The tool also preserves its original outputs in the Codex generated-image directory.

The existing SVG artwork remains available for compatibility with historical stored paths. Replacing artwork must preserve every `preset-<key>` ID and must never require clearing user data.
