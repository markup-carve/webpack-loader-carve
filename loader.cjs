'use strict'

const path = require('node:path')

/** Compile a Carve document to an ES module for webpack and Next.js. */
module.exports = function carveLoader(source) {
  const done = this.async()
  const options = typeof this.getOptions === 'function' ? this.getOptions() : {}
  const loader = this

  Promise.all([import('@markup-carve/carve'), import('@markup-carve/carve/node')]).then(([carve, node]) => {
    const text = source.toString()
    const carveOptions = { rawHtml: false, ...(options.carveOptions ?? {}) }
    const sourceTexts = new Map([[loader.resourcePath, text]])
    let includes
    if (options.includes ?? true) {
      const root = options.includeRoot ?? loader.rootContext
      if (!path.isAbsolute(root)) throw new Error('includeRoot must be an absolute path')
      const resolve = node.fileSystemResolver(root)
      includes = {
        file: path.relative(root, loader.resourcePath).split(path.sep).join('/'),
        resolver(request) {
          const answer = resolve(request)
          if ('id' in answer) {
            const file = path.resolve(root, answer.id)
            sourceTexts.set(file, typeof answer.text === 'string' ? answer.text : new TextDecoder().decode(answer.text))
          }
          return answer
        },
      }
    }

    const { document, diagnostics: parseDiagnostics, suppressedDiagnostics: parseSuppressed } = carve.parseWithDiagnostics(text, {
      headingIds: carveOptions.headingIds,
      extensions: carveOptions.extensions,
      includes,
    })
    for (const dependency of carve.includeDependencies(document)) {
      if (dependency.read) loader.addDependency(path.resolve(options.includeRoot ?? loader.rootContext, dependency.file))
    }

    const front = document.children.find((child) => child.type === 'frontmatter')
    const frontmatter = front ? { format: front.format, content: front.value } : null
    // Includes have already been expanded in the tree. Render that same tree so
    // the HTML, dependency list, and parse diagnostics describe one parse.
    const { includes: _ignored, ...renderOptions } = carveOptions
    const rendered = carve.renderWithDiagnostics(document, renderOptions)
    const reported = new Set()

    const located = (diagnostic) => {
      const file = diagnostic.file
        ? path.resolve(options.includeRoot ?? loader.rootContext, diagnostic.file)
        : loader.resourcePath
      const named = file !== loader.resourcePath ? `${file}, ` : ''
      const input = sourceTexts.get(file)
      if (!diagnostic.range || input === undefined) return `${diagnostic.message} [${diagnostic.code}]`
      const offset = carve.stringOffsetOfByte(input, diagnostic.range.startOffset)
      const before = input.slice(0, offset)
      const line = before.split('\n').length
      // C2-A-141 columns count Unicode code points, while JavaScript slices
      // and stringOffsetOfByte use UTF-16 code units.
      const column = [...before.slice(before.lastIndexOf('\n') + 1)].length + 1
      return `${diagnostic.message} [${diagnostic.code}] (${named}line ${line}, column ${column})`
    }
    const emit = (diagnostic) => {
      const key = `${diagnostic.path ?? ''}\0${diagnostic.file ?? ''}\0${diagnostic.code}\0${diagnostic.message}\0${diagnostic.range?.startOffset ?? ''}`
      if (reported.has(key)) return
      reported.add(key)
      loader.emitWarning(new Error(located(diagnostic)))
    }
    for (const diagnostic of [...parseDiagnostics, ...rendered.diagnostics]) emit(diagnostic)
    const suppressed = parseSuppressed + rendered.suppressedDiagnostics
    if (suppressed) loader.emitWarning(new Error(`${suppressed} more diagnostics were not reported`))

    if (options.lint) {
      const lint = options.lint === true ? {} : options.lint
      const rules = Object.fromEntries((lint.enabledRules ?? []).map((id) => [id, 'on']))
      const ignored = new Set((lint.ignoredFiles ?? []).map((file) => path.resolve(loader.rootContext, file)))
      for (const diagnostic of carve.lint(text, { includes, extensions: carveOptions.extensions, rules })) {
        if (diagnostic.severity === 'hint' && !lint.hints) continue
        const file = diagnostic.file
          ? path.resolve(options.includeRoot ?? loader.rootContext, diagnostic.file)
          : loader.resourcePath
        if (ignored.has(file)) continue
        emit(diagnostic)
      }
    }

    done(null, [
      `export const source = ${JSON.stringify(text)};`,
      `export const html = ${JSON.stringify(rendered.html)};`,
      `export const frontmatter = ${JSON.stringify(frontmatter)};`,
      'export default html;',
      '',
    ].join('\n'))
  }).catch(done)
}

module.exports.raw = false
