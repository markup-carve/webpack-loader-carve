# Changelog

## [0.1.2] - 2026-10-08

### Added

- A render loss the engine records is emitted as a webpack warning carrying its
  code and source position. Rendering went through `renderDocument` and
  `carveToHtml`, which return a string and drop the report, so a blanked
  `javascript:` destination, a flattened ruby annotation or a raw block for
  another format left no trace in the build log. Include warnings already left
  through `emitWarning`; these use the same channel (#16).

### Changed

- Tested against `@markup-carve/carve` 0.1.10. The declared range `^0.1.7`
  already resolved it, but the committed lockfile held 0.1.7, so CI had never
  run the engine a consumer installs. Three engine behaviors this loader reaches
  now have tests driven through a real webpack build: a case-only
  cross-reference stays literal, an include renames every colliding id rather
  than only a heading id, and a denied destination scheme is reported (#16).

## 0.1.1

- `{{ path }}` include directives now expand, resolved relative to the importing
  `.crv` file and contained to webpack's `rootContext`. Included files are
  registered as webpack dependencies. `includes: false` leaves them literal, and
  `includeRoot` sets another absolute containment root (#8).
- Requires `@markup-carve/carve` 0.1.7 (`^0.1.7`), the first release carrying
  contained include expansion (#10).

## 0.1.0

- Initial webpack 5 loader with a verified Next.js webpack example.
- `exports` names `./package.json`, so
  `require('@markup-carve/webpack-loader/package.json')` reads the installed
  version back (markup-carve/carve#1484).
