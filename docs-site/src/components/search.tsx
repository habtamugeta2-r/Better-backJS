'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { docs } from '@/lib/docs';

export function Search() {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTerm = query.trim().toLowerCase();
  const results = docs.filter((doc) =>
    [
      doc.title,
      doc.description,
      ...doc.sections.flatMap((section) => [
        section.title,
        ...(section.paragraphs ?? []),
        ...(section.bullets ?? []),
      ]),
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchTerm),
  );

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setQuery('');
        inputRef.current?.blur();
      }
    }

    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <div className="search-wrap">
      <label className="search-box">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
          <circle cx="8.7" cy="8.7" r="5.7" />
          <path d="m13 13 4 4" />
        </svg>
        <input
          aria-label="Search documentation"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search docs..."
          ref={inputRef}
          type="search"
          value={query}
        />
        <kbd>⌘ K</kbd>
      </label>
      {query.trim() && (
        <div className="search-results">
          {results.length ? (
            results.map((item) => (
              <Link href={`/docs/${item.slug}`} key={item.slug} onClick={() => setQuery('')}>
                <span>{item.title}</span>
                <span aria-hidden="true">↗</span>
              </Link>
            ))
          ) : (
            <p>No pages found for “{query}”.</p>
          )}
        </div>
      )}
    </div>
  );
}
