import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { useThemeConfig } from '@docusaurus/theme-common';
import styles from './styles.module.css';

type FooterLink = { label?: string; to?: string; href?: string };

// Ejected replacement for the classic footer (THEME.md §5): one row, wordmark and licence on the
// left, links on the right. The classic component is column-based and cannot be coaxed into this
// by CSS alone. Reads the same `themeConfig.footer` shape, so the config stays standard.
export default function Footer(): ReactNode {
  const { footer } = useThemeConfig();
  const wordmark = useBaseUrl('/img/tsh-logo.svg');

  if (!footer) {
    return null;
  }

  const links: FooterLink[] = footer.links.flatMap((entry) =>
    'items' in entry ? (entry.items as FooterLink[]) : [entry as FooterLink],
  );

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <img src={wordmark} alt="The Software House" className={styles.wordmark} />
          <span className={styles.copyright}>{footer.copyright}</span>
        </div>
        <nav className={styles.links} aria-label="Project links">
          {links.map((link) => (
            <Link key={link.label} to={link.to ?? link.href} className={styles.link}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
