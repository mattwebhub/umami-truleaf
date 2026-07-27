import { render } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useWebsite } from '@/components/hooks';
import { SessionReviewControl } from './SessionReviewControl';
import { SessionReviewQueue } from './SessionReviewQueue';

const useQuery = vi.fn(() => ({
  data: { data: [] },
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock('@/components/hooks', () => ({
  useWebsite: vi.fn(),
  useNavigation: () => ({ updateParams: vi.fn(() => '') }),
  useApi: () => ({
    get: vi.fn(),
    post: vi.fn(),
    useQuery,
    useMutation: vi.fn(() => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      error: null,
    })),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test('does not render or query review mutations for a read-only website viewer', () => {
  vi.mocked(useWebsite).mockReturnValue({ canUpdate: false } as never);

  const control = render(
    <SessionReviewControl
      websiteId="11111111-1111-4111-8111-111111111111"
      sessionId="22222222-2222-4222-8222-222222222222"
    />,
  );
  const queue = render(<SessionReviewQueue websiteId="11111111-1111-4111-8111-111111111111" />);

  expect(control.container).toBeEmptyDOMElement();
  expect(queue.container).toBeEmptyDOMElement();
  expect(useQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
});
