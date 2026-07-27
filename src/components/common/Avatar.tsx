import { lorelei } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { useEffect, useMemo, useState } from 'react';
import { getColor, getPastel } from '@/lib/colors';

const lib = lorelei;

export function Avatar({
  seed,
  size = 128,
  src,
  alt = 'Anonymous session',
}: {
  seed: string;
  size?: number;
  src?: string;
  alt?: string;
}) {
  const [sourceFailed, setSourceFailed] = useState(false);
  const backgroundColor = getPastel(getColor(seed), 4);

  const avatar = useMemo(() => {
    return createAvatar(lib, {
      seed,
      size,
      backgroundColor: [backgroundColor],
    }).toDataUri();
  }, [backgroundColor, seed, size]);

  useEffect(() => {
    setSourceFailed(false);
  }, [src]);

  return (
    <img
      src={src && !sourceFailed ? src : avatar}
      alt={alt}
      width={size}
      height={size}
      onError={() => setSourceFailed(true)}
      referrerPolicy="no-referrer"
      style={{ borderRadius: '100%', width: size, height: size, objectFit: 'cover' }}
    />
  );
}
