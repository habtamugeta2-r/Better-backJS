import Link from 'next/link';
import { Search } from '@/components/search';
import { docNavigation } from '@/lib/docs';

const highlights = [
  {
    number: '01',
    title: 'One schema. Every layer.',
    text: 'Zod contracts power runtime validation, inferred handler types, and OpenAPI docs.',
    icon: '◇',
  },
  {
    number: '02',
    title: 'Express stays Express.',
    text: 'Use the ecosystem you know. Your app is still a real Express 5 application.',
    icon: '↗',
  },
  {
    number: '03',
    title: 'No hidden magic.',
    text: 'Standard decorators and explicit injection. No reflection metadata required.',
    icon: '⌘',
  },
];

export default function Home() {
  return (
    <main className="landing">
      <header className="site-header landing-header">
        <Link aria-label="Better Back home" className="brand" href="/">
          <span className="brand-mark">b.</span>
          <span>
            better<span className="brand-light">back</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="landing-nav">
          <Link href="/docs/quick-start">Documentation</Link>
          <a
            href="https://github.com/habtamugeta2-r/Better-backJS"
            rel="noreferrer"
            target="_blank"
          >
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>
        <Link className="header-cta" href="/docs/quick-start">
          Get started <span aria-hidden="true">→</span>
        </Link>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" /> BETTER BACK v1.1 · EXPRESS 5 + STAGE-3 + STANDARD
            SCHEMA
          </div>
          <h1>
            Backend clarity.
            <br />
            <span>Without the ceremony.</span>
          </h1>
          <p className="hero-description">
            Express 5, Stage-3 decorators, and Zod contracts — working together to make your
            TypeScript backend feel effortless.
          </p>
          <div className="hero-actions">
            <Link className="button button-dark" href="/docs/quick-start">
              Start building <span aria-hidden="true">→</span>
            </Link>
            <a
              className="button button-light"
              href="https://github.com/habtamugeta2-r/Better-backJS"
              rel="noreferrer"
              target="_blank"
            >
              <span className="github-symbol">⌘</span> View on GitHub
            </a>
          </div>
          <div className="hero-footnote">
            <span className="status-dot" /> Open source <span className="footnote-divider">·</span>{' '}
            Node.js 20+ <span className="footnote-divider">·</span> TypeScript first
          </div>
        </div>

        <div aria-label="Example Better Back route" className="code-card">
          <div className="code-card-top">
            <div className="window-dots">
              <i />
              <i />
              <i />
            </div>
            <span>tasks.controller.ts</span>
            <span className="code-language">TypeScript</span>
          </div>
          <div className="code-content">
            <div>
              <span className="line-no">1</span>
              <span className="code-purple">import</span> {'{ Controller, Post, type Ctx }'}{' '}
              <span className="code-purple">from</span>{' '}
              <span className="code-green">'better-back'</span>;
            </div>
            <div>
              <span className="line-no">2</span>
              <span className="code-purple">import</span> {'{ z }'}{' '}
              <span className="code-purple">from</span> <span className="code-green">'zod'</span>;
            </div>
            <div className="code-blank">
              <span className="line-no">3</span>
            </div>
            <div>
              <span className="line-no">4</span>
              <span className="code-purple">const</span> CreateTask = z.
              <span className="code-blue">object</span>({'{'}
            </div>
            <div>
              <span className="line-no">5</span> title: z.<span className="code-blue">string</span>
              ().<span className="code-yellow">min</span>(<span className="code-orange">2</span>),
            </div>
            <div>
              <span className="line-no">6</span>
              {'}'});
            </div>
            <div className="code-blank">
              <span className="line-no">7</span>
            </div>
            <div>
              <span className="line-no">8</span>
              <span className="code-yellow">@Controller</span>(
              <span className="code-green">'/tasks'</span>)
            </div>
            <div>
              <span className="line-no">9</span>
              <span className="code-purple">export class</span>{' '}
              <span className="code-blue">TasksController</span> {'{'}
            </div>
            <div>
              <span className="line-no">10</span> <span className="code-yellow">@Post</span>(
              <span className="code-green">'/'</span>, {'{'} body: CreateTask {'}'})
            </div>
            <div>
              <span className="line-no">11</span> create({'{'} body {'}'}:{' '}
              <span className="code-blue">Ctx</span>&lt;<span className="code-purple">typeof</span>{' '}
              CreateTask&gt;) {'{'}
            </div>
            <div>
              <span className="line-no">12</span> <span className="code-purple">return</span>{' '}
              {'{ id: crypto.randomUUID(), ...body };'}
            </div>
            <div>
              <span className="line-no">13</span> {'}'}
            </div>
            <div>
              <span className="line-no">14</span>
              {'}'}
            </div>
          </div>
          <div className="code-card-bottom">
            <span className="code-check">✓</span> Validated at runtime{' '}
            <span className="bottom-separator">·</span> Inferred at compile time
          </div>
        </div>
        <div aria-hidden="true" className="hero-orbit orbit-one" />
        <div aria-hidden="true" className="hero-orbit orbit-two" />
      </section>

      <section className="trust-strip">
        <span>BUILT ON THE TOOLS YOU TRUST</span>
        <div>
          <b>express</b>
          <i /> Express 5
        </div>
        <div>
          <b>Zod</b>
          <i /> Schema-first
        </div>
        <div>
          <b>TypeScript</b>
          <i /> Strict by default
        </div>
        <div>
          <b>OpenAPI</b>
          <i /> 3.1 generated
        </div>
      </section>

      <section className="features-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" /> THE FRAMEWORK, IN THREE IDEAS
            </div>
            <h2>
              Familiar tools.
              <br />
              <span>Thoughtful connections.</span>
            </h2>
          </div>
          <p>Less framework to learn. More confidence in the code you already write.</p>
        </div>
        <div className="feature-grid">
          {highlights.map((item) => (
            <article className="feature-card" key={item.number}>
              <div className="feature-card-top">
                <span>{item.number}</span>
                <b>{item.icon}</b>
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="docs-cta">
        <div className="cta-mark">b.</div>
        <div>
          <p className="cta-kicker">READY WHEN YOU ARE</p>
          <h2>
            Make your next API
            <br />a little more <em>clear.</em>
          </h2>
        </div>
        <div className="cta-action">
          <Search />
          <div className="popular-links">
            <span>POPULAR</span>
            {docNavigation.slice(0, 3).map((item) => (
              <Link href={`/docs/${item.slug}`} key={item.slug}>
                {item.label} <span>↗</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <Link className="brand" href="/">
          <span className="brand-mark">b.</span>
          <span>
            better<span className="brand-light">back</span>
          </span>
        </Link>
        <span>Made for the back end of things.</span>
        <span>
          Apache-2.0 <span className="footnote-divider">·</span> Built on Express 5
        </span>
      </footer>
    </main>
  );
}
