  <script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { PlusOutlined, DeleteOutlined, QuestionCircleOutlined } from '@ant-design/icons-vue'
import { getProject, createProject, updateProject } from '@/api/project'
import EmailSenderConfig from './components/EmailSenderConfig.vue'
import McpServersConfig from './components/McpServersConfig.vue'

const router = useRouter()
const route = useRoute()

const loading = ref(false)
const saving = ref(false)
const activeTab = ref('basic')

const isEdit = computed(() => !!route.params.id)
const pageTitle = computed(() => isEdit.value ? '编辑项目' : '创建项目')

// Provider 选项及其配置字段定义
const providerConfigs = {
  // LLM Providers
  llm: {
    openai: {
      label: 'OpenAI',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', default: 'https://api.openai.com/v1', required: true, tip: 'OpenAI API 服务器的基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', placeholder: 'gpt-4', required: true, tip: '要使用的模型名称，如 gpt-4、gpt-4o、gpt-3.5-turbo' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'OpenAI API 密钥' },
        { key: 'temperature', label: '温度', type: 'number', step: 0.1, min: 0, max: 2, tip: '控制生成响应的随机性。较高值产生更多样化输出，较低值产生更确定性响应' },
        { key: 'top-p', label: 'Top P', type: 'number', step: 0.1, min: 0, max: 1, tip: '通过设置累积概率阈值控制生成响应的多样性' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间，如 30s、1min' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'max-tokens', label: '最大 Token 数', type: 'number', default: 4096, tip: '模型生成的最大 Token 数量' },
        { key: 'max-completion-tokens', label: '最大完成 Token', type: 'number', default: 4096, tip: 'OpenAI 模型最大完成 Token 数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印 LLM 请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印 LLM 响应日志' },
        { key: 'response-format', label: '响应格式', type: 'text', placeholder: 'json_schema', tip: 'OpenAI LLM 响应格式，如 json_schema' },
        { key: 'strict-json-schema', label: '严格 JSON Schema', type: 'switch', default: false, tip: '是否输出严格的 JSON Schema' },
        { key: 'strict-tools', label: '严格工具模式', type: 'switch', default: false, tip: '是否启用严格工具模式' },
        { key: 'return-thinking', label: '返回思考过程', type: 'switch', default: false, tip: '是否返回思考过程，适用于 DeepSeek 推理模型' },
        { key: 'seed', label: '随机种子', type: 'number', tip: 'OpenAI 模型随机种子' },
        { key: 'user', label: '用户标识', type: 'text', tip: 'OpenAI 用户标识' },
        { key: 'only-support-stream-output', label: '仅支持流式输出', type: 'switch', default: false, tip: '是否仅支持流式输出回复，适用于 Qwen3 等模型' },
        { key: 'http-version', label: 'HTTP 版本', type: 'select', options: [{ label: 'HTTP/2', value: 'HTTP_2' }, { label: 'HTTP/1.1', value: 'HTTP_1_1' }], default: 'HTTP_2', tip: 'HTTP 协议版本，LMStudio 和 vLLM 需要使用 HTTP/1.1' },
      ]
    },
    gemini: {
      label: 'Google Gemini',
      fields: [
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Google AI Gemini API 密钥，可在 https://ai.google.dev/gemini-api/docs/api-key 免费获取' },
        { key: 'model-name', label: '模型名称', type: 'text', placeholder: 'gemini-2.0-flash', required: true, tip: '模型名称，如 gemini-2.5-pro、gemini-2.5-flash、gemini-2.0-flash 等' },
        { key: 'base-url', label: '接口地址', type: 'text', tip: 'Google AI Gemini 服务器的基础 URL（可选）' },
        { key: 'temperature', label: '温度', type: 'number', step: 0.1, min: 0, max: 2, tip: '控制生成响应的随机性' },
        { key: 'top-k', label: 'Top K', type: 'number', min: 1, tip: '指定生成每步时考虑的最高概率 token 数量' },
        { key: 'top-p', label: 'Top P', type: 'number', step: 0.1, min: 0, max: 1, tip: '通过设置累积概率阈值控制生成响应的多样性' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'seed', label: '随机种子', type: 'number', tip: '设置随机种子以便生成可重复的响应' },
        { key: 'frequency-penalty', label: '频率惩罚', type: 'number', step: 0.1, min: 0, max: 2, tip: '频率惩罚值，必须在 0.0 到 2.0 之间' },
        { key: 'presence-penalty', label: '存在惩罚', type: 'number', step: 0.1, min: -2, max: 2, tip: '存在惩罚值，必须在 -2.0 到 2.0 之间' },
        { key: 'max-output-tokens', label: '最大输出 Token', type: 'number', default: 8192, tip: 'Gemini 最大输出 Token 数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印 LLM 请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印 LLM 响应日志' },
        { key: 'send-thinking', label: '发送思考', type: 'switch', default: false, tip: '是否发送思考内容' },
        { key: 'return-thinking', label: '返回思考过程', type: 'switch', default: false, tip: '是否解析并返回 API 响应中的思考字段' },
        { key: 'allow-code-execution', label: '允许代码执行', type: 'switch', default: false, tip: '是否允许代码执行' },
        { key: 'include-code-execution', label: '包含代码执行', type: 'switch', default: false, tip: '是否包含代码执行' },
      ]
    },
    anthropic: {
      label: 'Anthropic Claude',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', required: true, tip: 'Anthropic 服务器的基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', default: 'claude-sonnet-4-20250514', required: true, tip: '模型名称，如 claude-opus-4、claude-sonnet-4、claude-3-5-sonnet 等' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Anthropic API 密钥' },
        { key: 'temperature', label: '温度', type: 'number', step: 0.1, min: 0, max: 2, tip: '控制生成响应的随机性' },
        { key: 'top-p', label: 'Top P', type: 'number', step: 0.1, min: 0, max: 1, tip: '通过设置累积概率阈值控制生成响应的多样性' },
        { key: 'top-k', label: 'Top K', type: 'number', min: 1, tip: '指定生成每步时考虑的最高概率 token 数量' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'max-tokens', label: '最大 Token 数', type: 'number', default: 4096, tip: 'Anthropic 模型最大 Token 数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印 LLM 请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印 LLM 响应日志' },
        { key: 'version', label: 'API 版本', type: 'text', tip: 'Anthropic API 版本' },
        { key: 'beta', label: 'Beta 功能', type: 'text', placeholder: 'prompt-caching-2024-07-31', tip: 'Anthropic Beta 功能，使用缓存请设置为 prompt-caching-2024-07-31' },
        { key: 'cache-system-messages', label: '缓存系统消息', type: 'switch', default: false, tip: '是否缓存系统消息' },
        { key: 'cache-tools', label: '缓存工具', type: 'switch', default: false, tip: '是否缓存工具' },
        { key: 'thinking-type', label: '思考类型', type: 'text', placeholder: 'enabled', tip: 'Anthropic 模型思考类型，启用扩展思考请设置为 enabled' },
        { key: 'thinking-budget-tokens', label: '思考预算 Token', type: 'number', tip: '启用思考后的 Token 预算' },
        { key: 'return-thinking', label: '返回思考过程', type: 'switch', default: false, tip: '是否返回思考过程' },
        { key: 'send-thinking', label: '发送思考', type: 'switch', default: true, tip: '是否在后续请求中发送存储的思考内容' },
      ]
    },
    ollama: {
      label: 'Ollama',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', default: 'http://localhost:11434', required: true, tip: 'Ollama 服务器的基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', required: true, tip: '要使用的 Ollama 模型名称' },
        { key: 'temperature', label: '温度', type: 'number', step: 0.1, min: 0, max: 2, tip: '控制生成响应的随机性' },
        { key: 'top-k', label: 'Top K', type: 'number', min: 1, tip: '指定生成每步时考虑的最高概率 token 数量' },
        { key: 'top-p', label: 'Top P', type: 'number', step: 0.1, min: 0, max: 1, tip: '通过设置累积概率阈值控制生成响应的多样性' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'seed', label: '随机种子', type: 'number', tip: '设置随机种子以便生成可重复的响应' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印 LLM 请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印 LLM 响应日志' },
        { key: 'num-predict', label: '预测数量', type: 'number', tip: '为每个输入提示生成的预测数量' },
        { key: 'think', label: '启用思考', type: 'switch', default: false, tip: '控制 LLM 是否进行思考以及如何思考' },
        { key: 'return-thinking', label: '返回思考过程', type: 'switch', default: false, tip: '是否解析并返回 API 响应中的思考字段' },
      ]
    },
    'azure-openai': {
      label: 'Azure OpenAI',
      fields: [
        { key: 'endpoint', label: '端点地址', type: 'text', placeholder: 'https://{resource}.openai.azure.com', required: true, tip: 'Azure OpenAI 端点，格式: https://{你的资源名称}.openai.azure.com' },
        { key: 'deployment-id', label: '部署 ID', type: 'text', required: true, tip: '已部署模型的部署 ID' },
        { key: 'api-version', label: 'API 版本', type: 'text', required: true, tip: 'Azure OpenAI 的 API 版本' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Azure OpenAI API 密钥' },
        { key: 'temperature', label: '温度', type: 'number', step: 0.1, min: 0, max: 2, tip: '控制生成响应的随机性' },
        { key: 'top-p', label: 'Top P', type: 'number', step: 0.1, min: 0, max: 1, tip: '通过设置累积概率阈值控制生成响应的多样性' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'max-tokens', label: '最大 Token 数', type: 'number', default: 4096, tip: 'Azure OpenAI 模型最大 Token 数' },
        { key: 'log-requests-and-responses', label: '记录请求响应日志', type: 'switch', default: false, tip: '是否打印 LLM 请求和响应日志' },
        { key: 'response-format', label: '响应格式', type: 'select', options: [{ label: '文本', value: 'text' }, { label: 'JSON', value: 'json' }], tip: 'OpenAI LLM 响应格式' },
        { key: 'strict-json-schema', label: '严格 JSON Schema', type: 'switch', default: false, tip: '是否输出严格的 JSON Schema' },
        { key: 'seed', label: '随机种子', type: 'number', tip: 'Azure OpenAI 模型随机种子' },
        { key: 'user', label: '用户标识', type: 'text', tip: 'Azure OpenAI 用户标识' },
      ]
    },
    xinference: {
      label: 'Xinference',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', required: true, tip: 'Xinference 服务器的基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', required: true, tip: '要使用的 Xinference 模型名称' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Xinference API 密钥' },
        { key: 'temperature', label: '温度', type: 'number', step: 0.1, min: 0, max: 2, tip: '控制生成响应的随机性' },
        { key: 'top-p', label: 'Top P', type: 'number', step: 0.1, min: 0, max: 1, tip: '通过设置累积概率阈值控制生成响应的多样性' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'max-tokens', label: '最大 Token 数', type: 'number', default: 4096, tip: 'Xinference 模型最大 Token 数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印 LLM 请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印 LLM 响应日志' },
        { key: 'seed', label: '随机种子', type: 'number', tip: 'Xinference 模型随机种子' },
        { key: 'user', label: '用户标识', type: 'text', tip: 'Xinference 用户标识' },
      ]
    },
  },
  
  // Embedding Providers
  embedding: {
    'bge-small-zh-v15-q': { label: 'BGE Small ZH v15 Q (本地)', fields: [] },
    'bge-small-zh-v15': { label: 'BGE Small ZH v15 (本地)', fields: [] },
    'bge-small-zh': { label: 'BGE Small ZH (本地)', fields: [] },
    openai: {
      label: 'OpenAI',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', default: 'https://api.openai.com/v1', required: true, tip: 'OpenAI API 基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', placeholder: 'text-embedding-ada-002', required: true, tip: 'OpenAI 嵌入模型名称' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'OpenAI API 密钥' },
        { key: 'dimensions', label: '向量维度', type: 'number', tip: 'OpenAI 嵌入模型维度（可选）' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'OpenAI 嵌入模型超时时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'max-segments-per-batch', label: '批量最大分段数', type: 'number', default: 2048, tip: 'OpenAI 嵌入模型批量处理的最大分段数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印嵌入模型请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印嵌入模型响应日志' },
      ]
    },
    jina: {
      label: 'Jina',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', default: 'https://api.jina.ai/', required: true, tip: 'Jina 服务器的基础 URL' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Jina API 密钥' },
        { key: 'model-name', label: '模型名称', type: 'text', required: true, tip: 'Jina 嵌入模型名称' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印嵌入模型请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印嵌入模型响应日志' },
        { key: 'late-chunking', label: '延迟分块', type: 'switch', default: false, tip: '是否启用延迟分块' },
      ]
    },
    ollama: {
      label: 'Ollama',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', default: 'http://localhost:11434', required: true, tip: 'Ollama 服务器的基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', required: true, tip: '要使用的嵌入模型名称' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印嵌入模型请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印嵌入模型响应日志' },
      ]
    },
    'azure-openai': {
      label: 'Azure OpenAI',
      fields: [
        { key: 'endpoint', label: '端点地址', type: 'text', required: true, tip: 'Azure OpenAI 端点地址，格式: https://{资源名称}.openai.azure.com' },
        { key: 'deployment-id', label: '部署 ID', type: 'text', required: true, tip: '已部署模型的部署 ID' },
        { key: 'api-version', label: 'API 版本', type: 'text', required: true, tip: 'Azure OpenAI 的 API 版本' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Azure OpenAI API 密钥' },
        { key: 'dimensions', label: '向量维度', type: 'number', tip: 'Azure OpenAI 嵌入模型维度' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'log-requests-and-responses', label: '记录请求响应日志', type: 'switch', default: false, tip: '是否打印 LLM 请求和响应日志' },
      ]
    },
    xinference: {
      label: 'Xinference',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', required: true, tip: 'Xinference 服务器的基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', required: true, tip: 'Xinference 嵌入模型名称' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Xinference API 密钥' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印嵌入模型请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印嵌入模型响应日志' },
        { key: 'user', label: '用户标识', type: 'text', tip: 'Xinference 用户标识' },
      ]
    },
    onnx: {
      label: 'ONNX (本地)',
      fields: [
        { key: 'model-file-path', label: '模型文件路径', type: 'text', required: true, tip: 'ONNX 模型文件路径，例如: /home/dat/model.onnx' },
        { key: 'tokenizer-file-path', label: '分词器文件路径', type: 'text', required: true, tip: '分词器文件路径，例如: /home/dat/tokenizer.json' },
        { key: 'pooling-mode', label: '池化模式', type: 'select', options: [{ label: 'MEAN', value: 'MEAN' }, { label: 'CLS', value: 'CLS' }], default: 'MEAN', tip: '池化模式，可在 HuggingFace 模型的 1_Pooling/config.json 中查找' },
      ]
    },
  },
  
  // Embedding Store Providers
  embedding_store: {
    duckdb: {
      label: 'DuckDB (本地)',
      fields: [
        { key: 'file-path', label: '文件路径', type: 'text', placeholder: '默认存储在项目 .dat 目录', tip: 'DuckDB 嵌入存储文件路径，项目模式下默认存储在项目根目录的 .dat 目录下' },
      ]
    },
    qdrant: {
      label: 'Qdrant',
      fields: [
        { key: 'host', label: '主机地址', type: 'text', default: 'localhost', required: true, tip: 'Qdrant 服务器主机地址' },
        { key: 'port', label: '端口', type: 'number', default: 6333, required: true, tip: 'Qdrant 端口，默认 6333' },
        { key: 'dimension', label: '向量维度', type: 'number', required: true, placeholder: '与 Embedding 模型维度一致', tip: '嵌入向量的维度，必须与使用的嵌入模型维度一致' },
        { key: 'api-key', label: 'API 密钥', type: 'password', tip: 'Qdrant API 密钥（可选）' },
        { key: 'collection-name-prefix', label: '集合名前缀', type: 'text', default: 'dat_embeddings', tip: 'Qdrant 集合名称前缀' },
        { key: 'distance', label: '距离算法', type: 'select', options: [{ label: 'Cosine', value: 'Cosine' }, { label: 'Euclid', value: 'Euclid' }, { label: 'Dot', value: 'Dot' }, { label: 'Manhattan', value: 'Manhattan' }], default: 'Cosine', tip: 'Qdrant 集合距离算法' },
        { key: 'use-tls', label: '启用 TLS', type: 'switch', default: false, tip: '是否使用传输层安全' },
      ]
    },
    elasticsearch: {
      label: 'Elasticsearch',
      fields: [
        { key: 'server-url', label: '服务器地址', type: 'text', default: 'https://localhost:9200', required: true, tip: 'Elasticsearch 服务器 URL' },
        { key: 'api-key', label: 'API 密钥', type: 'password', tip: 'Elasticsearch API 密钥（可选）' },
        { key: 'index-name-prefix', label: '索引名前缀', type: 'text', default: 'dat_embeddings', tip: 'Elasticsearch 索引名前缀' },
      ]
    },
    pgvector: {
      label: 'PgVector',
      fields: [
        { key: 'host', label: '主机地址', type: 'text', default: 'localhost', required: true, tip: 'PostgreSQL 服务器主机名' },
        { key: 'port', label: '端口', type: 'number', default: 5432, required: true, tip: 'PostgreSQL 服务器端口' },
        { key: 'user', label: '用户名', type: 'text', required: true, tip: '数据库认证用户名' },
        { key: 'password', label: '密码', type: 'password', required: true, tip: '数据库认证密码' },
        { key: 'database', label: '数据库', type: 'text', required: true, tip: '要连接的数据库名称' },
        { key: 'dimension', label: '向量维度', type: 'number', required: true, tip: '嵌入向量的维度，必须与嵌入模型一致' },
        { key: 'table-prefix', label: '表名前缀', type: 'text', default: 'dat_embeddings', tip: '用于存储嵌入的数据库表名前缀' },
        { key: 'use-index', label: '启用索引', type: 'switch', default: false, tip: 'IVFFlat 索引可将向量分成列表进行更快搜索，但查询性能略低于 HNSW' },
        { key: 'index-list-size', label: '索引列表大小', type: 'number', tip: 'IVFFlat 索引的列表数量，启用索引时必须提供且大于零' },
      ]
    },
    weaviate: {
      label: 'Weaviate',
      fields: [
        { key: 'scheme', label: '协议', type: 'select', options: [{ label: 'HTTP', value: 'http' }, { label: 'HTTPS', value: 'https' }], default: 'http', tip: 'Weaviate 连接协议' },
        { key: 'host', label: '主机地址', type: 'text', default: 'localhost', required: true, tip: 'Weaviate 主机地址' },
        { key: 'port', label: '端口', type: 'number', default: 8080, required: true, tip: 'Weaviate 端口' },
        { key: 'api-key', label: 'API 密钥', type: 'password', tip: 'Weaviate API 密钥（可选）' },
        { key: 'class-name-prefix', label: '类名前缀', type: 'text', default: 'DatEmbeddings', tip: '要存储的对象类前缀，必须以大写字母开头' },
      ]
    },
    milvus: {
      label: 'Milvus',
      fields: [
        { key: 'host', label: '主机地址', type: 'text', default: 'localhost', required: true, tip: 'Milvus 实例主机地址' },
        { key: 'port', label: '端口', type: 'number', default: 19530, required: true, tip: 'Milvus 实例端口' },
        { key: 'username', label: '用户名', type: 'text', required: true, tip: 'Milvus 用户名' },
        { key: 'password', label: '密码', type: 'password', required: true, tip: 'Milvus 密码' },
        { key: 'dimension', label: '向量维度', type: 'number', required: true, tip: '嵌入向量的维度，必须与嵌入模型一致' },
        { key: 'database-name', label: '数据库名', type: 'text', tip: '数据库名称（可选）' },
        { key: 'collection-name-prefix', label: '集合名前缀', type: 'text', default: 'dat_embeddings', tip: '集合名称前缀' },
        { key: 'consistency-level', label: '一致性级别', type: 'select', options: [{ label: 'STRONG', value: 'STRONG' }, { label: 'SESSION', value: 'SESSION' }, { label: 'BOUNDED', value: 'BOUNDED' }, { label: 'EVENTUALLY', value: 'EVENTUALLY' }], default: 'EVENTUALLY', tip: '一致性级别：STRONG、SESSION、BOUNDED 或 EVENTUALLY（默认）' },
        { key: 'auto-flush-on-insert', label: '插入后自动刷新', type: 'switch', default: false, tip: '插入后是否自动刷新' },
      ]
    },
  },
  
  // Reranking Providers
  reranking: {
    'ms-marco-MiniLM-L6-v2-q': { label: 'MS-MARCO MiniLM L6 v2 Q (本地)', fields: [] },
    'ms-marco-MiniLM-L6-v2': { label: 'MS-MARCO MiniLM L6 v2 (本地)', fields: [] },
    'ms-marco-TinyBERT-L2-v2-q': { label: 'MS-MARCO TinyBERT L2 v2 Q (本地)', fields: [] },
    jina: {
      label: 'Jina',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', default: 'https://api.jina.ai/v1/', required: true, tip: 'Jina 服务器基础 URL' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Jina API 密钥' },
        { key: 'model-name', label: '模型名称', type: 'text', required: true, tip: 'Jina 重排序模型名称' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印重排序模型请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印重排序模型响应日志' },
      ]
    },
    xinference: {
      label: 'Xinference',
      fields: [
        { key: 'base-url', label: '接口地址', type: 'text', required: true, tip: 'Xinference 服务器基础 URL' },
        { key: 'model-name', label: '模型名称', type: 'text', required: true, tip: 'Xinference 重排序模型名称' },
        { key: 'api-key', label: 'API 密钥', type: 'password', required: true, tip: 'Xinference API 密钥' },
        { key: 'timeout', label: '超时时间', type: 'text', placeholder: '60s', tip: 'API 调用完成的最大允许时间' },
        { key: 'max-retries', label: '最大重试次数', type: 'number', default: 2, min: 0, max: 10, tip: 'API 调用失败时的最大重试次数' },
        { key: 'log-requests', label: '记录请求日志', type: 'switch', default: false, tip: '是否打印 LLM 请求日志' },
        { key: 'log-responses', label: '记录响应日志', type: 'switch', default: false, tip: '是否打印 LLM 响应日志' },
        { key: 'top-n', label: 'Top N', type: 'number', tip: '指定返回的最高结果数量' },
        { key: 'return-documents', label: '返回文档内容', type: 'switch', default: false, tip: '是否返回完整的文档内容' },
        { key: 'return-len', label: '返回结果数量', type: 'switch', default: true, tip: '控制返回结果的数量' },
      ]
    },
    onnx: {
      label: 'ONNX (本地)',
      fields: [
        { key: 'model-file-path', label: '模型文件路径', type: 'text', required: true, tip: 'ONNX 模型文件路径，例如: /home/dat/model.onnx' },
        { key: 'tokenizer-file-path', label: '分词器文件路径', type: 'text', required: true, tip: '分词器文件路径，例如: /home/dat/tokenizer.json' },
      ]
    },
  },
  
  // Content Store Providers
  content_store: {
    default: {
      label: '默认',
      fields: [
        { key: 'max-results', label: '最大结果数', type: 'number', default: 5, min: 1, max: 200, tip: '内容存储检索 TopK 最大值，必须在 1 到 200 之间' },
        { key: 'min-score', label: '最低相似度', type: 'number', default: 0.6, step: 0.1, min: 0, max: 1, tip: '内容存储检索分数最小值，必须在 0.0 到 1.0 之间' },
        { key: 'default-llm', label: '默认 LLM', type: 'llm-select', tip: '指定默认使用的 LLM 模型名称' },
        { key: 'rerank-mode', label: '启用重排序', type: 'switch', default: false, tip: '重排序模型会根据与用户查询的语义匹配重新排序候选内容列表，提高语义排名结果' },
        { key: 'rerank-max-results', label: '重排序最大结果数', type: 'number', default: 4, min: 1, max: 20, tip: '内容存储重排序 TopK 最大值，必须在 1 到 max-results 之间，且不超过 20' },
        { key: 'rerank-min-score', label: '重排序最低分数', type: 'number', step: 0.1, min: 0, max: 1, tip: '内容存储重排序分数最小值' },
        { key: 'use-llm-reranking', label: 'LLM 重排序', type: 'switch', default: false, tip: '使用 LLM 进行重排序，启用后将不使用评分（重排序）模型' },
        { key: 'reranking-llm', label: '重排序 LLM', type: 'llm-select', tip: '使用 LLM 重排序时的模型名称，未设置则使用 default-llm（注意：分数范围 [0, 10]）' },
        { key: 'semantic-model.indexing-method', label: '语义模型索引方法', type: 'select', options: [{ label: 'CE (列嵌入)', value: 'CE' }, { label: 'FE (完整嵌入)', value: 'FE' }, { label: 'HYQE (假设问题嵌入)', value: 'HYQE' }], default: 'CE', tip: '语义模型索引方法' },
        { key: 'semantic-model.indexing.hyqe-llm', label: 'HyQE LLM', type: 'llm-select', tip: '语义模型 HyQE 索引方法使用的 LLM 模型名称' },
        { key: 'semantic-model.indexing.hyqe-question-num', label: 'HyQE 问题数量', type: 'number', default: 5, min: 3, max: 20, tip: '语义模型 HyQE 索引方法生成的问题数量，必须在 3 到 20 之间' },
        { key: 'semantic-model.retrieval.max-results', label: '语义模型最大结果数', type: 'number', min: 1, max: 200, tip: '语义模型检索 TopK 最大值，未设置则使用 max-results' },
        { key: 'semantic-model.retrieval.min-score', label: '语义模型最低分数', type: 'number', step: 0.1, min: 0, max: 1, tip: '语义模型检索分数最小值，未设置则使用 min-score' },
        { key: 'business-knowledge.indexing-method', label: '业务知识索引方法', type: 'select', options: [{ label: 'PCCE (父子分块嵌入)', value: 'PCCE' }, { label: 'FE (完整嵌入)', value: 'FE' }, { label: 'GCE (通用分块嵌入)', value: 'GCE' }], default: 'PCCE', tip: '业务知识索引方法' },
        { key: 'business-knowledge.indexing.gce-max-chunk-size', label: 'GCE 最大块大小', type: 'number', default: 512, tip: '业务知识 GCE 索引方法最大块长度' },
        { key: 'business-knowledge.indexing.gce-max-chunk-overlap', label: 'GCE 块重叠大小', type: 'number', default: 0, tip: '业务知识 GCE 索引方法最大块重叠长度' },
        { key: 'business-knowledge.indexing.pcce-parent-mode', label: 'PCCE 父块模式', type: 'select', options: [{ label: 'FULLTEXT (全文)', value: 'FULLTEXT' }, { label: 'PARAGRAPH (段落)', value: 'PARAGRAPH' }], default: 'FULLTEXT', tip: '业务知识 PCCE 索引方法父块模式' },
        { key: 'business-knowledge.indexing.pcce-parent-max-chunk-size', label: 'PCCE 父块最大大小', type: 'number', default: 1024, tip: '业务知识 PCCE 索引方法父块最大长度' },
        { key: 'business-knowledge.indexing.pcce-child-max-chunk-size', label: 'PCCE 子块最大大小', type: 'number', default: 512, tip: '业务知识 PCCE 索引方法子块最大长度' },
        { key: 'business-knowledge.retrieval.max-results', label: '业务知识最大结果数', type: 'number', min: 1, max: 200, tip: '业务知识检索 TopK 最大值，未设置则使用 max-results' },
        { key: 'business-knowledge.retrieval.min-score', label: '业务知识最低分数', type: 'number', step: 0.1, min: 0, max: 1, tip: '业务知识检索分数最小值，未设置则使用 min-score' },
        { key: 'synonym.retrieval.max-results', label: '同义词最大结果数', type: 'number', min: 1, max: 200, tip: '同义词检索 TopK 最大值，未设置则使用 max-results' },
        { key: 'synonym.retrieval.min-score', label: '同义词最低分数', type: 'number', step: 0.1, min: 0, max: 1, tip: '同义词检索分数最小值。同义词是短词与用户整句匹配，建议比全局 min-score 低（如 0.4），未设置则使用 min-score' },
      ]
    },
  },
  
  // Agent Providers
  agent: {
    default: {
      label: '默认 (工作流模式)',
      fields: [
        { key: 'default-llm', label: '默认 LLM', type: 'llm-select', tip: '指定默认使用的 LLM 模型名称' },
        { key: 'language', label: '回复语言', type: 'select', options: [{ label: '简体中文', value: 'Simplified Chinese' }, { label: '英文', value: 'English' }, { label: '日语', value: 'Japanese' }, { label: '韩语', value: 'Korean' }], default: 'Simplified Chinese', tip: '对话中回答使用的语言，如 Simplified Chinese、English 等' },
        { key: 'intent-classification', label: '意图分类', type: 'switch', default: true, tip: '是否启用意图分类功能' },
        { key: 'intent-classification-llm', label: '意图分类 LLM', type: 'llm-select', tip: '指定意图分类使用的 LLM 模型名称，未指定则使用默认 LLM' },
        { key: 'sql-generation-reasoning', label: 'SQL 生成推理', type: 'switch', default: true, tip: '是否启用 SQL 生成推理功能' },
        { key: 'sql-generation-reasoning-llm', label: 'SQL 推理 LLM', type: 'llm-select', tip: '指定 SQL 生成推理使用的 LLM 模型名称，未指定则使用默认 LLM' },
        { key: 'sql-generation-llm', label: 'SQL 生成 LLM', type: 'llm-select', tip: '指定 SQL 生成使用的 LLM 模型名称，未指定则使用默认 LLM' },
        { key: 'max-histories', label: '最大历史记录', type: 'number', default: 20, min: 0, tip: '最大历史记录数量' },
        { key: 'data-preview', label: '数据预览', type: 'switch', default: false, tip: '附加数据库记录样本，让 LLM 更好地理解您的数据结构' },
        { key: 'data-preview-limit', label: '数据预览条数', type: 'number', default: 3, min: 1, max: 20, tip: '从数据库获取并展示给 LLM 的最大样本记录数，值必须在 1 到 20 之间' },
        { key: 'text-to-sql-rules', label: 'Text-to-SQL 规则', type: 'textarea', tip: '自定义 Text-to-SQL 规则，为空时使用内置规则' },
        { key: 'instruction', label: '自定义指令', type: 'textarea', tip: '用户自定义指令' },
        { key: 'index-ask', label: '指标问数', type: 'switch', default: false, tip: '开启后启用指标库召回、组织权限拦截、日期场景识别、字段白名单等指标问数链路。需要每次问数携带 org_code' },
        { key: 'index-ask-llm', label: '指标问数 LLM', type: 'llm-select', tip: '指标上下文解析使用的 LLM 模型名称，未指定则使用默认 LLM' },
        { key: 'rule-based-sql', label: '规则生成 SQL', type: 'switch', default: false, tip: '指标问数场景下，使用预定义 SQL 模板直接生成查询语句，跳过 LLM 调用。仅指标问数开启且候选指标唯一时生效。默认关闭' },
      ]
    },
    agentic: {
      label: 'Agentic (函数调用模式)',
      fields: [
        { key: 'default-llm', label: '默认 LLM', type: 'llm-select', tip: '指定默认使用的 LLM 模型名称。注意：此模型需要支持工具（函数调用）' },
        { key: 'max-messages', label: '最大消息数', type: 'number', default: 100, min: 1, tip: '最大消息数量，包括用户、助手和工具的消息' },
        { key: 'max-histories', label: '最大历史记录', type: 'number', default: 0, min: 0, tip: '用户问答 SQL 配对历史的最大数量，值必须大于或等于 0' },
        { key: 'max-tools-invocations', label: '最大工具调用次数', type: 'number', default: 10, min: 1, max: 100, tip: '最大工具调用次数，值必须在 1 到 100 之间' },
        { key: 'data-preview', label: '数据预览', type: 'switch', default: false, tip: '附加数据库记录样本，让 LLM 更好地理解您的数据结构' },
        { key: 'data-preview-limit', label: '数据预览条数', type: 'number', default: 3, min: 1, max: 20, tip: '从数据库获取并展示给 LLM 的最大样本记录数，值必须在 1 到 20 之间' },
        { key: 'sql-generation-llm', label: 'SQL 生成 LLM', type: 'llm-select', tip: '指定 SQL 生成使用的 LLM 模型名称，未指定则使用默认 LLM' },
        { key: 'text-to-sql-rules', label: 'Text-to-SQL 规则', type: 'textarea', tip: '自定义 Text-to-SQL 规则，为空时使用内置规则' },
        { key: 'instruction', label: '自定义指令', type: 'textarea', tip: '用户自定义指令' },
        { key: 'human-in-the-loop', label: '人机交互', type: 'switch', default: true, tip: '启用人机交互 (HITL)，允许系统在执行某些操作前请求用户输入或批准' },
        { key: 'human-in-the-loop.ask-user', label: 'HITL 询问用户', type: 'switch', default: true, tip: '允许系统在缺少信息时询问用户输入' },
        { key: 'human-in-the-loop.tool-approval', label: 'HITL 工具审批', type: 'switch', default: false, tip: '在执行工具前请求用户批准' },
        { key: 'human-in-the-loop.tool-not-approval-and-feedback', label: 'HITL 拒绝反馈', type: 'switch', default: true, tip: '当用户不批准工具执行时要求提供反馈' },
      ]
    },
  },
}

// 获取 provider 列表
const getProviderOptions = (type) => {
  const configs = providerConfigs[type] || {}
  return Object.entries(configs).map(([key, value]) => ({
    value: key,
    label: value.label || key,
  }))
}

// 获取 provider 的配置字段
const getProviderFields = (type, provider) => {
  return providerConfigs[type]?.[provider]?.fields || []
}

// 默认表单数据
const getDefaultFormState = () => ({
  name: '',
  description: '',
  version: 1,
  configuration: {},
  llms: [
    {
      name: 'default',
      provider: 'openai',
      configuration: {
        'base-url': 'https://api.openai.com/v1',
        'model-name': '',
        'api-key': '',
      },
    },
  ],
  agents: [
    {
      name: 'default',
      description: '',
      provider: 'default',
      semantic_models: [],
      semantic_model_tags: [],
      configuration: {
        'default-llm': 'default',
        'language': 'Simplified Chinese',
      },
    },
  ],
  embedding: {
    provider: 'bge-small-zh-v15-q',
    configuration: {},
  },
  embedding_store: {
    provider: 'pgvector',
    configuration: {
      'host': 'pgvector',
      'port': 5432,
      'user': 'dat',
      'password': 'dat123',
      'database': 'dat_embeddings',
      'dimension': 512,
      'table-prefix': 'dat_embeddings',
    },
  },
  content_store: {
    provider: 'default',
    configuration: {
      'max-results': 5,
      'min-score': 0.6,
      'synonym.retrieval.max-results': 8,
      'synonym.retrieval.min-score': 0.4,
    },
  },
  reranking: {
    provider: 'ms-marco-MiniLM-L6-v2-q',
    configuration: {},
  },
})

const formState = ref(getDefaultFormState())

const rules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
}

// 加载项目数据
const loadProject = async () => {
  if (!isEdit.value) return
  
  loading.value = true
  try {
    const project = await getProject(route.params.id)
    formState.value = {
      ...getDefaultFormState(),
      ...project,
      llms: project.llms?.length ? project.llms : getDefaultFormState().llms,
      agents: project.agents?.length ? project.agents : getDefaultFormState().agents,
      embedding: project.embedding || getDefaultFormState().embedding,
      embedding_store: project.embedding_store || getDefaultFormState().embedding_store,
      content_store: project.content_store || getDefaultFormState().content_store,
      reranking: project.reranking || getDefaultFormState().reranking,
    }
  } catch (error) {
    message.error('加载项目失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// LLM 操作
const addLlm = () => {
  formState.value.llms.push({
    name: `llm_${formState.value.llms.length}`,
    provider: 'openai',
    configuration: {
      'base-url': 'https://api.openai.com/v1',
    },
  })
}

const removeLlm = (index) => {
  if (formState.value.llms.length > 1) {
    formState.value.llms.splice(index, 1)
  } else {
    message.warning('至少需要一个 LLM 配置')
  }
}

// Agent 操作
const addAgent = () => {
  formState.value.agents.push({
    name: `agent_${formState.value.agents.length}`,
    description: '',
    provider: 'default',
    semantic_models: [],
    semantic_model_tags: [],
    configuration: {
      'default-llm': 'default',
    },
  })
}

const removeAgent = (index) => {
  if (formState.value.agents.length > 1) {
    formState.value.agents.splice(index, 1)
  } else {
    message.warning('至少需要一个 Agent 配置')
  }
}

// 提交表单
const handleSubmit = async () => {
  if (!formState.value.name?.trim()) {
    message.error('请输入项目名称')
    activeTab.value = 'basic'
    return
  }
  
  saving.value = true
  try {
    const data = {
      ...formState.value,
      llms: formState.value.llms.map(llm => ({
        ...llm,
        configuration: llm.configuration || {},
      })),
      agents: formState.value.agents.map(agent => ({
        ...agent,
        semantic_models: agent.semantic_models || [],
        semantic_model_tags: agent.semantic_model_tags || [],
        configuration: agent.configuration || {},
      })),
    }
    
    if (isEdit.value) {
      await updateProject(route.params.id, data)
      message.success('项目更新成功')
    } else {
      await createProject(data)
      message.success('项目创建成功')
    }
    router.push('/projects')
  } catch (error) {
    message.error('保存失败: ' + error.message)
  } finally {
    saving.value = false
  }
}

const handleCancel = () => {
  router.back()
}

onMounted(() => {
  loadProject()
})
</script>

<template>
  <div class="project-form">
    <div class="page-header">
      <h2>{{ pageTitle }}</h2>
    </div>

    <a-spin :spinning="loading">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 基本信息 -->
        <a-tab-pane key="basic" tab="基本信息">
          <a-form :model="formState" :rules="rules" layout="vertical" style="max-width: 600px">
            <a-form-item label="项目名称" name="name" required>
              <a-input v-model:value="formState.name" placeholder="请输入项目名称" />
            </a-form-item>

            <a-form-item label="项目描述" name="description">
              <a-textarea v-model:value="formState.description" placeholder="请输入项目描述" :rows="3" />
            </a-form-item>

            <a-form-item label="版本号" name="version">
              <a-input-number v-model:value="formState.version" :min="1" style="width: 100%" />
            </a-form-item>
          </a-form>
        </a-tab-pane>

        <!-- LLM 配置 -->
        <a-tab-pane key="llms" tab="大模型 (LLM)">
          <div class="config-section">
            <div class="section-header">
              <span>LLM 配置列表</span>
              <a-button type="primary" size="small" @click="addLlm">
                <PlusOutlined /> 添加 LLM
              </a-button>
            </div>

            <a-collapse accordion>
              <a-collapse-panel v-for="(llm, index) in formState.llms" :key="index" :header="llm.name || `LLM ${index + 1}`">
                <template #extra>
                  <a-button type="text" danger size="small" @click.stop="removeLlm(index)">
                    <DeleteOutlined />
                  </a-button>
                </template>

                <a-form layout="vertical">
                  <a-row :gutter="16">
                    <a-col :span="12">
                      <a-form-item label="名称" required>
                        <a-input v-model:value="llm.name" placeholder="LLM 名称" />
                      </a-form-item>
                    </a-col>
                    <a-col :span="12">
                      <a-form-item label="Provider" required>
                        <a-select v-model:value="llm.provider" :options="getProviderOptions('llm')" />
                      </a-form-item>
                    </a-col>
                  </a-row>

                  <!-- 动态配置字段 -->
                  <template v-for="field in getProviderFields('llm', llm.provider)" :key="field.key">
                    <a-form-item :label="field.label" :required="field.required" :tooltip="field.tip">
                      <a-input 
                        v-if="field.type === 'text'" 
                        v-model:value="llm.configuration[field.key]" 
                        :placeholder="field.placeholder || field.default" 
                      />
                      <a-input-password 
                        v-else-if="field.type === 'password'" 
                        v-model:value="llm.configuration[field.key]" 
                        :placeholder="field.placeholder" 
                      />
                      <a-input-number 
                        v-else-if="field.type === 'number'" 
                        v-model:value="llm.configuration[field.key]" 
                        :min="field.min" 
                        :max="field.max" 
                        :step="field.step || 1"
                        style="width: 100%" 
                      />
                      <a-switch 
                        v-else-if="field.type === 'switch'" 
                        v-model:checked="llm.configuration[field.key]" 
                      />
                      <a-select 
                        v-else-if="field.type === 'select'" 
                        v-model:value="llm.configuration[field.key]"
                        :options="field.options?.map(o => typeof o === 'string' ? { label: o, value: o } : o)"
                      />
                    </a-form-item>
                  </template>
                </a-form>
              </a-collapse-panel>
            </a-collapse>
          </div>
        </a-tab-pane>

        <!-- Agent 配置 -->
        <a-tab-pane key="agents" tab="Agent 配置">
          <div class="config-section">
            <div class="section-header">
              <span>Agent 配置列表</span>
              <a-button type="primary" size="small" @click="addAgent">
                <PlusOutlined /> 添加 Agent
              </a-button>
            </div>

            <a-collapse accordion>
              <a-collapse-panel v-for="(agent, index) in formState.agents" :key="index" :header="agent.name || `Agent ${index + 1}`">
                <template #extra>
                  <a-button type="text" danger size="small" @click.stop="removeAgent(index)">
                    <DeleteOutlined />
                  </a-button>
                </template>

                <a-form layout="vertical">
                  <a-row :gutter="16">
                    <a-col :span="8">
                      <a-form-item label="名称" required>
                        <a-input v-model:value="agent.name" placeholder="Agent 名称" />
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="Provider" required>
                        <a-select v-model:value="agent.provider" :options="getProviderOptions('agent')" />
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="描述">
                        <a-input v-model:value="agent.description" placeholder="Agent 描述" />
                      </a-form-item>
                    </a-col>
                  </a-row>

                  <a-form-item label="Semantic Models (逗号分隔)">
                    <a-input 
                      :value="agent.semantic_models?.join(', ')" 
                      @change="e => agent.semantic_models = e.target.value.split(',').map(s => s.trim()).filter(Boolean)"
                      placeholder="model1, model2" 
                    />
                  </a-form-item>

                  <!-- 动态配置字段 -->
                  <a-divider orientation="left">配置</a-divider>
                  <template v-for="field in getProviderFields('agent', agent.provider)" :key="field.key">
                    <a-form-item :label="field.label" :required="field.required" :tooltip="field.tip">
                      <a-select 
                        v-if="field.type === 'llm-select'" 
                        v-model:value="agent.configuration[field.key]"
                        :options="formState.llms.map(l => ({ label: l.name, value: l.name }))"
                        placeholder="选择 LLM"
                      />
                      <a-input-number 
                        v-else-if="field.type === 'number'" 
                        v-model:value="agent.configuration[field.key]" 
                        :min="field.min" 
                        :max="field.max" 
                        style="width: 100%" 
                      />
                      <a-switch 
                        v-else-if="field.type === 'switch'" 
                        v-model:checked="agent.configuration[field.key]" 
                      />
                      <a-select 
                        v-else-if="field.type === 'select'" 
                        v-model:value="agent.configuration[field.key]"
                        :options="field.options?.map(o => typeof o === 'string' ? { label: o, value: o } : o)"
                      />
                      <a-textarea 
                        v-else-if="field.type === 'textarea'" 
                        v-model:value="agent.configuration[field.key]"
                        :placeholder="field.placeholder"
                        :rows="3"
                      />
                    </a-form-item>
                  </template>
                  
                  <!-- Agentic 专用复杂配置组件 -->
                  <template v-if="agent.provider === 'agentic'">
                    <a-divider orientation="left">高级配置</a-divider>
                    
                    <EmailSenderConfig 
                      v-model="agent.configuration['email-sender']"
                    />
                    
                    <McpServersConfig 
                      v-model="agent.configuration['mcp-servers']"
                    />
                  </template>
                </a-form>
              </a-collapse-panel>
            </a-collapse>
          </div>
        </a-tab-pane>

        <!-- 嵌入配置 -->
        <a-tab-pane key="embedding" tab="嵌入配置">
          <a-form layout="vertical" style="max-width: 700px">
            <!-- Embedding Model -->
            <a-divider orientation="left">Embedding 模型</a-divider>
            <a-form-item label="Provider">
              <a-select v-model:value="formState.embedding.provider" :options="getProviderOptions('embedding')" />
            </a-form-item>

            <template v-for="field in getProviderFields('embedding', formState.embedding.provider)" :key="field.key">
              <a-form-item :label="field.label" :required="field.required" :tooltip="field.tip">
                <a-input 
                  v-if="field.type === 'text'" 
                  v-model:value="formState.embedding.configuration[field.key]" 
                  :placeholder="field.placeholder || field.default" 
                />
                <a-input-password 
                  v-else-if="field.type === 'password'" 
                  v-model:value="formState.embedding.configuration[field.key]" 
                />
                <a-input-number 
                  v-else-if="field.type === 'number'" 
                  v-model:value="formState.embedding.configuration[field.key]" 
                  style="width: 100%" 
                />
                <a-select 
                  v-else-if="field.type === 'select'" 
                  v-model:value="formState.embedding.configuration[field.key]"
                  :options="field.options?.map(o => typeof o === 'string' ? { label: o, value: o } : o)"
                />
                <a-switch 
                  v-else-if="field.type === 'switch'" 
                  v-model:checked="formState.embedding.configuration[field.key]" 
                />
              </a-form-item>
            </template>

            <!-- Embedding Store -->
            <a-divider orientation="left">Embedding Store</a-divider>
            <a-form-item label="Provider">
              <a-select v-model:value="formState.embedding_store.provider" :options="getProviderOptions('embedding_store')" />
            </a-form-item>

            <template v-for="field in getProviderFields('embedding_store', formState.embedding_store.provider)" :key="field.key">
              <a-form-item :label="field.label" :required="field.required" :tooltip="field.tip">
                <a-input 
                  v-if="field.type === 'text'" 
                  v-model:value="formState.embedding_store.configuration[field.key]" 
                  :placeholder="field.placeholder || String(field.default || '')" 
                />
                <a-input-password 
                  v-else-if="field.type === 'password'" 
                  v-model:value="formState.embedding_store.configuration[field.key]" 
                />
                <a-input-number 
                  v-else-if="field.type === 'number'" 
                  v-model:value="formState.embedding_store.configuration[field.key]" 
                  :placeholder="String(field.placeholder || field.default || '')"
                  style="width: 100%" 
                />
                <a-switch 
                  v-else-if="field.type === 'switch'" 
                  v-model:checked="formState.embedding_store.configuration[field.key]" 
                />
                <a-select 
                  v-else-if="field.type === 'select'" 
                  v-model:value="formState.embedding_store.configuration[field.key]"
                  :options="field.options?.map(o => typeof o === 'string' ? { label: o, value: o } : o)"
                />
              </a-form-item>
            </template>
          </a-form>
        </a-tab-pane>

        <!-- 内容存储 -->
        <a-tab-pane key="content" tab="内容存储">
          <a-form layout="vertical" style="max-width: 700px">
            <!-- Content Store -->
            <a-divider orientation="left">Content Store</a-divider>
            <a-form-item label="Provider">
              <a-select v-model:value="formState.content_store.provider" :options="getProviderOptions('content_store')" />
            </a-form-item>

            <template v-for="field in getProviderFields('content_store', formState.content_store.provider)" :key="field.key">
              <a-form-item :label="field.label" :required="field.required" :tooltip="field.tip">
                <a-select 
                  v-if="field.type === 'llm-select'" 
                  v-model:value="formState.content_store.configuration[field.key]"
                  :options="formState.llms.map(l => ({ label: l.name, value: l.name }))"
                  placeholder="选择 LLM"
                />
                <a-input-number 
                  v-else-if="field.type === 'number'" 
                  v-model:value="formState.content_store.configuration[field.key]" 
                  :min="field.min" 
                  :max="field.max" 
                  :step="field.step || 1"
                  style="width: 100%" 
                />
                <a-switch 
                  v-else-if="field.type === 'switch'" 
                  v-model:checked="formState.content_store.configuration[field.key]" 
                />
                <a-select 
                  v-else-if="field.type === 'select'" 
                  v-model:value="formState.content_store.configuration[field.key]"
                  :options="field.options?.map(o => typeof o === 'string' ? { label: o, value: o } : o)"
                />
              </a-form-item>
            </template>

            <!-- Reranking -->
            <a-divider orientation="left">Reranking (重排序模型)</a-divider>
            <a-form-item label="Provider">
              <a-select v-model:value="formState.reranking.provider" :options="getProviderOptions('reranking')" allowClear placeholder="选择重排序模型" />
            </a-form-item>

            <template v-for="field in getProviderFields('reranking', formState.reranking.provider)" :key="field.key">
              <a-form-item :label="field.label" :required="field.required" :tooltip="field.tip">
                <a-input 
                  v-if="field.type === 'text'" 
                  v-model:value="formState.reranking.configuration[field.key]" 
                  :placeholder="field.placeholder || field.default" 
                />
                <a-input-password 
                  v-else-if="field.type === 'password'" 
                  v-model:value="formState.reranking.configuration[field.key]" 
                />
                <a-input-number 
                  v-else-if="field.type === 'number'" 
                  v-model:value="formState.reranking.configuration[field.key]" 
                  :min="field.min" 
                  :max="field.max"
                  :step="field.step || 1"
                  style="width: 100%" 
                />
                <a-switch 
                  v-else-if="field.type === 'switch'" 
                  v-model:checked="formState.reranking.configuration[field.key]" 
                />
                <a-select 
                  v-else-if="field.type === 'select'" 
                  v-model:value="formState.reranking.configuration[field.key]"
                  :options="field.options?.map(o => typeof o === 'string' ? { label: o, value: o } : o)"
                />
              </a-form-item>
            </template>
          </a-form>
        </a-tab-pane>
      </a-tabs>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <a-space>
          <a-button type="primary" :loading="saving" @click="handleSubmit">
            {{ isEdit ? '保存修改' : '创建项目' }}
          </a-button>
          <a-button @click="handleCancel">取消</a-button>
        </a-space>
      </div>
    </a-spin>
  </div>
</template>

<style scoped>
.project-form {
  padding: 0;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
}

.config-section {
  padding: 16px 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  font-weight: 500;
}

.form-actions {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

:deep(.ant-collapse-header) {
  font-weight: 500;
}

:deep(.ant-divider-inner-text) {
  font-weight: 500;
  color: #1890ff;
}
</style>
