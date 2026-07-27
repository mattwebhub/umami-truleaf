'use client';

import { Column, Row, Text, useTheme } from '@umami/react-zen';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { Chart } from '@/components/charts/Chart';
import { getThemeColors } from '@/lib/colors';
import { CHART_COLORS } from '@/lib/constants';
import { formatLongNumber } from '@/lib/format';

export type ProductBarSeries = {
  label: string;
  values: number[];
  color?: string;
};

const screenReaderTableStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function ProductBarChart({
  labels,
  series,
  accessibleLabel,
  height = '260px',
  horizontal = false,
  percent = false,
}: {
  labels: string[];
  series: ProductBarSeries[];
  accessibleLabel: string;
  height?: string;
  horizontal?: boolean;
  percent?: boolean;
}) {
  const { theme } = useTheme();
  const { colors } = useMemo(() => getThemeColors(theme), [theme]);
  const formatValue = (value: number) =>
    percent ? `${Number(value).toFixed(1)}%` : formatLongNumber(value);

  const chartData = useMemo(
    () => ({
      labels,
      datasets: series.map((item, index) => ({
        label: item.label,
        data: item.values,
        backgroundColor: item.color ?? CHART_COLORS[index % CHART_COLORS.length],
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 34,
      })),
    }),
    [labels, series],
  );

  const chartOptions = useMemo(() => {
    const valueAxis = {
      beginAtZero: true,
      ...(percent ? { max: 100 } : {}),
      grid: {
        color: colors.chart.line,
      },
      border: {
        color: colors.chart.line,
      },
      ticks: {
        color: colors.chart.text,
        precision: percent ? 1 : 0,
        callback: (value: string | number) => formatValue(Number(value)),
      },
    };
    const categoryAxis = {
      grid: {
        display: false,
      },
      border: {
        color: colors.chart.line,
      },
      ticks: {
        color: colors.chart.text,
      },
    };

    return {
      indexAxis: horizontal ? ('y' as const) : ('x' as const),
      interaction: {
        intersect: false,
        mode: 'index' as const,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (context: { dataset: { label?: string }; parsed: { x: number; y: number } }) => {
              const value = horizontal ? context.parsed.x : context.parsed.y;
              return `${context.dataset.label}: ${formatValue(value)}`;
            },
          },
        },
      },
      scales: {
        x: horizontal ? valueAxis : categoryAxis,
        y: horizontal ? categoryAxis : valueAxis,
      },
    };
  }, [colors, horizontal, percent]);

  return (
    <Column gap="3">
      <div aria-hidden="true">
        <Chart
          type="bar"
          chartData={chartData}
          chartOptions={chartOptions}
          height={height}
          hideLegend
        />
        {series.length > 1 && (
          <Row gap="4" wrap="wrap" justifyContent="center">
            {series.map((item, index) => (
              <Row key={item.label} gap="2" alignItems="center">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: item.color ?? CHART_COLORS[index % CHART_COLORS.length],
                  }}
                />
                <Text color="muted" size="sm">
                  {item.label}
                </Text>
              </Row>
            ))}
          </Row>
        )}
      </div>
      <table style={screenReaderTableStyle}>
        <caption>{accessibleLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            {series.map(item => (
              <th key={item.label} scope="col">
                {item.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, labelIndex) => (
            <tr key={`${label}:${labelIndex}`}>
              <th scope="row">{label}</th>
              {series.map(item => (
                <td key={item.label}>{formatValue(item.values[labelIndex] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Column>
  );
}
