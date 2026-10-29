import Link from 'next/link';
import { docNavigation } from '@/lib/docs';
import { Search } from './search';

export function DocsShell({
  activeSlug,
  children,
}: {
  activeSlug: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="site-header docs-header">
        <Link aria-label="Better Back home" className="brand" href="/">
          <span className="brand-mark">b.</span>
          <span>
            better<span className="brand-light">back</span>
          </span>
        </Link>
        <div className="header-right">
          <Search />
          <a
            aria-label="Better Back on GitHub"
            className="github-link"
            href="https://github.com/habtamugeta2-r/Better-backJS"
            rel="noreferrer"
            target="_blank"
          >
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>
      <div className="docs-layout">
        <aside aria-label="Documentation navigation" className="docs-sidebar">
          <p className="sidebar-label">DOCUMENTATION</p>
          {docNavigation.map((item, index) => (
            <Link
              aria-current={activeSlug === item.slug ? 'page' : undefined}
              className={`sidebar-link${activeSlug === item.slug ? ' active' : ''}`}
              href={`/docs/${item.slug}`}
              key={item.slug}
            >
              <span className="sidebar-index">{String(index + 1).padStart(2, '0')}</span>
              {item.label}
              {activeSlug === item.slug && <span className="active-dot" />}
            </Link>
          ))}
          <div className="sidebar-card">
            <span className="sidebar-card-icon">✳</span>
            <p>Have an existing API?</p>
            <Link href="/docs/architecture">
              Explore the design <span>→</span>
            </Link>
          </div>
          <div className="sidebar-version">
            <span className="status-dot" /> v1.0 documentation
          </div>
        </aside>
        <main className="docs-main">{children}</main>
      </div>
    </>
  );
}
