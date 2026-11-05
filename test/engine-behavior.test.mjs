import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import webpack from 'webpack'

const root = path.resolve(import.meta.dirname, '..')

/**
 * Engine behavior this loader's own path reaches, and that no loader diff would
 * announce. All three changed between the engine the lockfile held (0.1.7) and
 * the one a consumer resolves from `^0.1.7` (0.1.10), and nothing here saw them.
 */
async function build(files, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-behavior-'))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content)
  }
  await writeFile(path.join(dir, 'index.js'), "export {default} from './page.crv'\n")

  const stats = await new Promise((resolve, reject) => {
    webpack({
      mode: 'production', target: 'node', context: dir,
      entry: './index.js',
      output: { path: path.join(dir, 'dist'), filename: 'bundle.cjs', library: { type: 'commonjs2' } },
      module: { rules: [{ test: /\.crv$/, use: [{ loader: path.join(root, 'loader.cjs'), options }] }] },
    }, (error, result) => {
      if (error) return reject(error)
      if (result.hasErrors()) return reject(new Error(result.toString({ errors: true })))
      resolve(result)
    })
  })

  const bundle = await readFile(path.join(dir, 'dist', 'bundle.cjs'), 'utf8')
  const copy = path.join(dir, 'dist', `copy-${Date.now()}.cjs`)
  await writeFile(copy, bundle)
  const loaded = await import(copy)
  return { html: loaded.default.default, warnings: stats.compilation.warnings.map((w) => w.message) }
}

test('a case-only cross-reference stays literal instead of resolving', async () => {
  // Engine 0.1.7 resolved `</#alpha-beta>` against a heading whose id is
  // `Alpha-Beta`; 0.1.10 compares case exactly, so the reference degrades to
  // text and a consumer's page gains visible markup where a link was.
  const { html } = await build({ 'page.crv': '# Alpha Beta\n\n</#alpha-beta>\n' })

  assert.match(html, /&lt;\/#alpha-beta&gt;/)
  assert.doesNotMatch(html, /href="#Alpha-Beta"/)
})

test('an exact cross-reference still resolves and clones the target text', async () => {
  const { html } = await build({ 'page.crv': '# Alpha Beta\n\n</#Alpha-Beta>\n' })

  assert.match(html, /href="#Alpha-Beta">Alpha Beta/)
})

test('an include renames every colliding id, not only a heading id', async () => {
  // Engine 0.1.7 emitted three elements carrying id="dup" from one included
  // file, which is invalid HTML and makes the anchors collide. 0.1.10 renames
  // each later copy and reports every rename.
  const { html, warnings } = await build({
    'child.crv': '{#sec}\n# Shared\n\n{#dup}\nA note.\n',
    'page.crv': '{#dup}\nBefore.\n\n{{ child.crv }}\n\n{{ child.crv }}\n',
  })

  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length, `duplicate ids emitted: ${ids.join(', ')}`)
  assert.ok(ids.includes('dup-2'), `expected a renamed id, got: ${ids.join(', ')}`)
  assert.equal(warnings.filter((message) => /Id "dup" was renamed/.test(message)).length, 2)
})

test('a blanked destination scheme reaches the webpack log', async () => {
  // The engine blanks `javascript:` either way; without the report the author
  // only sees a link that stopped working, with no position.
  for (const includes of [true, false]) {
    const { html, warnings } = await build({ 'page.crv': '[x](javascript:alert(1))\n' }, { includes })

    assert.match(html, /href=""/)
    assert.ok(
      warnings.some((message) =>
        message.includes('Blanked a denied destination scheme [destination-denied] (line 1, column 1)')),
      `no loss warning with includes: ${includes}; got ${JSON.stringify(warnings)}`,
    )
  }
})

test('a render loss in an included file names that file', async () => {
  // The loss carries the included file's own line; without the file name the
  // warning points at a line of the importing document that holds no link.
  const { warnings } = await build({
    'child.crv': 'One.\n\nTwo.\n\nThree [x](javascript:alert(1)).\n',
    'page.crv': 'Top.\n\n{{ child.crv }}\n\n[y](javascript:1)\n',
  })
  const losses = warnings.filter((message) => message.includes('[destination-denied]'))

  assert.equal(losses.length, 2, JSON.stringify(warnings))
  assert.ok(losses.some((message) => /\(.*child\.crv, line 5, column 7\)$/.test(message)), JSON.stringify(losses))
  assert.ok(losses.some((message) => message.endsWith('\nBlanked a denied destination scheme [destination-denied] (line 5, column 1)')), JSON.stringify(losses))
})

test('braced cell alignment renders and the glued 0.1.13 prefix is reported', async () => {
  // markup-carve/carve#5091: alignment moved into the cell's braces; `|=>`
  // still reads the same until 0.2.0, and lint names the new spelling.
  const braced = await build({ 'page.crv': '|= Item |={>} Price |\n| Tea | 3 |\n' }, { lint: true })
  assert.match(braced.html, /<th scope="col" style="text-align: right;">Price<\/th>/)
  assert.deepEqual(braced.warnings, [])

  const glued = await build({ 'page.crv': '|= Item |=> Price |\n| Tea | 3 |\n' }, { lint: true })
  assert.equal(glued.html, braced.html)
  assert.ok(glued.warnings.some((message) => message.includes('[deprecated-cell-alignment] (line 1, column 11)')), JSON.stringify(glued.warnings))
})

test('a lone --- on the first line opens frontmatter to the end of the document', async () => {
  // markup-carve/carve#5016: with no closer the opener claims the rest, so the
  // page renders nothing. Engine 0.1.15 read it as a thematic break.
  const { html } = await build({ 'page.crv': '---\n\n# Title\n' })
  assert.equal(html, '')
})

test('a table include selects records with @rows and columns with @cols', async () => {
  const { html, warnings } = await build({
    'data.csv': 'Name,Qty,Note\nApple,12,fresh\nPear,3,ripe\n',
    'page.crv': '{table}\n{{ data.csv @code:csv @rows:1-2 @cols:"Qty,Name" }}\n',
  })
  assert.match(html, /<tr><th scope="col">Qty<\/th><th scope="col">Name<\/th><\/tr>/)
  assert.match(html, /<tr><td>12<\/td><td>Apple<\/td><\/tr>/)
  assert.doesNotMatch(html, /Pear|fresh/)
  assert.deepEqual(warnings, [])
})
