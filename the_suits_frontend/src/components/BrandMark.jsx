// THE SUITES brand mark: two architectural "twin suite" towers inside a
// soft-rounded frame, with a slim S threading between them. Pure SVG, so it
// stays crisp at any size (top bar on desktop and mobile).
export default function BrandMark({ size = 40, className = "" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="The Suites"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#162442" />
      <rect x="1.5" y="1.5" width="37" height="37" rx="10.5" fill="none" stroke="#2d436b" strokeWidth="1" />
      {/* Twin suites */}
      <line x1="11" y1="10" x2="11" y2="30" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="29" y1="10" x2="29" y2="30" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      {/* Subtle S between the towers */}
      <path
        d="M24.5 12.6C22.6 11.3 15.6 11.1 15.6 15.6C15.6 20 24.4 19.6 24.4 24.4C24.4 28.9 17.4 28.7 15.5 27.4"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
