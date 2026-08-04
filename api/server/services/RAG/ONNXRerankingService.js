const path = require('path');
const fs = require('fs');
const { logger } = require('@because/data-schemas');

// 初始化失败后的冷却时间：避免每次请求都重新触发模型加载 + 全局 fetch 拦截窗口，
// 一旦某次加载失败（例如底层 onnxruntime-node 原生绑定不可用），在冷却期内直接短路，
// 优雅退回默认排序，而不是对每一次问数请求都重复尝试并反复打开拦截窗口。
const INIT_RETRY_COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟

/**
 * ONNX 重排服务
 * 使用本地 ONNX 模型进行文档重排序
 * 使用 @xenova/transformers 库来处理 ONNX 模型
 */
class ONNXRerankingService {
  constructor() {
    // 使用符合 @xenova/transformers 期望的本地目录结构
    // 路径: resources/Xenova/ms-marco-MiniLM-L-6-v2/
    this.resourcesPath = path.join(__dirname, 'onnx', 'reranker', 'resources');
    this.modelPath = path.join(this.resourcesPath, 'Xenova', 'ms-marco-MiniLM-L-6-v2');
    this.pipeline = null;
    this.pipelineType = null; // 'feature-extraction' 或 'text-classification'
    this.initialized = false;
    this.hasLoggedFlatScoreWarning = false;
    // 进程内单例地初始化：并发请求共享同一个 Promise，避免重复加载 90MB 模型、
    // 反复打开下面的全局 fetch 拦截窗口（该窗口在打开期间会连带拦截同一进程里
    // 其他并发请求发出的正常 HTTPS 请求，例如调用大模型网关的请求）。
    this._initPromise = null;
    this._initFailedAt = null;
  }

  /**
   * 初始化 ONNX 模型和 tokenizer（对外入口，做单例化 + 熔断）
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // 熔断：最近初始化失败过，冷却期内直接短路，不再重复加载/重复打开 fetch 拦截窗口
    if (this._initFailedAt && Date.now() - this._initFailedAt < INIT_RETRY_COOLDOWN_MS) {
      throw new Error('ONNX reranker 初始化最近失败，处于冷却期，暂不重试（避免频繁触发风险窗口）');
    }

    // 并发请求（同一进程内）共享同一次初始化，不要各自触发一次加载
    if (!this._initPromise) {
      this._initPromise = this._doInitialize()
        .then(() => {
          this.initialized = true;
          this._initFailedAt = null;
        })
        .catch((error) => {
          this._initFailedAt = Date.now();
          throw error;
        })
        .finally(() => {
          this._initPromise = null;
        });
    }

    return this._initPromise;
  }

  /**
   * 实际执行模型加载（内部方法，由 initialize() 做单例化/熔断包装）
   */
  async _doInitialize() {
    try {
      // 检查模型文件是否存在（使用新的目录结构）
      const modelFile = path.join(this.modelPath, 'onnx', 'model_quantized.onnx');
      const tokenizerFile = path.join(this.modelPath, 'tokenizer.json');
      const configFile = path.join(this.modelPath, 'config.json');

      if (!fs.existsSync(modelFile)) {
        throw new Error(`ONNX reranker model not found at: ${modelFile}`);
      }

      if (!fs.existsSync(tokenizerFile)) {
        throw new Error(`Tokenizer not found at: ${tokenizerFile}`);
      }

      if (!fs.existsSync(configFile)) {
        throw new Error(`Config file not found at: ${configFile}`);
      }

      // 动态加载 @xenova/transformers
      let transformers;
      try {
        transformers = require('@xenova/transformers');
      } catch (error) {
        logger.error('@xenova/transformers not found. Please install it: npm install @xenova/transformers');
        throw new Error('@xenova/transformers is required for ONNX reranking. Install it with: npm install @xenova/transformers');
      }

      // 配置 @xenova/transformers 环境 - 强制离线模式
      // 使用 transformers 的 env API 来禁用远程模型加载
      const { env, pipeline } = transformers;
      
      // 保存原始配置
      const originalAllowRemoteModels = env.allowRemoteModels;
      const originalUseBrowserCache = env.useBrowserCache;
      const originalCacheDir = env.cacheDir;
      
      // 强制离线模式：禁用所有远程模型加载
      env.allowRemoteModels = false;
      env.useBrowserCache = false;
      
      // 设置缓存目录为我们的 resources 目录
      // transformers 会在 cacheDir/Xenova/ms-marco-MiniLM-L-6-v2/ 下查找模型
      env.cacheDir = path.resolve(this.resourcesPath);
      
      // 如果遇到 SSL 证书问题，允许使用不安全的连接（仅用于开发环境）
      const originalTLSReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      if (process.env.NODE_ENV === 'development' || process.env.ALLOW_INSECURE_SSL === 'true') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        logger.warn('[ONNXRerankingService] SSL verification disabled (development mode or ALLOW_INSECURE_SSL=true)');
      }
      
      // 拦截全局 fetch（仅在模型加载期间，且只针对模型/运行时相关的远程地址）。
      // 注意：global.fetch 是整个 Node 进程共享的，如果这里无差别拦截"所有" http(s)
      // 请求，会连带拦截同一进程里其它并发请求发出的正常调用（例如调用大模型网关），
      // 表现为前端"Connection error"。因此只针对已知的模型托管/运行时 CDN 域名做拦截，
      // env.allowRemoteModels=false 已经从 transformers.js 层面阻止了 HF Hub 请求，
      // 这里主要防的是 onnxruntime-web 在 wasm 后端下默认从 CDN 拉取 .wasm 文件的情况。
      const originalFetch = global.fetch;
      let fetchIntercepted = false;
      const resourcesPathResolved = path.resolve(this.resourcesPath);
      const remoteModelHostPatterns = [
        'huggingface.co',
        'hf.co',
        'cdn-lfs',
        'cdn.jsdelivr.net',
        'unpkg.com',
      ];

      // 创建一个只拦截"模型/运行时相关远程地址"的 fetch 拦截器，其它地址原样放行
      global.fetch = function(...args) {
        const url = args[0];
        const urlString = typeof url === 'string' ? url : url?.toString() || '';
        
        // 如果是本地文件路径（file:// 或绝对路径），允许访问
        if (urlString.startsWith('file://') || 
            (urlString.startsWith('/') && !urlString.startsWith('http')) ||
            urlString.includes(resourcesPathResolved)) {
          return originalFetch.apply(this, args);
        }
        
        // 仅阻止指向已知模型托管/运行时 CDN 域名的 HTTP/HTTPS 请求
        const isRemoteModelHost = remoteModelHostPatterns.some((host) => urlString.includes(host));
        if (isRemoteModelHost && (urlString.startsWith('http://') || urlString.startsWith('https://'))) {
          logger.warn(`[ONNXRerankingService] Blocked network request: ${urlString}`);
          return Promise.reject(new Error(`Network requests are disabled in offline mode. Attempted to fetch: ${urlString}`));
        }
        
        // 允许其他类型的请求（可能是本地文件系统操作）
        return originalFetch.apply(this, args);
      };
      
      fetchIntercepted = true;
      
      // 使用模型名称（不是绝对路径），transformers 会在 cacheDir 下查找
      const modelName = 'Xenova/ms-marco-MiniLM-L-6-v2';
      
      logger.info(`[ONNXRerankingService] Loading model: ${modelName}`);
      logger.info(`[ONNXRerankingService] Cache directory: ${env.cacheDir}`);
      logger.info(`[ONNXRerankingService] Allow remote models: ${env.allowRemoteModels}`);
      logger.info(`[ONNXRerankingService] Force offline mode - network requests intercepted`);

      try {
        // 对于 cross-encoder 重排序模型，使用 feature-extraction pipeline
        // ms-marco-MiniLM-L-6-v2 是 cross-encoder 模型，用于计算 query-document 相关性
        try {
          // 尝试使用 feature-extraction pipeline（更适合 cross-encoder）
          this.pipeline = await pipeline(
            'feature-extraction',
            modelName,
            {
              quantized: true,
              device: 'cpu', // 使用 CPU，也可以使用 'gpu'
            }
          );
          this.pipelineType = 'feature-extraction';
        } catch (featureError) {
          // 如果 feature-extraction 失败，回退到 text-classification
          logger.warn(`[ONNXRerankingService] Feature-extraction pipeline failed, falling back to text-classification: ${featureError.message}`);
          this.pipeline = await pipeline(
            'text-classification',
            modelName,
            {
              quantized: true,
              device: 'cpu',
            }
          );
          this.pipelineType = 'text-classification';
        }
      } catch (error) {
        logger.error(`[ONNXRerankingService] Failed to load model: ${error.message}`);
        throw new Error(`Failed to load ONNX reranker model: ${error.message}`);
      } finally {
        // 恢复全局 fetch
        if (fetchIntercepted) {
          global.fetch = originalFetch;
        }
        
        // 恢复 transformers 配置
        if (originalAllowRemoteModels !== undefined) {
          env.allowRemoteModels = originalAllowRemoteModels;
        } else {
          env.allowRemoteModels = true; // 恢复默认值
        }
        
        if (originalUseBrowserCache !== undefined) {
          env.useBrowserCache = originalUseBrowserCache;
        }
        
        if (originalCacheDir !== undefined) {
          env.cacheDir = originalCacheDir;
        } else {
          delete env.cacheDir;
        }
        
        // 恢复 SSL 验证（如果之前禁用了）
        if (originalTLSReject !== undefined) {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTLSReject;
        } else {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
      }

      logger.info('[ONNXRerankingService] ONNX reranker model initialized successfully');
    } catch (error) {
      logger.error('[ONNXRerankingService] Failed to initialize ONNX model:', error);
      throw error;
    }
  }

  /**
   * 对文档进行重排序
   * @param {string} query - 查询文本
   * @param {string[]} documents - 文档数组
   * @param {number} topK - 返回前K个结果
   * @returns {Promise<Array>} 重排后的结果数组，格式: [{ text: string, score: number }]
   */
  async rerank(query, documents, topK = 5) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!documents || documents.length === 0) {
      return [];
    }

    try {
      const results = [];

      // 对每个文档计算相关性分数
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        
        let rawScore = 0;
        let score = 0;

        // 构建查询-文档对（cross-encoder 格式）
        // 注意：实际的 tokenizer 会自动添加 [CLS] 和 [SEP] tokens
        const inputText = `${query} [SEP] ${doc}`;

        try {
          const output = await this.pipeline(inputText);

          if (this.pipelineType === 'feature-extraction') {
            // feature-extraction pipeline 返回特征向量
            // 对于 cross-encoder，我们需要提取 [CLS] token 的表示
            if (Array.isArray(output)) {
              // 输出是 token embeddings 数组，第一个通常是 [CLS] token
              const clsEmbedding = output[0];
              if (Array.isArray(clsEmbedding)) {
                // 计算 [CLS] token embedding 的范数作为相关性分数
                const norm = Math.sqrt(clsEmbedding.reduce((sum, val) => sum + val * val, 0));
                rawScore = norm;
                // 归一化：假设范数范围在 0-20，映射到 0-1
                score = Math.min(1, Math.max(0, norm / 20));
              } else if (typeof clsEmbedding === 'number') {
                rawScore = clsEmbedding;
                score = Math.min(1, Math.max(0, clsEmbedding / 20));
              }
            } else if (output && output.data) {
              // Tensor 格式
              const data = Array.isArray(output.data) ? output.data : Array.from(output.data);
              if (data.length > 0) {
                // 取第一个值（通常是 [CLS] token）
                rawScore = data[0];
                score = Math.min(1, Math.max(0, rawScore / 20));
              }
            } else if (typeof output === 'number') {
              rawScore = output;
              score = Math.min(1, Math.max(0, output / 20));
            } else {
              // 未知格式，尝试提取 score 字段
              if (output && typeof output === 'object' && 'score' in output) {
                rawScore = output.score;
                score = Math.min(1, Math.max(0, rawScore / 20));
              }
            }
          } else {
            // text-classification pipeline 的处理方式
            // 提取分数
            if (Array.isArray(output)) {
              // 如果有多个标签，取最高分的标签
              const maxScoreLabel = output.reduce((max, item) => 
                (item.score > max.score ? item : max)
              );
              rawScore = maxScoreLabel.score;
            } else if (typeof output === 'object' && 'score' in output) {
              rawScore = output.score;
            } else if (typeof output === 'number') {
              rawScore = output;
            } else if (output && output.data) {
              // 如果是 Tensor，取第一个值
              rawScore = Array.from(output.data)[0] || 0;
            }

            // 确保分数在0-1范围内
            score = rawScore;
            if (score < 0) {
              // 如果分数是负数，可能是logits，需要sigmoid归一化
              score = 1 / (1 + Math.exp(-score));
            } else if (score > 1) {
              // 如果分数大于1，可能需要归一化
              score = Math.min(1, score / 10);
            }
          }

          // 调试日志：记录前几个文档的原始输出
          if (i < 3) {
            logger.debug(`[ONNXRerankingService] Document ${i}: rawScore=${rawScore.toFixed(4)}, score=${score.toFixed(4)}, outputType=${typeof output}, pipelineType=${this.pipelineType}`);
          }
        } catch (error) {
          logger.warn(`[ONNXRerankingService] Error processing document ${i}: ${error.message}`);
          // 如果处理失败，使用基于索引的默认分数（避免所有分数相同）
          rawScore = 0.5 - (i / documents.length) * 0.1; // 轻微递减
          score = Math.max(0.1, rawScore);
        }

        results.push({
          text: doc,
          score: score,
          rawScore: rawScore, // 保留原始分数用于调试
          index: i,
        });
      }

      // 按分数降序排序
      results.sort((a, b) => b.score - a.score);

      // 检查是否所有分数都相同（可能是模型输出问题）
      const scores = results.map(r => r.score);
      const allSame = scores.length > 0 && scores.every(s => Math.abs(s - scores[0]) < 0.0001);
      
      if (allSame && results.length > 1) {
        const msg = `[ONNXRerankingService] 所有重排分数都相同 (${scores[0].toFixed(4)})，将回退到检索分数`;
        if (!this.hasLoggedFlatScoreWarning) {
          logger.warn(msg);
          this.hasLoggedFlatScoreWarning = true;
        } else {
          logger.debug(msg);
        }
        logger.debug(`[ONNXRerankingService] 原始分数样本: ${results.slice(0, 3).map(r => `raw=${r.rawScore.toFixed(4)}, score=${r.score.toFixed(4)}`).join(', ')}`);
        
        // 如果所有分数都相同，尝试使用原始分数进行归一化
        const rawScores = results.map(r => r.rawScore);
        const minRaw = Math.min(...rawScores);
        const maxRaw = Math.max(...rawScores);
        
        if (maxRaw > minRaw) {
          // 使用 min-max 归一化重新计算分数
          logger.info(`[ONNXRerankingService] 使用原始分数进行 min-max 归一化: min=${minRaw.toFixed(4)}, max=${maxRaw.toFixed(4)}`);
          results.forEach(result => {
            if (maxRaw > minRaw) {
              result.score = (result.rawScore - minRaw) / (maxRaw - minRaw);
            } else {
              // 如果原始分数也相同，使用基于索引的分数
              result.score = 1.0 - (result.index / results.length) * 0.2; // 0.8 到 1.0 之间
            }
          });
          // 重新排序
          results.sort((a, b) => b.score - a.score);
        } else {
          // 如果原始分数也相同，不再强行改成索引分数。
          // 让上层 RerankingService 检测 allSame 后回退到检索原始分数，避免出现 100%/0% 的误导分数。
          logger.info(`[ONNXRerankingService] 原始分数也相同，保持原始重排分数，交由上层回退到检索分数`);
        }
      }

      // 记录分数分布用于调试
      if (results.length > 0) {
        const finalScores = results.map(r => r.score);
        const minScore = Math.min(...finalScores);
        const maxScore = Math.max(...finalScores);
        const avgScore = finalScores.reduce((a, b) => a + b, 0) / finalScores.length;
        logger.debug(`[ONNXRerankingService] 重排分数分布: 最低=${minScore.toFixed(4)}, 最高=${maxScore.toFixed(4)}, 平均=${avgScore.toFixed(4)}`);
      }

      // 返回前K个结果
      const topResults = results.slice(0, topK).map(item => ({
        text: item.text,
        score: item.score,
        index: item.index,
      }));

      logger.debug(`[ONNXRerankingService] Reranked ${documents.length} documents, returning top ${topResults.length}`);
      return topResults;
    } catch (error) {
      logger.error('[ONNXRerankingService] Error reranking documents:', error);
      // 失败时返回原始顺序
      return documents.slice(0, topK).map((doc, index) => ({
        text: doc,
        score: 1.0 - (index / documents.length), // 简单的降序分数
      }));
    }
  }
}

// 进程级单例：RAGService/RerankingService 目前是"每次请求 new 一个"的用法，
// 如果每个实例各自持有一个 ONNXRerankingService，模型（90MB）会在每次触发 RAG
// 检索时都重新加载一次，且每次都会重新打开上面的全局 fetch 拦截窗口，
// 大幅增加与同进程内其它并发请求（例如调用大模型网关）发生冲突的概率。
// 改为跨请求共享同一个实例后，加载只会发生一次（或按熔断策略稀疏地重试）。
let sharedInstance = null;
function getSharedInstance() {
  if (!sharedInstance) {
    sharedInstance = new ONNXRerankingService();
  }
  return sharedInstance;
}

module.exports = ONNXRerankingService;
module.exports.getSharedInstance = getSharedInstance;

