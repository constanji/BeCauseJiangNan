const {
  runDirectProbe,
  runAssembledProbe,
  DEFAULT_PROMPT,
  LATENCY_PROMPT,
  DECODE_PROMPT,
} = require('./StreamingProbe');
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

function roundRate(n) {
  return Math.round(n * 100) / 100;
}

/** 单路生成速度：completion / (总耗时 - TTFT) */
function computeDecodeRates({ outputTokens, totalMs, ttftMs }) {
  if (ttftMs == null || totalMs == null || !(totalMs > ttftMs) || !(outputTokens > 0)) {
    return null;
  }
  const genMs = totalMs - ttftMs;
  return {
    decodeTps: roundRate(outputTokens / (genMs / 1000)),
    tpotMs: roundRate(genMs / Math.max(outputTokens - 1, 1)),
    genMs,
  };
}

function resolveThroughputSpec(mode, config = {}) {
  if (mode === 'longOutput') {
    return {
      mode,
      logTag: '长输出吞吐',
      prompt: DECODE_PROMPT,
      max_tokens: config.longOutputMaxTokens ?? config.decodeMaxTokens ?? 256,
      timeoutMs: 180000,
      trackTtft: false,
    };
  }
  if (mode === 'longInput') {
    const longInputTokens = config.longInputTokens ?? 4096;
    return {
      mode,
      logTag: '长输入吞吐',
      messages: [
        {
          role: 'user',
          content: `Read the filler below and reply with exactly one word: ok\n\n${fillerTokens(longInputTokens)}`,
        },
      ],
      max_tokens: config.longInputMaxTokens ?? 32,
      timeoutMs: 180000,
      trackTtft: true,
      longInputTokens,
    };
  }
  return {
    mode: 'short',
    logTag: '短请求吞吐',
    prompt: DEFAULT_PROMPT,
    max_tokens: 8,
    timeoutMs: 60000,
    trackTtft: false,
  };
}

async function singleThroughputRequest({ endpoint, model, layer, useAssembled, spec }) {
  const started = Date.now();
  try {
    const probe = useAssembled ? runAssembledProbe : runDirectProbe;
    const r = await probe({
      endpoint,
      model,
      messages: spec.messages,
      options: {
        prompt: spec.prompt,
        max_tokens: spec.max_tokens,
        timeoutMs: spec.timeoutMs,
      },
    });
    const promptTokens = r.promptTokens || 0;
    const outputTokens = r.outputTokens || 0;
    return {
      ok: true,
      durationMs: Date.now() - started,
      promptTokens,
      outputTokens,
      tokens: promptTokens + outputTokens,
      ttftMs: r.ttftMs ?? null,
      layer,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: formatProviderError(err, { model, baseURL: endpoint.base_url }),
      layer,
    };
  }
}

async function measureThroughput({ endpoint, model, layer, config, onLog, mode = 'short' }) {
  const spec = resolveThroughputSpec(mode, config);
  const concurrency = config.concurrency ?? 2;
  const durationSec = config.throughputDurationSec ?? 30;
  const useAssembled = layer === 'assembled';
  const deadline = Date.now() + durationSec * 1000;

  let success = 0;
  let failed = 0;
  let totalTokens = 0;
  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  const ttftList = [];
  const inFlight = new Set();

  const startedAt = Date.now();
  let lastProgressLogAt = startedAt;
  const progressEveryMs = Math.min(5000, Math.max(2000, Math.floor((durationSec * 1000) / 4)));

  onLog?.(
    `[${spec.logTag}] ${layerLabel(layer)}：并发 ${concurrency}，持续 ${durationSec} 秒，max_tokens=${spec.max_tokens}${
      spec.longInputTokens ? `，约 ${spec.longInputTokens} 输入 tokens` : ''
    }`,
  );

  while (Date.now() < deadline) {
    while (inFlight.size < concurrency && Date.now() < deadline) {
      const p = singleThroughputRequest({ endpoint, model, layer, useAssembled, spec })
        .then((res) => {
          if (res.ok) {
            success += 1;
            totalTokens += res.tokens;
            totalPromptTokens += res.promptTokens || 0;
            totalOutputTokens += res.outputTokens || 0;
            if (spec.trackTtft && res.ttftMs != null) ttftList.push(res.ttftMs);
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
      const liveInTps = roundRate(totalPromptTokens / elapsedSec);
      const liveOutTps = roundRate(totalOutputTokens / elapsedSec);
      onLog?.(
        `[${spec.logTag}] ${layerLabel(layer)}进度：已跑 ${elapsedSec.toFixed(0)}s / ${durationSec}s，成功 ${success}、失败 ${failed}，当前约 ${liveRpm} 次/分钟，输入 ${liveInTps} tok/s、输出 ${liveOutTps} tok/s，剩余约 ${remainSec}s`,
      );
    }
  }

  await Promise.allSettled([...inFlight]);

  const elapsedMin = durationSec / 60;
  const inputTps = roundRate(totalPromptTokens / durationSec);
  const outputTps = roundRate(totalOutputTokens / durationSec);
  const result = {
    mode: spec.mode,
    layer,
    concurrency,
    durationSec,
    maxTokens: spec.max_tokens,
    rpm: Math.round(success / elapsedMin),
    tpm: Math.round(totalTokens / elapsedMin),
    inputTps,
    outputTps,
    successCount: success,
    errorCount: failed,
    errorRate: success + failed > 0 ? Math.round((failed / (success + failed)) * 1000) / 1000 : 0,
    totalTokens,
    totalPromptTokens,
    totalOutputTokens,
  };
  if (spec.longInputTokens) result.longInputTokens = spec.longInputTokens;
  if (spec.trackTtft) result.ttftMs = summarize(ttftList);
  return result;
}

async function measureGenerationThroughput({ endpoint, model, layer, config, onLog }) {
  const samples = config.decodeSamples ?? 2;
  const maxTokens = config.decodeMaxTokens ?? 256;
  const useAssembled = layer === 'assembled';
  const runProbe = useAssembled ? runAssembledProbe : runDirectProbe;
  const name = layerLabel(layer);
  const runs = [];

  onLog?.(`[生成速度] ${name}：顺序采样 ${samples} 次，max_tokens=${maxTokens}`);

  for (let i = 0; i < samples; i++) {
    onLog?.(`[生成速度] ${name}：采样 ${i + 1}/${samples} 开始…`);
    const r = await runProbe({
      endpoint,
      model,
      options: {
        prompt: DECODE_PROMPT,
        max_tokens: maxTokens,
        temperature: 0.2,
        timeoutMs: 180000,
        onHeartbeat: (sec) =>
          onLog?.(`[生成速度] ${name}：采样 ${i + 1}/${samples} 仍在生成（已 ${sec}s）…`),
      },
    });
    const rates = computeDecodeRates({
      outputTokens: r.outputTokens,
      totalMs: r.totalMs,
      ttftMs: r.ttftMs,
    });
    runs.push({
      ttftMs: r.ttftMs,
      totalMs: r.totalMs,
      outputTokens: r.outputTokens,
      decodeTps: rates?.decodeTps ?? null,
      tpotMs: rates?.tpotMs ?? null,
    });
    onLog?.(
      `[生成速度] ${name}：采样 ${i + 1}/${samples} 完成（输出 ${r.outputTokens ?? 0} tokens，decodeTps ${
        rates?.decodeTps ?? '—'
      } tok/s）`,
    );
  }

  const decodeList = runs.map((x) => x.decodeTps).filter((v) => v != null);
  const tpotList = runs.map((x) => x.tpotMs).filter((v) => v != null);
  const last = runs[runs.length - 1];

  return {
    layer,
    maxTokens,
    samples: runs.length,
    decodeTps: summarize(decodeList),
    tpotMs: summarize(tpotList),
    outputTokens: summarize(runs.map((x) => x.outputTokens).filter((v) => v != null)),
    totalMs: summarize(runs.map((x) => x.totalMs).filter((v) => v != null)),
    ttftMs: summarize(runs.map((x) => x.ttftMs).filter((v) => v != null)),
    lastRun: last || null,
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
    compare.inputTpsDelta = roundRate(
      (throughput.assembled.inputTps ?? 0) - (throughput.direct.inputTps ?? 0),
    );
    compare.outputTpsDelta = roundRate(
      (throughput.assembled.outputTps ?? 0) - (throughput.direct.outputTps ?? 0),
    );
  }

  return compare;
}

module.exports = {
  collectLatencySamples,
  measureThroughput,
  measureGenerationThroughput,
  measureContextWindow,
  testConnection,
  buildCompareReport,
  computeDecodeRates,
  resolveThroughputSpec,
  roundRate,
};
