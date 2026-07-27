import { Row, Text } from '@umami/react-zen';
import { Logo } from '@/components/svg';
import { useWebsiteBrand } from './WebsiteBrandProvider';

function TruleafMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      style={{ flexShrink: 0 }}
    >
      <rect width="512" height="512" rx="96" fill="#386641" />
      <g transform="translate(96, 96) scale(1.25)">
        <path
          fill="white"
          d="M205.41 159.07a60.9 60.9 0 0 1-31.83 8.86 71.71 71.71 0 0 1-27.36-5.66A55.55 55.55 0 0 0 136 194.51V224a8 8 0 0 1-8.53 8 8.18 8.18 0 0 1-7.47-8.25v-12.44l-38.62-38.62A52.5 52.5 0 0 1 63.44 176a45.82 45.82 0 0 1-23.92-6.67C17.73 156.09 6 125.62 8.27 87.79a8 8 0 0 1 7.52-7.52c37.83-2.23 68.3 9.46 81.5 31.25A46 46 0 0 1 103.74 140a4 4 0 0 1-6.89 2.43l-19.2-20.1a8 8 0 0 0-11.31 11.31l53.88 55.25c.06-.78.13-1.56.21-2.33a68.56 68.56 0 0 1 18.64-39.46l50.59-53.46a8 8 0 0 0-11.31-11.32l-49 51.82a4 4 0 0 1-6.78-1.74c-4.74-17.48-2.65-34.88 6.4-49.82 17.86-29.48 59.42-45.26 111.18-42.22a8 8 0 0 1 7.52 7.52c3 51.77-12.78 93.33-42.26 111.19Z"
        />
      </g>
    </svg>
  );
}

export function WebsiteBrandLogo({ compact = false }: { compact?: boolean }) {
  const brand = useWebsiteBrand();

  if (brand === 'truleaf') {
    return (
      <Row alignItems="center" gap="2" aria-label="Truleaf Analytics">
        <TruleafMark />
        {!compact && (
          <Text
            weight="bold"
            style={{ fontFamily: 'var(--font-truleaf-display), Georgia, serif', fontSize: 19 }}
          >
            Truleaf<span style={{ color: 'var(--primary)' }}>.org</span>
          </Text>
        )}
      </Row>
    );
  }

  return (
    <Row alignItems="center" gap="2" aria-label="Umami">
      <Logo />
      {!compact && <Text weight="bold">umami</Text>}
    </Row>
  );
}
