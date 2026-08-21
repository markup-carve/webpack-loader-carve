import html, { frontmatter } from './welcome.crv'

export default function Page() {
  return <main><p data-title={frontmatter?.content.includes('Next')}>Carve document:</p><article dangerouslySetInnerHTML={{ __html: html }} /></main>
}
