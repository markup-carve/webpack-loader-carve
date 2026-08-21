'use strict'

/**
 * Compile a .crv resource to an ES module. Dynamic import keeps this CommonJS
 * loader compatible with webpack while loading carve-js's ESM entry point.
 */
module.exports = function carveLoader(source) {
  const done = this.async()
  const options = typeof this.getOptions === 'function' ? this.getOptions() : {}

  import('@markup-carve/carve').then(({ carveToHtml, parse }) => {
    const carveOptions = options.carveOptions ?? {}
    const text = source.toString()
    const document = parse(text, carveOptions)
    const frontmatter = document.frontmatter
      ? { format: document.frontmatter.format, content: document.frontmatter.content }
      : null
    const html = carveToHtml(text, carveOptions)
    done(null, [
      `export const source = ${JSON.stringify(text)};`,
      `export const html = ${JSON.stringify(html)};`,
      `export const frontmatter = ${JSON.stringify(frontmatter)};`,
      'export default html;',
      '',
    ].join('\n'))
  }, done)
}

module.exports.raw = false
