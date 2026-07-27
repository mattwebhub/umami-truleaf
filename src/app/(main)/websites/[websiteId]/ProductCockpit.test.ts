import { expect, test } from 'vitest';
import { canShowReviewQueue } from './ProductCockpit';

test('shows the review queue only to website updaters with moderation access', () => {
  expect(canShowReviewQueue({ openReviews: 2 }, true)).toBe(true);
  expect(canShowReviewQueue({ openReviews: 2 }, false)).toBe(false);
  expect(canShowReviewQueue(null, true)).toBe(false);
});
