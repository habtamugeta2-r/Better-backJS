import { createToken } from '../di/tokens.js';

export type MetricLabels = Readonly<Record<string, string | number>>;

export interface HttpMetricObservation {
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface MetricsSnapshot {
  readonly inFlightRequests: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly histograms: Readonly<
    Record<
      string,
      {
        readonly count: number;
        readonly sum: number;
        readonly buckets: Readonly<Record<string, number>>;
      }
    >
  >;
}

/**
 * Vendor-agnostic observability & metrics extension port (OpenTelemetry / Prometheus / StatsD / InMemory).
 */
export interface MetricsPort {
  increment(name: string, labels?: MetricLabels, delta?: number): void;
  gauge(name: string, value: number, labels?: MetricLabels): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  recordHttpRequest(obs: HttpMetricObservation): void;
  trackInFlight(delta: 1 | -1): void;
  toPrometheusText(): string;
  snapshot(): MetricsSnapshot;
  reset?(): void;
}

export const MetricsToken = createToken<MetricsPort>('Metrics');

export interface MetricsPipelineOptions {
  /** Mount the `/metrics` endpoint and collect per-request RED metrics (default: `false`). */
  readonly enabled?: boolean;
  /** HTTP path for metrics scrape endpoint (default: `"/metrics"`). */
  readonly path?: string;
}

const DEFAULT_DURATION_BUCKETS_MS = [
  1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
] as const;

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function escapePromLabelValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabelsKey(labels: MetricLabels | undefined): string {
  if (!labels) return '';
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  entries.sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${sanitizeMetricName(k)}="${escapePromLabelValue(String(v))}"`).join(',')}}`;
}

interface HistogramSeries {
  count: number;
  sum: number;
  readonly bucketCounts: number[];
  readonly labels: MetricLabels | undefined;
}

/**
 * Zero-dependency, bounded in-memory RED metrics collector exporting both
 * OpenMetrics / Prometheus text (`0.0.4`) and structured JSON snapshots.
 */
export class InMemoryMetrics implements MetricsPort {
  private inFlight = 0;
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, Map<string, HistogramSeries>>();
  private readonly buckets: readonly number[];
  private readonly maxSeries: number;

  public constructor(
    options: { readonly bucketsMs?: readonly number[]; readonly maxSeries?: number } = {},
  ) {
    this.buckets = options.bucketsMs ?? DEFAULT_DURATION_BUCKETS_MS;
    this.maxSeries = options.maxSeries ?? 5_000;
  }

  public trackInFlight(delta: 1 | -1): void {
    this.inFlight = Math.max(0, this.inFlight + delta);
  }

  public increment(name: string, labels?: MetricLabels, delta = 1): void {
    const key = `${sanitizeMetricName(name)}${formatLabelsKey(labels)}`;
    if (!this.counters.has(key) && this.counters.size >= this.maxSeries) {
      return;
    }
    this.counters.set(key, (this.counters.get(key) ?? 0) + delta);
  }

  public gauge(name: string, value: number, labels?: MetricLabels): void {
    const key = `${sanitizeMetricName(name)}${formatLabelsKey(labels)}`;
    if (!this.gauges.has(key) && this.gauges.size >= this.maxSeries) {
      return;
    }
    this.gauges.set(key, value);
  }

  public observe(name: string, value: number, labels?: MetricLabels): void {
    const metricName = sanitizeMetricName(name);
    let seriesMap = this.histograms.get(metricName);
    if (!seriesMap) {
      seriesMap = new Map<string, HistogramSeries>();
      this.histograms.set(metricName, seriesMap);
    }

    const labelKey = formatLabelsKey(labels);
    let series = seriesMap.get(labelKey);
    if (!series) {
      if (seriesMap.size >= this.maxSeries) return;
      series = {
        count: 0,
        sum: 0,
        bucketCounts: this.buckets.map(() => 0),
        labels,
      };
      seriesMap.set(labelKey, series);
    }

    series.count += 1;
    series.sum += value;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (value <= this.buckets[i]!) {
        series.bucketCounts[i]! += 1;
      }
    }
  }

  public recordHttpRequest(obs: HttpMetricObservation): void {
    const labels: MetricLabels = {
      method: obs.method,
      route: obs.route,
      status: String(obs.statusCode),
    };
    this.increment('http_requests_total', labels, 1);
    if (obs.statusCode >= 500) {
      this.increment('http_server_errors_total', { method: obs.method, route: obs.route }, 1);
    }
    this.observe('http_request_duration_ms', obs.durationMs, {
      method: obs.method,
      route: obs.route,
    });
  }

  public snapshot(): MetricsSnapshot {
    const countersObj: Record<string, number> = {};
    for (const [k, v] of this.counters) {
      countersObj[k] = v;
    }

    const gaugesObj: Record<string, number> = {};
    for (const [k, v] of this.gauges) {
      gaugesObj[k] = v;
    }

    const histObj: Record<string, { count: number; sum: number; buckets: Record<string, number> }> =
      {};
    for (const [metricName, seriesMap] of this.histograms) {
      for (const [labelKey, series] of seriesMap) {
        const bucketRecord: Record<string, number> = {};
        for (let i = 0; i < this.buckets.length; i += 1) {
          bucketRecord[String(this.buckets[i]!)] = series.bucketCounts[i]!;
        }
        bucketRecord['+Inf'] = series.count;
        histObj[`${metricName}${labelKey}`] = {
          count: series.count,
          sum: Number(series.sum.toFixed(4)),
          buckets: bucketRecord,
        };
      }
    }

    return {
      inFlightRequests: this.inFlight,
      counters: countersObj,
      gauges: gaugesObj,
      histograms: histObj,
    };
  }

  public toPrometheusText(): string {
    const lines: string[] = [
      '# HELP http_requests_in_flight Current number of in-flight HTTP requests.',
      '# TYPE http_requests_in_flight gauge',
      `http_requests_in_flight ${this.inFlight}`,
    ];

    if (this.counters.size > 0) {
      lines.push('# TYPE http_requests_total counter');
      for (const [seriesKey, val] of this.counters) {
        lines.push(`${seriesKey} ${val}`);
      }
    }

    for (const [seriesKey, val] of this.gauges) {
      lines.push(`${seriesKey} ${val}`);
    }

    for (const [metricName, seriesMap] of this.histograms) {
      lines.push(`# TYPE ${metricName} histogram`);
      for (const [labelKey, series] of seriesMap) {
        const baseLabels = series.labels ?? {};
        for (let i = 0; i < this.buckets.length; i += 1) {
          const le = String(this.buckets[i]!);
          const bucketLabels = formatLabelsKey({ ...baseLabels, le });
          lines.push(`${metricName}_bucket${bucketLabels} ${series.bucketCounts[i]!}`);
        }
        const infLabels = formatLabelsKey({ ...baseLabels, le: '+Inf' });
        lines.push(`${metricName}_bucket${infLabels} ${series.count}`);
        lines.push(`${metricName}_sum${labelKey} ${Number(series.sum.toFixed(4))}`);
        lines.push(`${metricName}_count${labelKey} ${series.count}`);
      }
    }

    return `${lines.join('\n')}\n`;
  }

  public reset(): void {
    this.inFlight = 0;
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}
