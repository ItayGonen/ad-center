import { useState, useEffect } from 'react';
import { generateVideoThumbnail } from '../utils/fileValidation';

interface VideoThumbnailProps {
  source: File | string;
  alt?: string;
  className?: string;
}

export default function VideoThumbnail({ source, alt = '', className }: VideoThumbnailProps) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setThumb(null);
    setError(false);

    generateVideoThumbnail(source)
      .then(url => { if (!cancelled) setThumb(url); })
      .catch(() => { if (!cancelled) setError(true); });

    return () => { cancelled = true; };
  }, [source]);

  if (error) {
    const ext = typeof source === 'string'
      ? source.split('.').pop()?.toUpperCase() || 'VIDEO'
      : source.name.split('.').pop()?.toUpperCase() || 'VIDEO';
    return <span className={className || 'bf-upload-grid-item-type'}>{ext}</span>;
  }

  if (!thumb) {
    return <span className={className || 'bf-upload-grid-item-type'}>...</span>;
  }

  return <img src={thumb} alt={alt} className={className} />;
}
