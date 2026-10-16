# Item icon artwork

The library contains 220 keys in `src/data/icons.ts`. All nine category IDs are unchanged. The unused USB hub, HDMI adapter and card reader options have been consolidated into one docking station; all other `preset-<key>` IDs are preserved. The suggested miscellaneous icon duplicates the existing generic icon and was omitted.

The artwork uses the Codex built-in ImageGen tool. The original request named `gpt-image-2.5-sunburst`; the user then clarified that they wanted the built-in image generation tool, not a separate API call. That tool exposes neither a model selector nor an actual model ID. The new records therefore use `actualModelId: null`; these assets must not be described as verified GPT Image 2.5 output. No separately billed API calls were made. This batch used 63 generation calls and one edit to remove printed text from the cleanser tube.

`prompts.json` records the shared art direction, exact per-item generation/edit prompts, and final source-image filenames. The style is a refined miniature product illustration with realistic materials, soft studio lighting, a transparent background, and no brand marks or captions.

The app-ready files are transparent 768 × 768 WebP images in `public/icons/items/`, encoded at quality 90 with full alpha quality. New images are trimmed and fitted to a 600px maximum dimension (78.125% of the canvas), with transparent margins. All new outputs passed real-alpha checks and visual review on light/dark backgrounds, including 40px thumbnails. [View all 220 icons](overview.webp) or [compare the first 12 additions with existing icons](comparison-first-12.webp).

The `tabletkeyboard` addition uses one built-in ImageGen generation with the same visual style. Its original and generation record are retained under `.tmp/tablet-keyboard/`. The icon shows an empty magnetic mounting panel with a camera opening, a keyboard and a trackpad; search aliases include 磁吸键盘, 平板键盘, 妙控键盘 and Magic Keyboard.

The `dockingstation` icon combines USB-A, HDMI and SD/microSD ports in one enclosure. One built-in ImageGen edit used the previous three icons as references; its accepted original and input copies are retained under `.tmp/docking-station/`, with prompt, reference commit and checksums in `prompts.json`. The former `usbhub`, `hdmiadapter` and `cfreader` entries, WebP/SVG assets and legacy generator definitions were removed after the user confirmed no items used them. Searching their former names now finds 拓展坞.

Original generated PNGs and per-item generation progress are retained locally under `.tmp/icon-redraw/` (original 156) and `.tmp/icon-library-v2/` (new 63). The latter includes `source-images.zip` with accepted originals, the rejected cleanser attempt, sanitized generation records, and checksums; it is a delivery artifact rather than a Git asset. Keep that archive with any long-term project backup. `prompts.json` records source filenames/SHA-256, exact generation/edit prompts, the unexposed model limitation, and final output paths/sizes/SHA-256. The tool also preserves its original outputs in the Codex generated-image directory.

The `djipocket` and `djiaction` additions show a handheld gimbal camera and a compact rugged action camera as two independent digital items. Each used one built-in ImageGen generation. Their originals and records are retained under `.tmp/dji-cameras/`; exact prompts, official DJI shape-reference links and source/output checksums are in `prompts.json`. Names cover the Pocket/Action families without assigning a model generation. Search accepts Pocket, Action, DJI, 大疆, 云台相机 and 运动相机.

The remaining SVG artwork stays available for historical stored paths. Retained `preset-<key>` IDs remain stable; artwork changes must never require clearing user data.
