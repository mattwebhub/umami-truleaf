import { expect, test, vi } from 'vitest';
import { render, screen, within } from '@/test/render';
import { ProductBarChart } from './ProductBarChart';

vi.mock('@/components/charts/Chart', () => ({
  Chart: () => <div data-test="visual-chart" />,
}));

test('provides a labelled data table equivalent for the decorative canvas chart', () => {
  render(
    <ProductBarChart
      accessibleLabel="Feature adoption by unique browser sessions"
      labels={['Projects', 'Diary']}
      series={[
        {
          label: 'Unique sessions',
          values: [12, 7],
        },
      ]}
    />,
  );

  expect(screen.getByTestId('visual-chart').parentElement).toHaveAttribute('aria-hidden', 'true');

  const table = screen.getByRole('table', {
    name: 'Feature adoption by unique browser sessions',
  });
  expect(within(table).getByRole('rowheader', { name: 'Projects' })).toBeInTheDocument();
  expect(within(table).getByRole('cell', { name: '12' })).toBeInTheDocument();
  expect(within(table).getByRole('rowheader', { name: 'Diary' })).toBeInTheDocument();
  expect(within(table).getByRole('cell', { name: '7' })).toBeInTheDocument();
});

test('formats percent values in the accessible data table', () => {
  render(
    <ProductBarChart
      accessibleLabel="Retention"
      labels={['Day 1']}
      percent
      series={[
        {
          label: 'Return rate',
          values: [2.5],
        },
      ]}
    />,
  );

  const table = screen.getByRole('table', { name: 'Retention' });
  expect(within(table).getByRole('cell', { name: '2.5%' })).toBeInTheDocument();
});
