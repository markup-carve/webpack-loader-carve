# Changelog

## Unreleased

- `exports` now names `./package.json`, so
  `require('@markup-carve/webpack-loader/package.json')` reads the installed
  version back instead of throwing `ERR_PACKAGE_PATH_NOT_EXPORTED`
  (markup-carve/carve#1484).

## 0.1.0

- Initial webpack 5 loader with a verified Next.js webpack example.
