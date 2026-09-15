'use strict'

/**
 * Compile a .crv resource to an ES module. Dynamic import keeps this CommonJS
 * loader compatible with webpack while loading carve-js's ESM entry point.
 */
module.exports = function carveLoader(source) {
  const done = this.async()
  const options = typeof this.getOptions === 'function' ? this.getOptions() : {}
  const loader = this

  Promise.all([import('@markup-carve/carve'), import('@markup-carve/carve/node')]).then(([carve, node]) => {
    const carveOptions = options.carveOptions ?? {}
    const text = source.toString()
    const document = carve.parse(text, carveOptions)
    const frontmatter = document.frontmatter
      ? { format: document.frontmatter.format, content: document.frontmatter.content }
      : null
    let html
    if (options.includes ?? true) {
      const root = require('node:path').resolve(options.includeRoot ?? loader.rootContext)
      const expanded = carve.expandIncludes(document, text, {
        resolve: node.fileSystemResolver(root),
        sourcePath: loader.resourcePath,
        extensions: carveOptions.extensions,
      })
      for (const dependency of expanded.dependencies) {
        if (dependency.resolved) loader.addDependency(dependency.id)
      }
      for (const warning of expanded.warnings) loader.emitWarning(new Error(warning.message))
      html = carve.renderDocument(carve.resolve(expanded.doc), carveOptions)
    } else {
      html = carve.carveToHtml(text, carveOptions)
    }
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
