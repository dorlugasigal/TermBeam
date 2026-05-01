# tools/

Build-time helpers used to bake static assets into the frontend.

## extract-wordmark-paths.cjs

Generates `src/components/common/wordmarkPaths.ts` — the SVG `<path>`
glyphs for the "TermBeam" wordmark in Montserrat ExtraBold. We pre-bake
the paths so the runtime can animate `stroke-dashoffset` per letter
without the multi-subpath artifacts that `<text>` + `stroke-dasharray`
produces on glyphs with inner counters (B, e, a, m, …).

### Re-running

If the wordmark or font ever changes:

```bash
cd src/frontend
mkdir -p tools/fonts
curl -sL https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-ExtraBold.ttf \
  -o tools/fonts/Montserrat-ExtraBold.ttf
npm install --no-save fontkit
node tools/extract-wordmark-paths.cjs
# Output is written to src/components/common/wordmarkPaths.ts
npm uninstall fontkit
rm -rf tools/fonts
```

The generated file is committed to source control.
