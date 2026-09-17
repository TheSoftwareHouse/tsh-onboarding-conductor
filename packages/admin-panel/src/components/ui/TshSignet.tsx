import type { ReactElement, SVGProps } from 'react';

/** The TSH signet, drawn in `currentColor`. */
export function TshSignet(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 101 161"
      fill="currentColor"
      role="img"
      aria-label="TSH"
      {...props}
    >
      <mask id="tsh-signet-door">
        <rect width="101" height="161" fill="white" />
        <path d="M67.2578 123.287L33.6279 135.719V57.125L67.2578 69.375V123.287Z" fill="black" />
      </mask>
      <path d="M100.95 160.22L0 123.47V0L100.95 36.7499V160.22Z" mask="url(#tsh-signet-door)" />
    </svg>
  );
}
