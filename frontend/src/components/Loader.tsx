interface LoaderProps {
  variant?: 'fullpage' | 'page' | 'inline' | 'button' | 'small';
  label?: string;
  className?: string;
}

export default function Loader({ variant = 'page', label, className }: LoaderProps) {
  const dots = (
    <span className="loader-dots">
      <span className="loader-dot" />
      <span className="loader-dot" />
      <span className="loader-dot" />
    </span>
  );

  if (variant === 'fullpage') {
    return (
      <div className={`loader loader-fullpage ${className || ''}`} role="status">
        {dots}
        {label && <span className="loader-label">{label}</span>}
      </div>
    );
  }

  if (variant === 'button') {
    return (
      <span className={`loader loader-button ${className || ''}`} role="status">
        {dots}
      </span>
    );
  }

  if (variant === 'small') {
    return (
      <span className={`loader loader-small ${className || ''}`} role="status">
        {dots}
      </span>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`loader loader-inline ${className || ''}`} role="status">
        {dots}
        {label && <span className="loader-label">{label}</span>}
      </div>
    );
  }

  // default: page
  return (
    <div className={`loader loader-page ${className || ''}`} role="status">
      {dots}
      {label && <span className="loader-label">{label}</span>}
    </div>
  );
}
