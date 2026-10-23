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

    // Names the file only when the finding is not in the document being loaded.
    const located = (warning) => {
      const file = warning.file && warning.file !== loader.resourcePath ? `${warning.file}, ` : ''
      return `${warning.message} [${warning.rule}] (${file}line ${warning.line}, column ${warning.column})`
    }

    let html
    let lintIncludes
    const reported = new Set()
    if (options.includes ?? true) {
      // A configured root reaches the resolver unchanged, so its absolute-path
      // refusal (PART 9 section 19, I10) still fires. Resolving it here would
      // root containment at the process working directory instead.
      const root = options.includeRoot ?? loader.rootContext
      lintIncludes = { resolve: node.fileSystemResolver(root), sourcePath: loader.resourcePath }
      const expanded = carve.expandIncludes(document, text, {
        ...lintIncludes,
        extensions: carveOptions.extensions,
      })
      for (const dependency of expanded.dependencies) {
        if (dependency.resolved) loader.addDependency(dependency.id)
      }
      for (const warning of expanded.warnings) {
        reported.add(`${warning.rule}\0${warning.message}`)
        loader.emitWarning(new Error(located(warning)))
      }
      html = report(carve.renderDocumentWithReport(carve.resolve(expanded.doc), carveOptions))
    } else {
      html = report(carve.carveToHtmlWithReport(text, carveOptions))
    }
    if (options.lint) {
      // Include failures were already reported by the expansion above.
      for (const finding of carve.lintCarve(text, { includes: lintIncludes, extensions: carveOptions.extensions })) {
        if (reported.has(`${finding.rule}\0${finding.message}`)) continue
        loader.emitWarning(new Error(located(finding)))
      }
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
