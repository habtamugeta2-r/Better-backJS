import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsShell } from '@/components/docs-shell';
import { docs, getDoc } from '@/lib/docs';

export function generateStaticParams() {
  return docs.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocumentationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getDoc(slug);
  if (!page) notFound();

  const currentIndex = docs.findIndex((doc) => doc.slug === slug);
  const previous = docs[currentIndex - 1];
  const next = docs[currentIndex + 1];

  return (
    <DocsShell activeSlug={slug}>
      <article className="doc-article">
        <div className="breadcrumbs">
          <Link href="/">Home</Link>
          <span>/</span>
          <span>Documentation</span>
          <span>/</span>
          <b>{page.title}</b>
        </div>
        <div className="doc-kicker">
          <span className="status-dot" /> BETTER BACK / GUIDE
        </div>
        <h1>{page.title}</h1>
        <p className="doc-description">{page.description}</p>
        <div className="doc-rule" />
        {page.sections.map((section, index) => (
          <section className="doc-section" id={`section-${index + 1}`} key={section.title}>
            <div className="doc-section-heading">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h2>{section.title}</h2>
            </div>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.bullets && (
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
            {section.code && (
              <div className="doc-code">
                <div className="doc-code-header">
                  <span>EXAMPLE</span>
                  <span>TypeScript</span>
                </div>
                <pre>
                  <code>{section.code}</code>
                </pre>
              </div>
            )}
            {section.note && (
              <aside className="doc-note">
                <span>✳</span>
                {section.note}
              </aside>
            )}
          </section>
        ))}
        <nav aria-label="Documentation pages" className="doc-pagination">
          {previous ? (
            <Link href={`/docs/${previous.slug}`}>
              <span>← PREVIOUS</span>
              <b>{previous.title}</b>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link className="pagination-next" href={`/docs/${next.slug}`}>
              <span>NEXT →</span>
              <b>{next.title}</b>
            </Link>
          )}
        </nav>
      </article>
      <aside className="doc-aside">
        <span>ON THIS PAGE</span>
        {page.sections.map((section, index) => (
          <a href={`#section-${index + 1}`} key={section.title}>
            {section.title}
          </a>
        ))}
        <div className="aside-callout">
          <span>✳</span>
          <p>Everything here is built on tools you already know.</p>
          <a
            href="https://github.com/habtamugeta2-r/Better-backJS"
            rel="noreferrer"
            target="_blank"
          >
            Explore the source ↗
          </a>
        </div>
      </aside>
    </DocsShell>
  );
}
