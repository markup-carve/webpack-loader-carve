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

test('lints included files and reports an include failure once', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-lint-include-'))
  await writeFile(path.join(dir, 'shared.crv'), 'Bad [l](#zzz).\n')
  const { warnings } = await runLoader(dir, { lint: true }, '{{ shared.crv }}\n\n{{ missing.crv }}\n')
  assert.equal(warnings.filter((w) => w.includes('missing.crv')).length, 1)
  assert.ok(warnings.some((w) => w.includes('[broken-fragment-link]') && w.includes(path.join(dir, 'shared.crv'))))
})

test('an include warning names the included file it arose in', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-nested-'))
  const shared = path.join(dir, 'shared.crv')
  await writeFile(shared, 'Text.\n\n{{ missing.crv }}\n')
  for (const lint of [false, true]) {
    const { warnings } = await runLoader(dir, { lint }, '{{ shared.crv }}\n\n{{ gone.crv }}\n')
    assert.deepEqual(warnings.filter((w) => w.includes('missing.crv')), [
      `Include "missing.crv" could not be resolved. [include-unresolved] (${shared}, line 3, column 1)`,
    ])
    assert.deepEqual(warnings.filter((w) => w.includes('gone.crv')), [
      'Include "gone.crv" could not be resolved. [include-unresolved] (line 3, column 1)',
    ])
  }
})
