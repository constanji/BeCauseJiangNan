<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { 
  EditOutlined, 
  DatabaseOutlined,
  ArrowLeftOutlined,
  RobotOutlined,
  ApiOutlined,
  CloudServerOutlined,
  ThunderboltOutlined,
  ContainerOutlined
} from '@ant-design/icons-vue'
import { getProject } from '@/api/project'
import { getDatasources } from '@/api/datasource'

const router = useRouter()
const route = useRoute()

const loading = ref(false)
const project = ref(null)
const datasources = ref([])
const activeTab = ref('basic')

// Provider 标签映射
const providerLabels = {
  // LLM
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  ollama: 'Ollama',
  'azure-openai': 'Azure OpenAI',
  xinference: 'Xinference',
  // Embedding
  'bge-small-zh-v15-q': 'BGE Small ZH v15 Q (本地)',
  'bge-small-zh-v15': 'BGE Small ZH v15 (本地)',
  'bge-small-zh': 'BGE Small ZH (本地)',
  jina: 'Jina',
  onnx: 'ONNX (本地)',
  // Embedding Store
  duckdb: 'DuckDB (本地)',
  qdrant: 'Qdrant',
  elasticsearch: 'Elasticsearch',
  pgvector: 'PgVector',
  weaviate: 'Weaviate',
  milvus: 'Milvus',
  // Reranking
  'ms-marco-MiniLM-L6-v2-q': 'MS-MARCO MiniLM L6 v2 Q (本地)',
  'ms-marco-MiniLM-L6-v2': 'MS-MARCO MiniLM L6 v2 (本地)',
  // Agent
  default: 'Default (Workflow)',
  agentic: 'Agentic (Function Calling)',
}

const getProviderLabel = (provider) => {
  return providerLabels[provider] || provider
}

// 敏感字段需要隐藏
const sensitiveKeys = ['api-key', 'password', 'secret']
const isSensitive = (key) => sensitiveKeys.some(s => key.toLowerCase().includes(s))

// 配置字段中文映射
const configKeyLabels = {
  // 通用 LLM 配置
  'base-url': '接口地址',
  'api-key': 'API 密钥',
  'model-name': '模型名称',
  'timeout': '超时时间',
  'max-retries': '最大重试次数',
  'temperature': '温度',
  'max-tokens': '最大 Token 数',
  'max-output-tokens': '最大输出 Token',
  'max-completion-tokens': '最大完成 Token',
  'top-p': 'Top P',
  'top-k': 'Top K',
  'log-requests': '记录请求日志',
  'log-responses': '记录响应日志',
  'log-requests-and-responses': '记录请求响应日志',
  'response-format': '响应格式',
  'strict-json-schema': '严格 JSON Schema',
  'strict-tools': '严格工具模式',
  'return-thinking': '返回思考过程',
  'send-thinking': '发送思考',
  'seed': '随机种子',
  'only-support-stream-output': '仅支持流式输出',
  'http-version': 'HTTP 版本',
  'frequency-penalty': '频率惩罚',
  'presence-penalty': '存在惩罚',
  'allow-code-execution': '允许代码执行',
  'include-code-execution': '包含代码执行',
  'num-predict': '预测数量',
  'think': '启用思考',
  'version': 'API 版本',
  'beta': 'Beta 功能',
  'cache-system-messages': '缓存系统消息',
  'cache-tools': '缓存工具',
  'thinking-type': '思考类型',
  'thinking-budget-tokens': '思考预算 Token',
  
  // 数据库/存储
  'host': '主机地址',
  'port': '端口',
  'username': '用户名',
  'user': '用户名',
  'password': '密码',
  'database': '数据库',
  'database-name': '数据库名',
  'url': '连接地址',
  'dimension': '向量维度',
  'dimensions': '向量维度',
  'file-path': '文件路径',
  'max-segments-per-batch': '批量最大分段数',
  'late-chunking': '延迟分块',
  
  // Embedding Store
  'collection-name-prefix': '集合名前缀',
  'index-name-prefix': '索引名前缀',
  'table-prefix': '表名前缀',
  'class-name-prefix': '类名前缀',
  'use-tls': '启用 TLS',
  'use-index': '启用索引',
  'index-list-size': '索引列表大小',
  'scheme': '协议',
  'distance': '距离算法',
  'consistency-level': '一致性级别',
  'auto-flush-on-insert': '插入后自动刷新',
  'server-url': '服务器地址',
  
  // Azure
  'endpoint': '端点地址',
  'deployment-id': '部署 ID',
  'api-version': 'API 版本',
  
  // Content Store
  'max-results': '最大结果数',
  'min-score': '最低相似度',
  'default-llm': '默认 LLM',
  'rerank-mode': '启用重排序',
  'rerank-max-results': '重排序最大结果数',
  'rerank-min-score': '重排序最低分数',
  'use-llm-reranking': 'LLM 重排序',
  'reranking-llm': '重排序 LLM',
  'top-n': 'Top N',
  'return-documents': '返回文档内容',
  'return-len': '返回结果数量',
  // 语义模型索引配置
  'semantic-model.indexing-method': '语义模型索引方法',
  'semantic-model.indexing.hyqe-llm': 'HyQE LLM',
  'semantic-model.indexing.hyqe-question-num': 'HyQE 问题数量',
  'semantic-model.indexing.hyqe-instruction': 'HyQE 指令',
  'semantic-model.retrieval.max-results': '语义模型最大结果数',
  'semantic-model.retrieval.min-score': '语义模型最低分数',
  // 业务知识索引配置
  'business-knowledge.indexing-method': '业务知识索引方法',
  'business-knowledge.indexing.gce-max-chunk-size': 'GCE 最大块大小',
  'business-knowledge.indexing.gce-max-chunk-overlap': 'GCE 块重叠大小',
  'business-knowledge.indexing.gce-chunk-regex': 'GCE 分块正则',
  'business-knowledge.indexing.pcce-parent-mode': 'PCCE 父块模式',
  'business-knowledge.indexing.pcce-parent-max-chunk-size': 'PCCE 父块最大大小',
  'business-knowledge.indexing.pcce-parent-chunk-regex': 'PCCE 父块正则',
  'business-knowledge.indexing.pcce-child-max-chunk-size': 'PCCE 子块最大大小',
  'business-knowledge.indexing.pcce-child-chunk-regex': 'PCCE 子块正则',
  'business-knowledge.retrieval.max-results': '业务知识最大结果数',
  'business-knowledge.retrieval.min-score': '业务知识最低分数',
  
  // Agent
  'language': '回复语言',
  'intent-classification': '意图分类',
  'intent-classification-llm': '意图分类 LLM',
  'sql-generation-reasoning': 'SQL 生成推理',
  'sql-generation-reasoning-llm': 'SQL 推理 LLM',
  'sql-generation-llm': 'SQL 生成 LLM',
  'max-histories': '最大历史记录',
  'max-messages': '最大消息数',
  'max-tools-invocations': '最大工具调用次数',
  'data-preview': '数据预览',
  'data-preview-limit': '数据预览条数',
  'text-to-sql-rules': 'Text-to-SQL 规则',
  'instruction': '自定义指令',
  'index-ask': '指标问数',
  'index-ask-llm': '指标问数 LLM',
  'rule-based-sql': '规则生成 SQL',
  'human-in-the-loop': '人机交互',
  'human-in-the-loop.ask-user': 'HITL 询问用户',
  'human-in-the-loop.tool-approval': 'HITL 工具审批',
  'human-in-the-loop.tool-not-approval-and-feedback': 'HITL 拒绝反馈',
  
  // ONNX
  'model-file-path': '模型文件路径',
  'tokenizer-file-path': '分词器文件路径',
  'pooling-mode': '池化模式',
}

const getConfigKeyLabel = (key) => {
  return configKeyLabels[key] || key
}

// Email Sender 配置字段标签
const emailSenderLabels = {
  'smtp-host': 'SMTP 服务器',
  'from-address': '发件人地址',
  'smtp-port': 'SMTP 端口',
  'auth-enabled': '启用认证',
  'tls-enabled': '启用 TLS',
  'username': '用户名',
  'password': '密码',
  'from-name': '发件人名称',
  'smtp-connection-timeout': '连接超时',
  'smtp-timeout': '发送超时',
  'smtp-write-timeout': '写入超时'
}

const getEmailSenderLabel = (key) => {
  return emailSenderLabels[key] || key
}

const formatConfigValue = (key, value) => {
  if (value === null || value === undefined) return '-'
  if (isSensitive(key)) return '••••••••'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const loadProject = async () => {
  loading.value = true
  try {
    project.value = await getProject(route.params.id)
    // 同时加载数据源
    try {
      datasources.value = await getDatasources(route.params.id)
    } catch (e) {
      console.warn('Failed to load datasources:', e)
    }
  } catch (error) {
    message.error('加载项目失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const handleEdit = () => {
  router.push(`/projects/${route.params.id}/edit`)
}

const handleDatasources = () => {
  router.push(`/projects/${route.params.id}/datasources`)
}

const goBack = () => {
  router.push('/projects')
}

onMounted(() => {
  loadProject()
})
</script>

<template>
  <div class="project-detail">
    <div class="page-header">
      <a-button @click="goBack">
        <ArrowLeftOutlined /> 返回列表
      </a-button>
      <h2>{{ project?.name || '项目详情' }}</h2>
      <a-space>
        <a-button @click="handleDatasources">
          <DatabaseOutlined /> 管理数据源
        </a-button>
        <a-button type="primary" @click="handleEdit">
          <EditOutlined /> 编辑
        </a-button>
      </a-space>
    </div>

    <a-spin :spinning="loading">
      <a-tabs v-if="project" v-model:activeKey="activeTab">
        <!-- 基本信息 -->
        <a-tab-pane key="basic" tab="基本信息">
          <a-card>
            <a-descriptions :column="2" bordered>
              <a-descriptions-item label="项目名称">
                {{ project.name }}
              </a-descriptions-item>
              <a-descriptions-item label="版本">
                v{{ project.version }}
              </a-descriptions-item>
              <a-descriptions-item label="描述" :span="2">
                {{ project.description || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="创建时间">
                {{ project.createdAt }}
              </a-descriptions-item>
              <a-descriptions-item label="更新时间">
                {{ project.updatedAt }}
              </a-descriptions-item>
            </a-descriptions>

            <!-- 数据源列表 -->
            <a-divider>
              <DatabaseOutlined /> 数据源 ({{ datasources.length }})
            </a-divider>
            <a-empty v-if="datasources.length === 0" description="暂无数据源" />
            <a-list v-else :data-source="datasources" size="small">
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>{{ item.name }}</template>
                    <template #description>
                      <a-tag color="blue">{{ getProviderLabel(item.provider) }}</a-tag>
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-tag :color="item.enabled ? 'green' : 'red'">
                      {{ item.enabled ? '启用' : '禁用' }}
                    </a-tag>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-tab-pane>

        <!-- LLM 配置 -->
        <a-tab-pane key="llms">
          <template #tab>
            <ApiOutlined /> 大模型 ({{ project.llms?.length || 0 }})
          </template>
          <a-card>
            <a-empty v-if="!project.llms?.length" description="暂无 LLM 配置" />
            <a-collapse v-else>
              <a-collapse-panel v-for="(llm, index) in project.llms" :key="index">
                <template #header>
                  <span style="font-weight: 500">{{ llm.name }}</span>
                  <a-tag color="blue" style="margin-left: 8px">{{ getProviderLabel(llm.provider) }}</a-tag>
                </template>
                <a-descriptions :column="2" bordered size="small">
                  <a-descriptions-item label="名称">{{ llm.name }}</a-descriptions-item>
                  <a-descriptions-item label="Provider">{{ getProviderLabel(llm.provider) }}</a-descriptions-item>
                  <template v-if="llm.configuration">
                    <a-descriptions-item 
                      v-for="(value, key) in llm.configuration" 
                      :key="key" 
                      :label="getConfigKeyLabel(key)"
                    >
                      {{ formatConfigValue(key, value) }}
                    </a-descriptions-item>
                  </template>
                </a-descriptions>
              </a-collapse-panel>
            </a-collapse>
          </a-card>
        </a-tab-pane>

        <!-- Agent 配置 -->
        <a-tab-pane key="agents">
          <template #tab>
            <RobotOutlined /> Agent ({{ project.agents?.length || 0 }})
          </template>
          <a-card>
            <a-empty v-if="!project.agents?.length" description="暂无 Agent 配置" />
            <a-collapse v-else>
              <a-collapse-panel v-for="(agent, index) in project.agents" :key="index">
                <template #header>
                  <span style="font-weight: 500">{{ agent.name }}</span>
                  <a-tag color="purple" style="margin-left: 8px">{{ getProviderLabel(agent.provider) }}</a-tag>
                </template>
                <a-descriptions :column="2" bordered size="small">
                  <a-descriptions-item label="名称">{{ agent.name }}</a-descriptions-item>
                  <a-descriptions-item label="Provider">{{ getProviderLabel(agent.provider) }}</a-descriptions-item>
                  <a-descriptions-item label="描述" :span="2">{{ agent.description || '-' }}</a-descriptions-item>
                  <a-descriptions-item label="Semantic Models" :span="2">
                    <template v-if="agent.semantic_models?.length">
                      <a-tag v-for="m in agent.semantic_models" :key="m">{{ m }}</a-tag>
                    </template>
                    <span v-else>-</span>
                  </a-descriptions-item>
                  <template v-if="agent.configuration">
                    <template v-for="(value, key) in agent.configuration" :key="key">
                      <!-- 跳过复杂配置，单独展示 -->
                      <a-descriptions-item 
                        v-if="!['email-sender', 'mcp-servers'].includes(key)"
                        :label="getConfigKeyLabel(key)"
                      >
                        {{ formatConfigValue(key, value) }}
                      </a-descriptions-item>
                    </template>
                  </template>
                </a-descriptions>
                
                <!-- Email Sender 配置展示 -->
                <template v-if="agent.configuration?.['email-sender']">
                  <a-divider orientation="left" style="margin-top: 16px">邮件发送器</a-divider>
                  <a-descriptions :column="2" bordered size="small">
                    <a-descriptions-item 
                      v-for="(value, key) in agent.configuration['email-sender']" 
                      :key="key"
                      :label="getEmailSenderLabel(key)"
                    >
                      {{ formatConfigValue(key, value) }}
                    </a-descriptions-item>
                  </a-descriptions>
                </template>
                
                <!-- MCP Servers 配置展示 -->
                <template v-if="agent.configuration?.['mcp-servers'] && Object.keys(agent.configuration['mcp-servers']).length > 0">
                  <a-divider orientation="left" style="margin-top: 16px">MCP 服务器</a-divider>
                  <div v-for="(config, serverName) in agent.configuration['mcp-servers']" :key="serverName" style="margin-bottom: 12px">
                    <a-descriptions :column="2" bordered size="small" :title="serverName">
                      <a-descriptions-item label="传输方式">
                        <a-tag :color="config.transport === 'http' ? 'blue' : 'green'">
                          {{ config.transport?.toUpperCase() }}
                        </a-tag>
                      </a-descriptions-item>
                      <a-descriptions-item v-if="config.url" label="URL">{{ config.url }}</a-descriptions-item>
                      <a-descriptions-item v-if="config['sse-url']" label="SSE URL">{{ config['sse-url'] }}</a-descriptions-item>
                      <a-descriptions-item v-if="config.command" label="命令">
                        {{ Array.isArray(config.command) ? config.command.join(' ') : config.command }}
                      </a-descriptions-item>
                      <a-descriptions-item v-if="config.timeout" label="超时">{{ config.timeout }}ms</a-descriptions-item>
                    </a-descriptions>
                  </div>
                </template>
              </a-collapse-panel>
            </a-collapse>
          </a-card>
        </a-tab-pane>

        <!-- 嵌入配置 -->
        <a-tab-pane key="embedding">
          <template #tab>
            <ThunderboltOutlined /> 嵌入配置
          </template>
          <a-card>
            <!-- Embedding Model -->
            <a-divider orientation="left">Embedding 模型</a-divider>
            <a-descriptions :column="2" bordered size="small">
              <a-descriptions-item label="Provider" :span="2">
                <a-tag color="cyan">{{ getProviderLabel(project.embedding?.provider) }}</a-tag>
              </a-descriptions-item>
              <template v-if="project.embedding?.configuration">
                <a-descriptions-item 
                  v-for="(value, key) in project.embedding.configuration" 
                  :key="key" 
                  :label="getConfigKeyLabel(key)"
                >
                  {{ formatConfigValue(key, value) }}
                </a-descriptions-item>
              </template>
            </a-descriptions>

            <!-- Embedding Store -->
            <a-divider orientation="left">Embedding Store</a-divider>
            <a-descriptions :column="2" bordered size="small">
              <a-descriptions-item label="Provider" :span="2">
                <a-tag color="orange">{{ getProviderLabel(project.embedding_store?.provider) }}</a-tag>
              </a-descriptions-item>
              <template v-if="project.embedding_store?.configuration">
                <a-descriptions-item 
                  v-for="(value, key) in project.embedding_store.configuration" 
                  :key="key" 
                  :label="getConfigKeyLabel(key)"
                >
                  {{ formatConfigValue(key, value) }}
                </a-descriptions-item>
              </template>
            </a-descriptions>
          </a-card>
        </a-tab-pane>

        <!-- 内容存储 -->
        <a-tab-pane key="content">
          <template #tab>
            <ContainerOutlined /> 内容存储
          </template>
          <a-card>
            <!-- Content Store -->
            <a-divider orientation="left">Content Store</a-divider>
            <a-descriptions :column="2" bordered size="small">
              <a-descriptions-item label="Provider" :span="2">
                <a-tag color="green">{{ getProviderLabel(project.content_store?.provider) }}</a-tag>
              </a-descriptions-item>
              <template v-if="project.content_store?.configuration">
                <a-descriptions-item 
                  v-for="(value, key) in project.content_store.configuration" 
                  :key="key" 
                  :label="getConfigKeyLabel(key)"
                >
                  {{ formatConfigValue(key, value) }}
                </a-descriptions-item>
              </template>
            </a-descriptions>

            <!-- Reranking -->
            <a-divider orientation="left">Reranking (重排序模型)</a-divider>
            <a-descriptions :column="2" bordered size="small">
              <a-descriptions-item label="Provider" :span="2">
                <a-tag color="magenta">{{ getProviderLabel(project.reranking?.provider) || '-' }}</a-tag>
              </a-descriptions-item>
              <template v-if="project.reranking?.configuration">
                <a-descriptions-item 
                  v-for="(value, key) in project.reranking.configuration" 
                  :key="key" 
                  :label="getConfigKeyLabel(key)"
                >
                  {{ formatConfigValue(key, value) }}
                </a-descriptions-item>
              </template>
            </a-descriptions>
          </a-card>
        </a-tab-pane>
      </a-tabs>
    </a-spin>
  </div>
</template>

<style scoped>
.project-detail {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
}

:deep(.ant-collapse-header) {
  font-weight: 500;
}

:deep(.ant-divider-inner-text) {
  font-weight: 500;
  color: #1890ff;
}

:deep(.ant-descriptions-item-label) {
  width: 180px;
  font-weight: 500;
}
</style>
