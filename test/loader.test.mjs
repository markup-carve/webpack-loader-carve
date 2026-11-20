import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import webpack from 'webpack'

const root = path.resolve(import.meta.dirname, '..')

test('a real webpack build imports rendered HTML and metadata', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-'))
  await writeFile(path.join(dir, 'page.crv'), '---\ntitle: Loader\n---\n\n# Hello\n\nA *strong* result.\n')
  await writeFile(path.join(dir, 'index.js'), "export {default, source, frontmatter} from './page.crv'\n")

  await new Promise((resolve, reject) => {
    webpack({
      mode: 'production', target: 'node', context: dir,
      entry: './index.js', output: { path: path.join(dir, 'dist'), filename: 'bundle.cjs', library: { type: 'commonjs2' } },
      module: { rules: [{ test: /\.crv$/, use: [{ loader: path.join(root, 'loader.cjs') }] }] },
    }, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) return reject(new Error(stats.toString({ errors: true, warnings: true })))
      resolve()
    })
  })

  const output = await readFile(path.join(dir, 'dist', 'bundle.cjs'), 'utf8')
  await writeFile(path.join(dir, 'dist', 'bundle-copy.cjs'), output)
  const result = await import(`${path.join(dir, 'dist', 'bundle-copy.cjs')}?t=${Date.now()}`)
  const exports = result.default
  assert.match(exports.default, /<h1[^>]*>Hello<\/h1>/)
  assert.match(exports.default, /<strong>strong<\/strong>/)
  assert.equal(exports.frontmatter.format, 'yaml')
  assert.match(exports.frontmatter.content, /title: Loader/)
  assert.match(exports.source, /# Hello/)
})

test('a build expands an include relative to its document', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-include-'))
  await writeFile(path.join(dir, 'shared.crv'), 'Included text.')
  await writeFile(path.join(dir, 'page.crv'), '{{ shared.crv }}')
  await writeFile(path.join(dir, 'index.js'), "export {default} from './page.crv'\n")

  await new Promise((resolve, reject) => {
    webpack({
      mode: 'production', target: 'node', context: dir,
      entry: './index.js', output: { path: path.join(dir, 'dist'), filename: 'bundle.cjs', library: { type: 'commonjs2' } },
      module: { rules: [{ test: /\.crv$/, use: [{ loader: path.join(root, 'loader.cjs') }] }] },
    }, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) return reject(new Error(stats.toString({ errors: true, warnings: true })))
      resolve()
    })
  })

  const result = await import(`${path.join(dir, 'dist', 'bundle.cjs')}?t=${Date.now()}`)
  assert.match(result.default.default, /Included text\./)
})

test('refuses a relative include root instead of rooting it at the cwd', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-relroot-'))
  const { default: carveLoader } = await import(pathToFileURL(path.join(root, 'loader.cjs')).href)

  const error = await new Promise((resolve) => {
    carveLoader.call({
      async: () => (err) => resolve(err),
      getOptions: () => ({ includeRoot: '..' }),
      rootContext: dir,
      resourcePath: path.join(dir, 'page.crv'),
      addDependency() {},
      emitWarning() {},
    }, '{{ shared.crv }}')
  })

  assert.match(error.message, /absolute path/)
})

async function runLoader(dir, options, source) {
  const { default: carveLoader } = await import(pathToFileURL(path.join(root, 'loader.cjs')).href)
  const warnings = []
  const dependencies = []
  const output = await new Promise((resolve, reject) => {
    carveLoader.call({
      async: () => (err, code) => (err ? reject(err) : resolve(code)),
      getOptions: () => options,
      rootContext: dir,
      resourcePath: path.join(dir, 'page.crv'),
      addDependency: (file) => dependencies.push(file),
      emitWarning: (error) => warnings.push(error.message),
    }, source)
  })
  return { output, warnings, dependencies }
}

test('a build includes only the named region of a file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-region-'))
  await writeFile(path.join(dir, 'shared.crv'), 'Before.\n\n%% #region intro\nInside the region.\n%% #endregion\n\nAfter.\n')
  await writeFile(path.join(dir, 'page.crv'), '{{ shared.crv @region:intro }}')
  await writeFile(path.join(dir, 'index.js'), "export {default} from './page.crv'\n")

  await new Promise((resolve, reject) => {
    webpack({
      mode: 'production', target: 'node', context: dir,
      entry: './index.js', output: { path: path.join(dir, 'dist'), filename: 'bundle.cjs', library: { type: 'commonjs2' } },
      module: { rules: [{ test: /\.crv$/, use: [{ loader: path.join(root, 'loader.cjs') }] }] },
    }, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors() || stats.hasWarnings()) return reject(new Error(stats.toString({ errors: true, warnings: true })))
      resolve()
    })
  })

  const result = await import(`${path.join(dir, 'dist', 'bundle.cjs')}?t=${Date.now()}`)
  assert.match(result.default.default, /Inside the region\./)
  assert.doesNotMatch(result.default.default, /Before\.|After\./)
})

test('includes a named region of a source file as a code block', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-code-region-'))
  const file = path.join(dir, 'example.ts')
  await writeFile(file, 'import x from "y"\n// #region demo\nconst a = 1\n// #endregion\nexport {}\n')
  const { output, warnings, dependencies } = await runLoader(dir, {}, '{{ example.ts @region:demo @code:ts }}')
  assert.match(output, /<pre><code class=\\"language-ts\\">const a = 1\\n<\/code><\/pre>/)
  assert.deepEqual(warnings, [])
  assert.deepEqual(dependencies, [file])
})

test('emits lint findings as warnings when lint is enabled', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-lint-'))
  const { warnings } = await runLoader(dir, { lint: true, includes: false }, 'See [x](#nope).\n')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /\[broken-fragment-link\] \(line 1, column 5\)$/)
})

test('does not lint by default', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-nolint-'))
  const { warnings } = await runLoader(dir, { includes: false }, 'See [x](#nope).\n')
  assert.deepEqual(warnings, [])
})

test('lints included files and reports the include cause and render loss', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-lint-include-'))
  await writeFile(path.join(dir, 'shared.crv'), 'Bad [l](#zzz).\n')
  const { warnings } = await runLoader(dir, { lint: true }, '{{ shared.crv }}\n\n{{ missing.crv }}\n')
  // C2-N-061: a failed include reports its parse cause and its render loss.
  assert.equal(warnings.filter((w) => w.includes('missing.crv')).length, 2)
  assert.ok(warnings.some((w) => w.includes('[broken-fragment-link]') && w.includes(path.join(dir, 'shared.crv'))))
})

test('an include warning names the included file it arose in', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-nested-'))
  const shared = path.join(dir, 'shared.crv')
  await writeFile(shared, 'Text.\n\n{{ missing.crv }}\n')
  for (const lint of [false, true]) {
    const { warnings } = await runLoader(dir, { lint }, '{{ shared.crv }}\n\n{{ gone.crv }}\n')
    // C2-N-061: the missing file's cause precedes its render loss.
    assert.deepEqual(warnings.filter((w) => w.includes('missing.crv')), [
      `Include "missing.crv" was not expanded: the file does not exist. [include-not-found] (${shared}, line 3, column 1)`,
      `Include "missing.crv" could not be resolved. [include-unresolved] (${shared}, line 3, column 1)`,
    ])
    assert.deepEqual(warnings.filter((w) => w.includes('gone.crv')), [
      'Include "gone.crv" was not expanded: the file does not exist. [include-not-found] (line 3, column 1)',
      'Include "gone.crv" could not be resolved. [include-unresolved] (line 3, column 1)',
    ])
  }
})

test('lint hints stay out of the build log unless asked for', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-lint-hint-'))
  const source = 'Text.\n\n---\n\nSee [x](#nope).\n'
  const quiet = await runLoader(dir, { lint: true, includes: false }, source)
  assert.deepEqual(quiet.warnings.map((w) => w.match(/\[([a-z-]+)\]/)[1]), ['broken-fragment-link'])

  const { warnings } = await runLoader(dir, { lint: { hints: true }, includes: false }, source)
  assert.ok(warnings.some((w) => /\[thematic-break-spelling\] \(line 3, column 1\)$/.test(w)), JSON.stringify(warnings))
})

test('lint options turn on opt-in rules and skip ignored files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-lint-options-'))
  await writeFile(path.join(dir, 'vendor.crv'), 'Bad [l](#zzz).\n')
  const source = '{{ vendor.crv }}\n\nSee [x](#nope).\n'

  const all = await runLoader(dir, { lint: true }, source)
  assert.equal(all.warnings.filter((w) => w.includes('[broken-fragment-link]')).length, 2)

  const { warnings } = await runLoader(dir, { lint: { ignoredFiles: ['vendor.crv'] } }, source)
  assert.deepEqual(warnings.filter((w) => w.includes('[broken-fragment-link]')).length, 1)
  assert.ok(!warnings.some((w) => w.includes('vendor.crv')), JSON.stringify(warnings))

  const page = await runLoader(dir, { lint: { ignoredFiles: ['page.crv'] }, includes: false }, 'See [x](#nope).\n')
  assert.deepEqual(page.warnings, [])
})

test('lint enabledRules turns on an opt-in authoring rule', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-lint-enabled-'))
  const source = '# Top\n\nRead [click here](#Top).\n'
  const quiet = await runLoader(dir, { lint: true, includes: false }, source)
  assert.deepEqual(quiet.warnings, [])

  const { warnings } = await runLoader(dir, { lint: { enabledRules: ['non-descriptive-link-text'] }, includes: false }, source)
  assert.ok(warnings.some((w) => w.includes('[non-descriptive-link-text] (line 3, column 6)')), JSON.stringify(warnings))
})

test('Carve 0.2 keeps raw HTML disabled unless explicitly enabled', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-raw-html-'))
  const source = 'Before <b>trusted</b> after.\n'
  const safe = await runLoader(dir, { includes: false }, source)
  const trusted = await runLoader(dir, { includes: false, carveOptions: { rawHtml: true } }, source)
  // C2-H-127: rawHtml defaults to false and an explicit true admits HTML.
  assert.match(safe.output, /&lt;b&gt;trusted&lt;\/b&gt;/)
  assert.match(trusted.output, /<b>trusted<\/b>/)
})

test('Carve 0.2 refuses a removed render option instead of ignoring it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-old-option-'))
  // U-079: host render options must be reviewed when ported to 0.2.
  await assert.rejects(runLoader(dir, { includes: false, carveOptions: { allowRawHtml: true } }, 'Text.\n'),
    /allowRawHtml/)
})

test('Carve 0.2 diagnostic columns count code points in included files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-unicode-column-'))
  const file = path.join(dir, 'child.crv')
  await writeFile(file, '😀 [x](javascript:1)\n')
  const { warnings } = await runLoader(dir, {}, '{{ child.crv }}\n')
  // C2-A-141: the emoji occupies one column and four UTF-8 bytes.
  assert.ok(warnings.some((warning) => warning.includes(`${file}, line 1, column 3)`)), JSON.stringify(warnings))
})

test('render diagnostics past the loss cap are counted, not dropped', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-cap-'))
  const { warnings } = await runLoader(dir, { carveOptions: { maxLosses: 1 } }, '[a](javascript:1) [b](javascript:2) [c](javascript:3)\n')

  assert.equal(warnings.filter((warning) => warning.includes('[destination-denied]')).length, 1)
  assert.ok(warnings.includes('2 more diagnostics were not reported'), warnings.join('\n'))
})
