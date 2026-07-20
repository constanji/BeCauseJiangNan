const { runDirectProbe, runAssembledProbe, DEFAULT_PROMPT, LATENCY_PROMPT } = require('./StreamingProbe');
const { summarize } = require('../lib/stats');
const { createOpenAIClient } = require('./RequestAssembler');
const { formatProviderError } = require('../lib/formatProviderError');

const CONTEXT_ERROR_RE = /context|token|length|413|too long|maximum/i;

function layerLabel(layer) {
  return layer === 'assembled' ? '组装层' : layer === 'direct' ? '直连层' : layer;
}

function fillerTokens(targetTokens) {
  const unit = 'word ';
  const repeat = Math.max(1, Math.ceil((targetTokens * 4) / unit.length));
  return unit.repeat(repeat);
}

async function collectLatencySamples({ endpoint, model, layers, config, onLog }) {
  const warmup = config.warmup ?? 1;
  const samples = config.latencySamples ?? 3;
  const results = { direct: null, assembled: null };

  for (const layer of layers) {
    const runs = [];
    const runProbe = layer === 'direct' ? runDirectProbe : runAssembledProbe;

    const name = layerLabel(layer);
    for (let w = 0; w < warmup; w++) {
      onLog?.(`[延迟] ${name}：预热 ${w + 1}/${warmup} 开始…`);
      const wr = await runProbe({
        endpoint,
        model,
        options: {
          prompt: DEFAULT_PROMPT,
          max_tokens: 16,
          timeoutMs: 60000,
          onHeartbeat: (sec) => onLog?.(`[延迟] ${name}：预热仍在进行（已 ${sec}s）…`),
        },
      });
      onLog?.(`[延迟] ${name}：预热 ${w + 1}/${warmup} 完成（${Math.round((wr.totalMs || 0) / 1000)}s）`);
    }

    for (let i = 0; i < samples; i++) {
      onLog?.(`[延迟] ${name}：采样 ${i + 1}/${samples} 开始…`);
      const r = await runProbe({
        endpoint,
        model,
        options: {
          prompt: LATENCY_PROMPT,
          max_tokens: 64,
          temperature: 0.2,
          timeoutMs: 90000,
          onHeartbeat: (sec) =>
            onLog?.(`[延迟] ${name}：采样 ${i + 1}/${samples} 仍在等待流式输出（已 ${sec}s）…`),
        },
      });
      runs.push(r);
      onLog?.(
        `[延迟] ${name}：采样 ${i + 1}/${samples} 完成（TTFT ${r.ttftMs ?? '—'}ms，总 ${Math.round((r.totalMs || 0) / 1000)}s）`,
      );
    }

    const ttftList = runs.map((r) => r.ttftMs).filter((v) => v != null);
    const chunkItlList = runs.flatMap((r) => r.chunkTimes);
    // 无多 chunk 时，用有效 ITL 近似，避免报告里全是 0
    const itlList =
      chunkItlList.length > 0
        ? chunkItlList
        : runs.map((r) => r.effectiveItlMs).filter((v) => v != null);
    const totalList = runs.map((r) => r.totalMs);
    const itlSource = chunkItlList.length > 0 ? 'stream_chunks' : itlList.length > 0 ? 'estimated' : 'none';

    results[layer] = {
      ttftMs: summarize(ttftList),
      itlMs: {
        ...summarize(itlList),
        source: itlSource,
        note:
          itlSource === 'estimated'
            ? '网关将内容合并为少量流式块，ITL 按「首 token 后耗时/(输出 tokens-1)」估算'
            : itlSource === 'none'
              ? '输出过短或整段一次返回，无可用间隔样本'
              : '来自相邻流式内容块的时间差',
      },
      totalMs: summarize(totalList),
      outputTokens: summarize(runs.map((r) => r.outputTokens)),
      samples: runs.length,
      lastRun: {
        l1: runs[runs.length - 1]?.l1,
        l2: runs[runs.length - 1]?.l2,
        l3: runs[runs.length - 1]?.l3,
        match: runs[runs.length - 1]?.match,
        assemblyNotes: runs[runs.length - 1]?.assemblyNotes,
        contentChunkCount: runs[runs.length - 1]?.contentChunkCount,
      },
    };
  }

  return results;
}

async function singleThroughputRequest({ endpoint, model, layer, useAssembled }) {
  const started = Date.now();
  try {
    const probe = useAssembled
      ? runAssembledProbe
      : runDirectProbe;
    const r = await probe({
      endpoint,
      model,
      options: { prompt: DEFAULT_PROMPT, max_tokens: 8, timeoutMs: 60000 },
    });
    const tokens = (r.promptTokens || 0) + (r.outputTokens || 0);
    return { ok: true, durationMs: Date.now() - started, tokens, layer };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: formatProviderError(err, { model, baseURL: endpoint.base_url }),
      layer,
    };
  }
}

async function measureThroughput({ endpoint, model, layer, config, onLog }) {
  const concurrency = config.concurrency ?? 2;
  const durationSec = config.throughputDurationSec ?? 30;
  const useAssembled = layer === 'assembled';
  const deadline = Date.now() + durationSec * 1000;

  let success = 0;
  let failed = 0;
  let totalTokens = 0;
  const inFlight = new Set();

  const startedAt = Date.now();
  let lastProgressLogAt = startedAt;
  const progressEveryMs = Math.min(5000, Math.max(2000, Math.floor((durationSec * 1000) / 4)));

  onLog?.(
    `[吞吐] ${layerLabel(layer)}：并发 ${concurrency}，持续 ${durationSec} 秒（约每 ${Math.round(progressEveryMs / 1000)} 秒汇报进度）`,
  );

  while (Date.now() < deadline) {
    while (inFlight.size < concurrency && Date.now() < deadline) {
      const p = singleThroughputRequest({ endpoint, model, layer, useAssembled })
        .then((res) => {
          if (res.ok) {
            success += 1;
            totalTokens += res.tokens;
          } else {
            failed += 1;
          }
        })
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
    if (inFlight.size) {
      await Promise.race(inFlight);
    }

    const now = Date.now();
    if (now - lastProgressLogAt >= progressEveryMs) {
      lastProgressLogAt = now;
      const elapsedSec = Math.max(0.001, (now - startedAt) / 1000);
      const remainSec = Math.max(0, Math.ceil((deadline - now) / 1000));
      const liveRpm = Math.round(success / (elapsedSec / 60));
      onLog?.(
        `[吞吐] ${layerLabel(layer)}进度：已跑 ${elapsedSec.toFixed(0)}s / ${durationSec}s，成功 ${success}、失败 ${failed}，当前约 ${liveRpm} 次/分钟，剩余约 ${remainSec}s`,
      );
    }
  }

  await Promise.allSettled([...inFlight]);

  const elapsedMin = durationSec / 60;
  return {
    layer,
    concurrency,
    durationSec,
    rpm: Math.round(success / elapsedMin),
    tpm: Math.round(totalTokens / elapsedMin),
    successCount: success,
    errorCount: failed,
    errorRate: success + failed > 0 ? Math.round((failed / (success + failed)) * 1000) / 1000 : 0,
    totalTokens,
  };
}

async function tryContextSize({ endpoint, model, layer, tokenTarget, useAssembled }) {
  const prompt = `Repeat after me:\n${fillerTokens(tokenTarget)}`;
  const messages = [{ role: 'user', content: prompt }];

  try {
    if (useAssembled) {
      await runAssembledProbe({
        endpoint,
        model,
        messages,
        options: { max_tokens: 1, timeoutMs: 120000 },
      });
    } else {
      await runDirectProbe({
        endpoint,
        model,
        messages,
        options: { max_tokens: 1, timeoutMs: 120000 },
      });
    }
    return { ok: true, tokenTarget };
  } catch (err) {
    const msg = err.message || String(err);
    if (CONTEXT_ERROR_RE.test(msg) || err.status === 413) {
      return { ok: false, tokenTarget, failReason: msg };
    }
    throw err;
  }
}

async function measureContextWindow({ endpoint, model, layer, config, onLog }) {
  const useAssembled = layer === 'assembled';
  const claimed = config.claimedContextTokens ?? endpoint.claimed_context_tokens ?? null;
  const steps = [4096, 8192, 16384, 32768, 65536, 128000, 200000];
  const filtered = claimed ? steps.filter((s) => s <= claimed * 1.1) : steps;

  let maxAccepted = 0;
  let failReason = null;

  for (const target of filtered) {
    onLog?.(`[上下文] ${layerLabel(layer)}：阶梯探测约 ${target} tokens`);
    const res = await tryContextSize({ endpoint, model, layer, tokenTarget: target, useAssembled });
    if (res.ok) {
      maxAccepted = target;
    } else {
      failReason = res.failReason;
      break;
    }
  }

  if (maxAccepted === 0 && filtered.length) {
    let low = 512;
    let high = filtered[0];
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      onLog?.(`[上下文] ${layerLabel(layer)}：二分探测约 ${mid} tokens`);
      const res = await tryContextSize({ endpoint, model, layer, tokenTarget: mid, useAssembled });
      if (res.ok) {
        maxAccepted = mid;
        low = mid + 512;
      } else {
        failReason = res.failReason;
        high = mid - 512;
      }
    }
  }

  return {
    layer,
    claimed,
    measuredMaxAccepted: maxAccepted,
    failReason,
  };
}

async function testConnection({ endpoint, model }) {
  const client = createOpenAIClient(endpoint);
  const body = {
    model: model || endpoint.default_model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 5,
    stream: false,
  };
  const started = Date.now();
  const res = await client.chat.completions.create(body);
  return {
    ok: true,
    latencyMs: Date.now() - started,
    model: res.model,
    content: res.choices?.[0]?.message?.content,
  };
}

function buildCompareReport(identity, latency, throughput) {
  const compare = { modelMismatch: [], ttftDeltaMs: null };

  if (identity.direct && !identity.direct.match) compare.modelMismatch.push('direct');
  if (identity.assembled && !identity.assembled.match) compare.modelMismatch.push('assembled');

  if (latency?.direct?.ttftMs && latency?.assembled?.ttftMs) {
    compare.ttftDeltaMs =
      Math.round((latency.assembled.ttftMs.median - latency.direct.ttftMs.median) * 100) / 100;
  }

  if (throughput?.direct && throughput?.assembled) {
    compare.rpmDelta = throughput.assembled.rpm - throughput.direct.rpm;
    compare.tpmDelta = throughput.assembled.tpm - throughput.direct.tpm;
  }

  return compare;
}

module.exports = {
  collectLatencySamples,
  measureThroughput,
  measureContextWindow,
  testConnection,
  buildCompareReport,
};
