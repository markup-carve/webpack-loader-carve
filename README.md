# @markup-carve/webpack-loader

A webpack 5 loader for importing [Carve](https://markup-carve.github.io/carve/)
markup as build-time-rendered HTML. It is also the supported bridge for Next.js
projects that use webpack.

## Install

```bash
npm install @markup-carve/webpack-loader
```

## Webpack

```js
export default {
  module: {
    rules: [
      { test: /\.crv$/, use: ['@markup-carve/webpack-loader'] },
    ],
  },
}
```

```js
import html, { source, frontmatter } from './document.crv'
```

The default export and named `html` export contain rendered HTML. `source`
contains the original document and `frontmatter` contains Carve's raw
`{format, content}` metadata object (or `null`). Rendering happens during the
build; the Carve engine is not sent to the browser.

Options are passed under `carveOptions`:

```js
{ test: /\.crv$/, use: [{
  loader: '@markup-carve/webpack-loader',
  options: { carveOptions: { allowRawHtml: false } },
}] }
```

## Next.js

Add the same rule in `next.config.mjs`:

```js
export default {
  webpack(config) {
    config.module.rules.push({
      test: /\.crv$/,
      use: ['@markup-carve/webpack-loader'],
    })
    return config
  },
}
```

The loader expands `{{ path }}` directives by default. Paths resolve relative
to the importing `.crv` file and cannot escape webpack's `rootContext`. Set
`includes: false` to leave directives literal, or set `includeRoot` to another
absolute containment root. Included files are registered as webpack
dependencies and trigger rebuilds when they change.

Then render an import from a Server Component:

```jsx
import html from './welcome.crv'

export default function Page() {
  return <article dangerouslySetInnerHTML={{__html: html}} />
}
```

Next.js 16 uses Turbopack by default. Run `next dev --webpack` and
`next build --webpack` with this configuration. Turbopack accepts a subset of
webpack loaders, but this package only claims the webpack path until its ESM
dependency loading has been verified in Turbopack itself.

Because rendering produces HTML, use Carve's `allowRawHtml: false` option when
authors are not trusted. React's `dangerouslySetInnerHTML` does not sanitize.

## TypeScript

```ts
declare module '*.crv' {
  export const source: string
  export const html: string
  export const frontmatter: {format: string; content: string} | null
  const value: string
  export default value
}
```
