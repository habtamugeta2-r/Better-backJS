import { fork, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import express from 'express';
import { BetterBack, Controller, Get, Module } from '../packages/core/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.resolve(__dirname, 'server-worker.ts');
const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');

interface RunSummary {
  readonly name: string;
  readonly runsReqPerSec: readonly number[];
  readonly medianReqPerSec: number;
  readonly meanReqPerSec: number;
  readonly p50LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly deltaVsRawExpressPct: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(2));
  }
  return Number((sorted[mid] ?? 0).toFixed(2));
}

function mean(values: readonly number[]): number {
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Number((sum / values.length).toFixed(2));
}

function runAutocannon(opts: autocannon.Options): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function spawnServer(mode: string): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const child = fork(tsxCli, [workerScript, mode], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.once('error', reject);
    child.once('message', (msg: unknown) => {
      const port = (msg as { port?: number }).port;
      if (typeof port === 'number' && port > 0) {
        resolve({ child, port });
      } else {
        reject(new Error(`Worker ${mode} failed to report listening port`));
      }
    });
  });
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

async function measureColdStartExpress(iterations: number): Promise<readonly number[]> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    const app = express();
    app.disable('x-powered-by');
    app.get('/hello', (_req, res) => {
      res.json({ message: 'hello world' });
    });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    samples.push(Number((performance.now() - t0).toFixed(3)));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return samples;
}

async function measureColdStartBetterBack(iterations: number): Promise<readonly number[]> {
  @Controller('/hello')
  class BootHelloController {
    @Get('/')
    public hello() {
      return { message: 'hello world' };
    }
  }

  @Module({ controllers: [BootHelloController] })
  class BootAppModule {}

  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    const app = await BetterBack.create(BootAppModule, {
      logger: { level: 'warn' },
      enableShutdownHooks: false,
    });
    await app.listen(0, '127.0.0.1');
    samples.push(Number((performance.now() - t0).toFixed(3)));
    await app.close();
  }
  return samples;
}

async function main(): Promise<void> {
  const connections = 50;
  const warmupSeconds = 2;
  const runDurationSeconds = 3;
  const measuredRuns = 5;

  console.log('====================================================================');
  console.log('BETTER BACK — REPRODUCIBLE BENCHMARK SUITE (ISOLATED SERVER WORKERS)');
  console.log(
    `Node: ${process.version} | Platform: ${os.platform()} ${os.arch()} | CPUs: ${os.cpus().length}`,
  );
  console.log(
    `Method: ${warmupSeconds}s warmup + ${measuredRuns} interleaved runs x ${runDurationSeconds}s @ ${connections} connections`,
  );
  console.log('====================================================================\n');

  const expressColdMs = await measureColdStartExpress(10);
  const betterBackColdMs = await measureColdStartBetterBack(10);
  console.log(
    `Cold Startup (10 runs) — Raw Express median: ${median(expressColdMs)}ms | Better Back median: ${median(betterBackColdMs)}ms\n`,
  );

  const rawSrv = await spawnServer('raw-express');
  const secExpSrv = await spawnServer('express-secured');
  const minSrv = await spawnServer('bb-minimal');
  const defSrv = await spawnServer('bb-default');
  const logSrv = await spawnServer('bb-info-logs');
  const valSrv = await spawnServer('bb-validated');

  const rawUrl = `http://127.0.0.1:${rawSrv.port}/hello`;
  const secExpUrl = `http://127.0.0.1:${secExpSrv.port}/hello`;
  const minUrl = `http://127.0.0.1:${minSrv.port}/hello`;
  const defUrl = `http://127.0.0.1:${defSrv.port}/hello`;
  const logUrl = `http://127.0.0.1:${logSrv.port}/hello`;
  const valUrl = `http://127.0.0.1:${valSrv.port}/users`;
  const postPayload = JSON.stringify({ email: 'bench@better-back.dev', name: 'Bench Runner' });

  console.log('Running warmups across isolated server processes...');
  await runAutocannon({ url: rawUrl, connections, duration: warmupSeconds });
  await runAutocannon({ url: secExpUrl, connections, duration: warmupSeconds });
  await runAutocannon({ url: minUrl, connections, duration: warmupSeconds });
  await runAutocannon({ url: defUrl, connections, duration: warmupSeconds });
  await runAutocannon({ url: logUrl, connections, duration: warmupSeconds });
  await runAutocannon({
    url: valUrl,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: postPayload,
    connections,
    duration: warmupSeconds,
  });

  const buckets = {
    raw: { rps: [] as number[], p50: [] as number[], p99: [] as number[] },
    secExp: { rps: [] as number[], p50: [] as number[], p99: [] as number[] },
    min: { rps: [] as number[], p50: [] as number[], p99: [] as number[] },
    def: { rps: [] as number[], p50: [] as number[], p99: [] as number[] },
    log: { rps: [] as number[], p50: [] as number[], p99: [] as number[] },
    val: { rps: [] as number[], p50: [] as number[], p99: [] as number[] },
  };

  for (let i = 0; i < measuredRuns; i += 1) {
    console.log(`Measured round ${i + 1}/${measuredRuns}...`);

    const rRaw = await runAutocannon({ url: rawUrl, connections, duration: runDurationSeconds });
    buckets.raw.rps.push(Number(rRaw.requests.average.toFixed(2)));
    buckets.raw.p50.push(rRaw.latency.p50);
    buckets.raw.p99.push(rRaw.latency.p99);

    const rSecExp = await runAutocannon({
      url: secExpUrl,
      connections,
      duration: runDurationSeconds,
    });
    buckets.secExp.rps.push(Number(rSecExp.requests.average.toFixed(2)));
    buckets.secExp.p50.push(rSecExp.latency.p50);
    buckets.secExp.p99.push(rSecExp.latency.p99);

    const rMin = await runAutocannon({ url: minUrl, connections, duration: runDurationSeconds });
    buckets.min.rps.push(Number(rMin.requests.average.toFixed(2)));
    buckets.min.p50.push(rMin.latency.p50);
    buckets.min.p99.push(rMin.latency.p99);

    const rDef = await runAutocannon({ url: defUrl, connections, duration: runDurationSeconds });
    buckets.def.rps.push(Number(rDef.requests.average.toFixed(2)));
    buckets.def.p50.push(rDef.latency.p50);
    buckets.def.p99.push(rDef.latency.p99);

    const rLog = await runAutocannon({ url: logUrl, connections, duration: runDurationSeconds });
    buckets.log.rps.push(Number(rLog.requests.average.toFixed(2)));
    buckets.log.p50.push(rLog.latency.p50);
    buckets.log.p99.push(rLog.latency.p99);

    const rVal = await runAutocannon({
      url: valUrl,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: postPayload,
      connections,
      duration: warmupSeconds < runDurationSeconds ? runDurationSeconds : runDurationSeconds,
    });
    buckets.val.rps.push(Number(rVal.requests.average.toFixed(2)));
    buckets.val.p50.push(rVal.latency.p50);
    buckets.val.p99.push(rVal.latency.p99);
  }

  await Promise.all([
    stopServer(rawSrv.child),
    stopServer(secExpSrv.child),
    stopServer(minSrv.child),
    stopServer(defSrv.child),
    stopServer(logSrv.child),
    stopServer(valSrv.child),
  ]);

  const rawMedian = median(buckets.raw.rps);
  const pctDelta = (val: number): number =>
    Number((((val - rawMedian) / rawMedian) * 100).toFixed(2));

  const summaries: readonly RunSummary[] = [
    {
      name: 'Raw Express 5 — Bare (no headers, no correlation ID, no timeout)',
      runsReqPerSec: buckets.raw.rps,
      medianReqPerSec: rawMedian,
      meanReqPerSec: mean(buckets.raw.rps),
      p50LatencyMs: median(buckets.raw.p50),
      p99LatencyMs: median(buckets.raw.p99),
      deltaVsRawExpressPct: 0,
    },
    {
      name: 'Express 5 + helmet + cors + x-request-id + json (Manual Prod Stack)',
      runsReqPerSec: buckets.secExp.rps,
      medianReqPerSec: median(buckets.secExp.rps),
      meanReqPerSec: mean(buckets.secExp.rps),
      p50LatencyMs: median(buckets.secExp.p50),
      p99LatencyMs: median(buckets.secExp.p99),
      deltaVsRawExpressPct: pctDelta(median(buckets.secExp.rps)),
    },
    {
      name: 'Better Back — Engine Core (DI + Routing + Correlation + RFC 7807)',
      runsReqPerSec: buckets.min.rps,
      medianReqPerSec: median(buckets.min.rps),
      meanReqPerSec: mean(buckets.min.rps),
      p50LatencyMs: median(buckets.min.p50),
      p99LatencyMs: median(buckets.min.p99),
      deltaVsRawExpressPct: pctDelta(median(buckets.min.rps)),
    },
    {
      name: 'Better Back — Secure-by-Default (+7 OWASP Headers + CORS + 30s Timeout)',
      runsReqPerSec: buckets.def.rps,
      medianReqPerSec: median(buckets.def.rps),
      meanReqPerSec: mean(buckets.def.rps),
      p50LatencyMs: median(buckets.def.p50),
      p99LatencyMs: median(buckets.def.p99),
      deltaVsRawExpressPct: pctDelta(median(buckets.def.rps)),
    },
    {
      name: 'Better Back — Full Observability (+Pino JSON Request Logs)',
      runsReqPerSec: buckets.log.rps,
      medianReqPerSec: median(buckets.log.rps),
      meanReqPerSec: mean(buckets.log.rps),
      p50LatencyMs: median(buckets.log.p50),
      p99LatencyMs: median(buckets.log.p99),
      deltaVsRawExpressPct: pctDelta(median(buckets.log.rps)),
    },
    {
      name: 'Better Back — Validated POST /users (Body Parse + Zod v4 In/Out)',
      runsReqPerSec: buckets.val.rps,
      medianReqPerSec: median(buckets.val.rps),
      meanReqPerSec: mean(buckets.val.rps),
      p50LatencyMs: median(buckets.val.p50),
      p99LatencyMs: median(buckets.val.p99),
      deltaVsRawExpressPct: pctDelta(median(buckets.val.rps)),
    },
  ];

  const mem = process.memoryUsage();
  const report = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
      rssMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
    },
    methodology: {
      tool: 'autocannon@8.0.0',
      topology:
        'Isolated child server process per target (separate V8 event loop from load generator)',
      connections,
      warmupSeconds,
      runDurationSeconds,
      measuredRuns,
      interleaved: true,
    },
    coldStartupMs: {
      rawExpress: {
        samples: expressColdMs,
        medianMs: median(expressColdMs),
      },
      betterBack: {
        samples: betterBackColdMs,
        medianMs: median(betterBackColdMs),
      },
    },
    throughput: summaries,
  };

  const outPath = path.resolve(__dirname, 'results.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('\n==================== RESULTS SUMMARY ====================');
  for (const s of summaries) {
    const sign = s.deltaVsRawExpressPct >= 0 ? '+' : '';
    console.log(
      `${s.name}\n  Median: ${s.medianReqPerSec} req/s (${sign}${s.deltaVsRawExpressPct}% vs Raw Express) | Mean: ${s.meanReqPerSec} req/s | p50: ${s.p50LatencyMs}ms | p99: ${s.p99LatencyMs}ms | Runs: [${s.runsReqPerSec.join(', ')}]`,
    );
  }
  console.log(`\nSaved raw JSON benchmark data to ${outPath}`);
}

await main();
