# Item icon artwork

The replacement artwork is generated separately for each of the 156 stable keys in `src/data/icons.ts`, using the built-in ImageGen tool. That tool does not expose a model selector or model version; these assets must not be described as verified image2.5 output.

`prompts.json` records the shared art direction, exact per-item generation/edit prompts, and final source-image filenames. The style is a refined miniature product illustration with realistic materials, soft studio lighting, a transparent background, and no brand marks or captions.

The app-ready files are transparent 768 × 768 WebP images in `public/icons/items/`, encoded at quality 90 with full alpha quality. [View all 156 icons](overview.webp). Original generated PNGs and per-item generation progress are retained locally under `.tmp/icon-redraw/`; the tool also preserves its original outputs in the Codex generated-image directory.

The existing SVG artwork remains available for compatibility with historical stored paths. Replacing artwork must preserve every `preset-<key>` ID and must never require clearing user data.
