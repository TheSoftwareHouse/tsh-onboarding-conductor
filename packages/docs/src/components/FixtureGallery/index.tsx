import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import manifest from '@site/docs/fixtures/fixtures.manifest.json';
import styles from './styles.module.css';

const ALL = 'all';

// The gallery from the design (mockup 1d): filter chips by connector type, a hairline card grid,
// built-in workflows on a filled cell. Data is the manifest the fixtures generator writes.
export default function FixtureGallery(): ReactNode {
  const [filter, setFilter] = useState<string>(ALL);

  const connectorTypes = useMemo(
    () => Array.from(new Set(manifest.flatMap((entry) => entry.connectorTypes))).sort(),
    [],
  );
  const visible = manifest.filter(
    (entry) => filter === ALL || entry.connectorTypes.includes(filter),
  );

  return (
    <div className={styles.gallery}>
      <div className={styles.chips} role="group" aria-label="Filter by connector type">
        {[ALL, ...connectorTypes].map((type) => (
          <button
            key={type}
            type="button"
            className={clsx(styles.chip, filter === type && styles.chipActive)}
            aria-pressed={filter === type}
            onClick={() => setFilter(type)}
          >
            {type === ALL ? 'All workflows' : type}
          </button>
        ))}
      </div>

      <div className={styles.grid}>
        {visible.map((entry) => (
          <Link
            key={entry.docId}
            to={`/fixtures/${entry.docId}`}
            className={clsx(styles.card, entry.scope === 'built-in' && styles.cardBuiltIn)}
          >
            <span className="tsh-caps">
              {entry.scope === 'built-in' ? 'Built-in' : 'Example'} · v{entry.version} ·{' '}
              {entry.authoredAs} steps
            </span>
            <span className={styles.title}>{entry.name}</span>
            <span className={styles.summary}>{entry.summary}</span>
            <span className={styles.meta}>
              {entry.stepCount} steps
              {entry.connectorTypes.length
                ? ` · ${entry.connectorTypes.join(', ')}`
                : ' · no connectors'}
            </span>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
