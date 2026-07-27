import { Server } from '@/components/icons';

export const SERVER_SESSION_NAME = 'Truleaf backend';
export const SERVER_SESSION_DESCRIPTION = 'Server-side event';

export function isServerSession(data?: { serverSession?: boolean }) {
  return data?.serverSession === true;
}

export function ServerSessionAvatar({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-label={SERVER_SESSION_NAME}
      style={{
        alignItems: 'center',
        background: 'var(--base100)',
        border: '1px solid var(--base300)',
        borderRadius: '100%',
        display: 'inline-flex',
        flex: `0 0 ${size}px`,
        height: size,
        justifyContent: 'center',
        width: size,
      }}
    >
      <Server aria-hidden size={Math.round(size * 0.5)} />
    </span>
  );
}
