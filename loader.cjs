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
    /**
     * A render loss is the engine saying it dropped something the author wrote:
     * a blanked `javascript:` destination, a flattened ruby annotation, a raw
     * block for another format. Without this the output just quietly lacks it.
     */
    const report = (result) => {
      for (const loss of result.losses) {
        const at = loss.pos ? ` (line ${loss.pos.startLine}, column ${loss.pos.startColumn})` : ''
        loader.emitWarning(new Error(`${loss.message} [${loss.code}]${at}`))
      }
      if (result.truncated) {
        loader.emitWarning(new Error(`${result.totalLosses} render losses in total; the rest were not reported`))
      }
      return result.value
    }

    let html
    if (options.includes ?? true) {
      // A configured root reaches the resolver unchanged, so its absolute-path
      // refusal (PART 9 section 19, I10) still fires. Resolving it here would
      // root containment at the process working directory instead.
      const root = options.includeRoot ?? loader.rootContext
      const expanded = carve.expandIncludes(document, text, {
        resolve: node.fileSystemResolver(root),
        sourcePath: loader.resourcePath,
        extensions: carveOptions.extensions,
      })
      for (const dependency of expanded.dependencies) {
        if (dependency.resolved) loader.addDependency(dependency.id)
      }
      for (const warning of expanded.warnings) loader.emitWarning(new Error(warning.message))
      html = report(carve.renderDocumentWithReport(carve.resolve(expanded.doc), carveOptions))
    } else {
      html = report(carve.carveToHtmlWithReport(text, carveOptions))
    }
    done(null, [
      `export const source = ${JSON.stringify(text)};`,
      `export const html = ${JSON.stringify(html)};`,
      `export const frontmatter = ${JSON.stringify(frontmatter)};`,
      'export default html;',
      '',
    ].join('\n'))
    // The rejection handler must sit AFTER the fulfillment handler: as a second
    // argument it catches only the dynamic imports, so a refused root threw into
    // an unhandled rejection and the build hung with `done` never called.
  }).catch(done)
}

module.exports.raw = false
