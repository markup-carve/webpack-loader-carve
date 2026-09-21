# Changelog

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
