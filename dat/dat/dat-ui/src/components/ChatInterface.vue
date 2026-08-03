<template>
  <XProvider>
    <div :style="styles.layout">
      <!-- 左侧菜单区域 -->
      <div :style="styles.menu">
        <!-- Logo -->
        <div :style="styles.logo">
          <img
            src="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp"
            draggable="false"
            alt="logo"
            :style="styles.logoImg"
          />
          <span :style="styles.logoSpan">因为智能</span>
        </div>

        <!-- 新建对话按钮 -->
        <Button
          type="link"
          :style="styles.addBtn"
          @click="handleNewConversation"
        >
          <PlusOutlined />
          新建对话
        </Button>

        <!-- 会话列表 -->
        <Conversations
          :items="conversationItems"
          :style="styles.conversations"
          :active-key="currentConversationId"
          :menu="conversationMenu"
          @active-change="handleConversationChange"
        />
      </div>

      <!-- 中间聊天区域 -->
      <div :style="styles.chat">
        <!-- 消息列表 -->
        <Bubble.List
          ref="messagesContainerRef"
          :items="bubbleItems"
          :roles="bubbleRoles"
          :style="styles.messages"
        />

        <!-- 提示词（无消息时显示） -->
        <Prompts
          v-if="messages.length === 0 && !loading"
          :items="promptItems"
          @item-click="handlePromptClick"
        />

        <!-- 输入框 -->
        <Sender
          ref="senderRef"
          :value="inputValue"
          :style="styles.sender"
          :loading="loading"
          placeholder="输入您的问题，按 Enter 发送"
          @submit="handleSubmit"
          @change="(val) => inputValue = val"
        />
      </div>

      <!-- 右侧思考链区域 -->
      <div :style="styles.thoughtChain">
        <div :style="styles.thoughtChainHeader">
          <span :style="styles.thoughtChainTitle">执行过程</span>
        </div>
        <div :style="styles.thoughtChainContent">
          <ThoughtChain
            v-if="thoughtChainItems.length > 0"
            :items="thoughtChainItems"
          />
          <div v-else :style="styles.emptyThoughtChain">
            执行过程将显示在这里
          </div>
        </div>
      </div>
    </div>

    <!-- HITL Modals -->
    <Modal
      v-model:open="hitlAiRequestModal.visible"
      title="AI 需要您的输入"
      :ok-text="'提交'"
      :cancel-text="'取消'"
      @ok="handleSubmitAiRequest"
    >
      <p style="margin-bottom: 16px">{{ hitlAiRequestModal.message }}</p>
      <Input
        v-model:value="hitlAiRequestModal.userInput"
        placeholder="请输入您的回复"
        @press-enter="handleSubmitAiRequest"
      />
    </Modal>

    <Modal
      v-model:open="hitlToolApprovalModal.visible"
      title="工具执行确认"
      :ok-text="'批准'"
      :cancel-text="'拒绝'"
      @ok="handleToolApproval(true)"
      @cancel="handleToolApproval(false)"
    >
      <p style="margin-bottom: 16px">{{ hitlToolApprovalModal.message }}</p>
      <Descriptions :column="1" bordered>
        <Descriptions.Item label="工具名称">
          {{ hitlToolApprovalModal.toolName }}
        </Descriptions.Item>
        <Descriptions.Item label="工具参数">
          <pre class="tool-arguments">{{ hitlToolApprovalModal.toolArguments }}</pre>
        </Descriptions.Item>
      </Descriptions>
    </Modal>

    <!-- Project and Datasource Selection Modal -->
    <Modal
      v-model:open="selectContextModal.visible"
      title="选择项目和数据源"
      :ok-text="'确认'"
      :cancel-text="'取消'"
      :ok-button-props="{ disabled: !selectContextModal.selectedProjectId || !selectContextModal.selectedDatasourceId }"
      @ok="handleConfirmContext"
      @cancel="handleCancelContext"
    >
      <div style="margin-bottom: 16px">
        <label style="display: block; margin-bottom: 8px; font-weight: 500">选择项目</label>
        <Select
          v-model:value="selectContextModal.selectedProjectId"
          placeholder="请选择项目"
          style="width: 100%"
          :options="projectOptions"
          @change="handleProjectChange"
        />
      </div>
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 500">选择数据源</label>
        <Select
          v-model:value="selectContextModal.selectedDatasourceId"
          placeholder="请先选择项目"
          style="width: 100%"
          :options="datasourceOptions"
          :disabled="!selectContextModal.selectedProjectId"
        />
      </div>
      <div style="margin-top: 16px">
        <label style="display: block; margin-bottom: 8px; font-weight: 500">
          组织编码 (org_code)
          <span style="color: #999; font-weight: normal; margin-left: 4px;">（指标问数项目必填）</span>
        </label>
        <Input
          v-model:value="selectContextModal.selectedOrgCode"
          placeholder="如：H0001（总行）、B0001（北京分行）"
        />
      </div>
    </Modal>

    <!-- 来源抽屉 -->
    <Drawer
      title="参考表"
      placement="right"
      :closable="true"
      :open="sourceDrawerVisible"
      @close="sourceDrawerVisible = false"
    >
      <div v-if="drawerSourceTables && drawerSourceTables.length > 0">
        <div v-for="(table, index) in drawerSourceTables" :key="index" style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #f0f0f0;">
          <h4 style="margin: 0 0 8px 0; font-weight: 600; color: #1677ff;">
            <DatabaseOutlined style="margin-right: 8px;" />
            {{ table }}
          </h4>
        </div>
      </div>
      <div v-else style="text-align: center; color: #999; margin-top: 50px;">
        暂无参考表
      </div>
    </Drawer>
  </XProvider>
</template>

<script setup>
import { ref, computed, nextTick, h, onMounted, onUnmounted } from 'vue'
import {
  CheckCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  ToolOutlined,
  DatabaseOutlined,
  CodeOutlined,
  FireOutlined,
  ReadOutlined,
  BulbOutlined,
  DeleteOutlined,
  PlusOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue'
import agentSvg from '../assets/agent.svg'
import userSvg from '../assets/user.svg'
import {
  Button,
  Descriptions,
  Input,
  Modal,
  message,
  Space,
  Table,
  Select,
  theme,
  Drawer,
  Tag,
  Alert,
} from 'ant-design-vue'
import {
  Bubble,
  Conversations,
  Prompts,
  Sender,
  ThoughtChain,
  Welcome,
  XProvider,
} from 'ant-design-x-vue'
import { askStream, sendUserResponse, sendUserApproval, getAgents } from '../api/chat'
import { getProjects } from '../api/project'
import { getDatasources } from '../api/datasource'
import { renderMarkdown, hasMarkdown } from '../utils/markdown'
import {
  getConversations,
  saveConversations,
  getMessages,
  saveMessages,
  getThoughtChain,
  saveThoughtChain,
  deleteConversation,
  generateConversationId,
  addConversation,
  getConversation,
  getConversationTitle,
} from '../utils/storage'

defineOptions({ name: 'ChatInterface' })

// Props for project and datasource selection
const props = defineProps({
  projectId: {
    type: String,
    default: null,
  },
  datasourceId: {
    type: String,
    default: null,
  },
  userId: {
    type: String,
    default: null,
  },
})

// Theme token
const { token } = theme.useToken()

// Computed styles - 独立式布局
const styles = computed(() => ({
  layout: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    background: token.value.colorBgContainer,
    fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`,
  },
  menu: {
    background: `${token.value.colorBgLayout}`,
    width: '280px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${token.value.colorBorderSecondary}`,
  },
  logo: {
    display: 'flex',
    height: '72px',
    alignItems: 'center',
    justifyContent: 'start',
    padding: '0 24px',
    boxSizing: 'border-box',
    gap: '12px',
  },
  logoImg: {
    width: '32px',
    height: '32px',
    display: 'inline-block',
  },
  logoSpan: {
    display: 'inline-block',
    fontWeight: 'bold',
    color: token.value.colorText,
    fontSize: '18px',
  },
  addBtn: {
    background: '#1677ff0f',
    border: '1px solid #1677ff34',
    width: 'calc(100% - 24px)',
    margin: '0 12px 16px 12px',
  },
  conversations: {
    padding: '0 12px',
    flex: 1,
    overflowY: 'auto',
  },
  chat: {
    height: '100%',
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    padding: `${token.value.paddingLG}px`,
    gap: '16px',
    background: token.value.colorBgContainer,
  },
  messages: {
    flex: 1,
    minWidth: 0,
    overflow: 'auto',
  },
  sender: {
    boxShadow: token.value.boxShadow,
  },
  thoughtChain: {
    width: '320px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: token.value.colorBgLayout,
    borderLeft: `1px solid ${token.value.colorBorderSecondary}`,
  },
  thoughtChainHeader: {
    padding: '20px 16px',
    borderBottom: `1px solid ${token.value.colorBorderSecondary}`,
  },
  thoughtChainTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: token.value.colorText,
  },
  thoughtChainContent: {
    flex: 1,
    overflow: 'auto',
    padding: '16px',
  },
  emptyThoughtChain: {
    color: token.value.colorTextSecondary,
    textAlign: 'center',
    marginTop: '40px',
  },
}))

// Refs
const senderRef = ref(null)
const messagesContainerRef = ref(null)
const inputValue = ref('')
const loading = ref(false)
const currentConversationId = ref(null)
const abortController = ref(null)

// Messages
const messages = ref([])
const thoughtChainItems = ref([])

// HITL states
const hitlAiRequestModal = ref({
  visible: false,
  message: '',
  conversationId: null,
  userInput: '',
})

const hitlToolApprovalModal = ref({
  visible: false,
  message: '',
  conversationId: null,
  toolId: null,
  toolName: '',
  toolArguments: '',
})

// Project and Datasource Selection
const selectContextModal = ref({
  visible: false,
  selectedProjectId: null,
  selectedDatasourceId: null,
  selectedOrgCode: '',
  pendingAction: null, // 'new' or 'submit' with content
})
const projects = ref([])
const datasources = ref([])
const currentProjectId = ref(null)
const currentDatasourceId = ref(null)
const currentOrgCode = ref(null)

// Computed options for selects
const projectOptions = computed(() =>
  projects.value.map(p => ({ label: p.name, value: p.id }))
)
const datasourceOptions = computed(() =>
  datasources.value.map(d => ({ label: d.name, value: d.id }))
)

// Current answer being streamed
const currentAnswer = ref('')
const currentAnswerId = ref(null)

// Track processed errors to avoid duplicates
const processedErrors = ref(new Set())

// Sources and Drawer state
const sourceDrawerVisible = ref(false)
const drawerSourceTables = ref([])
const pendingSourceTables = ref([])

const openSourceDrawer = (tables) => {
  drawerSourceTables.value = tables
  sourceDrawerVisible.value = true
}

// Markdown content renderer component
const MarkdownContent = (props) => {
  const { content } = props
  if (!content) return null

  // Check if content contains markdown
  if (hasMarkdown(content)) {
    const html = renderMarkdown(content)
    return h('div', {
      class: 'markdown-content',
      innerHTML: html,
    })
  }

  // Plain text with line breaks
  return h('div', {
    class: 'plain-text-content',
    style: { whiteSpace: 'pre-wrap' },
  }, content)
}

// Bubble roles configuration
const bubbleRoles = {
  user: {
    placement: 'end',
    variant: 'shadow',
    avatar: {
      src: userSvg,
      shape: 'circle',
      size: 'default',
      style: { background: '#fff' },
    },
  },
  ai: {
    placement: 'start',
    typing: { step: 5, interval: 20 },
    avatar: {
      src: agentSvg,
      shape: 'circle',
      size: 'default',
      style: { background: '#fff' },
    },
    styles: {
      content: {
        borderRadius: '16px',
        maxWidth: '100%',
        overflowX: 'auto',
        minWidth: 0,
      },
    },
    messageRender: (content) => {
      if (typeof content === 'string') {
        return h(MarkdownContent, { content })
      }
      return content
    },
  },
}

// Conversation menu for delete action
const conversationMenu = (conversation) => ({
  items: [
    {
      key: 'delete',
      label: '删除对话',
      icon: h(DeleteOutlined),
      danger: true,
    },
  ],
  onClick: ({ key }) => {
    if (key === 'delete') {
      handleDeleteConversation(conversation.key)
    }
  },
})

// Placeholder node for welcome
const placeholderNode = computed(() =>
  h(Space, { direction: 'vertical', size: 16, style: { paddingTop: '32px', textAlign: 'left', flex: 1 } }, () => [
    h(Welcome, {
      variant: 'borderless',
      icon: 'https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp',
      title: '你好，我是 BeCause AI 助手',
      description: '我可以帮你通过自然语言查询和分析数据。请告诉我你想了解什么？',
    }),
  ])
)

// Bubble items for Bubble.List
const bubbleItems = computed(() => {
  if (messages.value.length === 0) {
    return [{ content: placeholderNode.value, variant: 'borderless' }]
  }
  return messages.value.map((msg) => {
    let content = reconstructContent(msg.content);

    // Add source tag if sourceTables exist
    if (msg.role === 'ai' && !msg.loading && msg.sourceTables && msg.sourceTables.length > 0) {
      const sourceTag = h('div', {
        style: { marginTop: '12px', display: 'flex', alignItems: 'center', gap: '4px' }
      }, [
        h(Tag, {
          color: 'default',
          style: { cursor: 'pointer', borderRadius: '12px', padding: '4px 12px', background: '#f5f5f5', border: '1px solid #e8e8e8' },
          onClick: () => openSourceDrawer(msg.sourceTables)
        }, () => [
          h(FileTextOutlined, { style: { marginRight: '6px' } }),
          `参考 ${msg.sourceTables.length} 个表`
        ])
      ]);

      content = h('div', { style: { display: 'flex', flexDirection: 'column' } }, [
        content,
        sourceTag
      ]);
    }

    return {
      key: msg.key,
      loading: msg.loading,
      role: msg.role === 'user' ? 'user' : 'ai',
      content: content,
    };
  })
})

// Helper to reconstruct VNodes from saved strings (tables/markdown)
const reconstructContent = (content) => {
  if (content && typeof content !== 'string') {
    // Already a VNode/Component
    return content
  }

  if (typeof content === 'string' && content.trim().startsWith('[')) {
    try {
      const parsedData = JSON.parse(content)
      if (Array.isArray(parsedData) && parsedData.length > 0 && typeof parsedData[0] === 'object') {
        return buildResultTable(parsedData)
      }
    } catch (e) {
      // Not JSON or parse failed
    }
  }

  // Fallback to markdown or plain text
  return typeof content === 'string' ? h(MarkdownContent, { content }) : content
}

// 统一的查询结果表格构造:
// - 每列固定宽度 120px,首列(常是主键/名称)给 140px
// - scroll.x 显式 = 列数 * 列宽 → 启用横向滚动,不撑爆气泡父容器
// - 外层 div 强制 max-width:100% + overflow-x:auto,双保险
const buildResultTable = (rows) => {
  const COL_WIDTH = 120
  const FIRST_COL_WIDTH = 140
  const keys = Object.keys(rows[0])
  const columns = keys.map((key, idx) => ({
    title: key,
    dataIndex: key,
    key: key,
    width: idx === 0 ? FIRST_COL_WIDTH : COL_WIDTH,
    ellipsis: true,
  }))
  const totalWidth = FIRST_COL_WIDTH + (keys.length - 1) * COL_WIDTH
  return h('div', {
    style: { maxWidth: '100%', overflowX: 'auto', width: '100%' },
  }, [
    h(Table, {
      columns,
      dataSource: rows,
      pagination: {
        pageSize: 5,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 条记录`,
      },
      scroll: { x: totalWidth, y: 400 },
      size: 'small',
      bordered: true,
      tableLayout: 'fixed',
    }),
  ])
}

// Force update trigger for conversation list
const conversationListUpdateTrigger = ref(0)

// Conversation items - load from localStorage and sort by timestamp
const conversationItems = computed(() => {
  // Use trigger to force recomputation when localStorage changes
  conversationListUpdateTrigger.value // This makes the computed reactive to changes

  const conversations = getConversations()
  // Create a new array and sort by timestamp (newest first)
  return [...conversations].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
})

// Force refresh conversation list
const refreshConversationList = () => {
  conversationListUpdateTrigger.value++
}

// Prompt items
const promptItems = computed(() => [
  {
    key: '1',
    label: renderTitle(h(FireOutlined, { style: { color: '#FF4D4F' } }), '热门查询'),
    description: '常用的数据查询示例',
    children: [
      { key: '1-1', description: '各国的covid病例总数' },
      { key: '1-2', description: '统计covid病例总数最高的国家' },
    ],
  },
  {
    key: '2',
    label: renderTitle(h(ReadOutlined, { style: { color: '#1890FF' } }), '数据分析'),
    description: '数据分析相关查询',
    children: [
      { key: '2-1', icon: h(DatabaseOutlined), description: '查看所有可用数据模型' },
      { key: '2-2', icon: h(CodeOutlined), description: '执行自定义SQL查询' },
    ],
  },
])

// Helper function to render title with icon
function renderTitle(icon, title) {
  return h(Space, { align: 'start' }, () => [icon, h('span', title)])
}

// Load projects on mount
const loadProjects = async () => {
  try {
    const data = await getProjects()
    projects.value = data || []
  } catch (error) {
    console.error('Failed to load projects:', error)
    message.error('加载项目列表失败')
  }
}

// Handle project change in modal
const handleProjectChange = async (projectId) => {
  selectContextModal.value.selectedDatasourceId = null
  datasources.value = []
  if (projectId) {
    try {
      const data = await getDatasources(projectId)
      datasources.value = data || []
    } catch (error) {
      console.error('Failed to load datasources:', error)
      message.error('加载数据源列表失败')
    }
  }
}

// Handle confirm context selection
const handleConfirmContext = () => {
  currentProjectId.value = selectContextModal.value.selectedProjectId
  currentDatasourceId.value = selectContextModal.value.selectedDatasourceId
  // 指标问数项目用,空串归一为 null
  currentOrgCode.value = selectContextModal.value.selectedOrgCode?.trim() || null
  selectContextModal.value.visible = false

  // Execute pending action
  if (selectContextModal.value.pendingAction === 'new') {
    // New conversation - just close modal, user will type
    message.success('已选择项目和数据源，可以开始对话')
  } else if (selectContextModal.value.pendingAction) {
    // Pending submit - execute it
    doSubmit(selectContextModal.value.pendingAction)
  }
  selectContextModal.value.pendingAction = null
}

// Handle cancel context selection
const handleCancelContext = () => {
  selectContextModal.value.visible = false
  selectContextModal.value.pendingAction = null
}

// Handle new conversation button
const handleNewConversation = async () => {
  // Reset current conversation
  currentConversationId.value = null
  messages.value = []
  thoughtChainItems.value = []
  currentProjectId.value = null
  currentDatasourceId.value = null
  currentOrgCode.value = null

  // Load projects and show selection modal
  await loadProjects()
  selectContextModal.value.selectedProjectId = null
  selectContextModal.value.selectedDatasourceId = null
  selectContextModal.value.selectedOrgCode = ''
  selectContextModal.value.pendingAction = 'new'
  selectContextModal.value.visible = true
}

// Handle message submit
const handleSubmit = async (content) => {
  if (!content.trim() || loading.value) return

  // If no project/datasource selected for new conversation, show modal
  if (!currentConversationId.value && (!currentProjectId.value || !currentDatasourceId.value)) {
    await loadProjects()
    selectContextModal.value.selectedProjectId = currentProjectId.value
    selectContextModal.value.selectedDatasourceId = currentDatasourceId.value
    selectContextModal.value.selectedOrgCode = currentOrgCode.value || ''
    selectContextModal.value.pendingAction = content.trim()
    selectContextModal.value.visible = true
    return
  }

  doSubmit(content.trim())
}

// Actual submit logic
const doSubmit = async (content) => {
  // Generate new conversation ID if starting a new conversation
  if (!currentConversationId.value) {
    currentConversationId.value = generateConversationId()
    // Add to conversation list with project/datasource IDs + orgCode
    addConversation(
      currentConversationId.value,
      content.substring(0, 30),
      null,
      currentProjectId.value,
      currentDatasourceId.value,
      currentOrgCode.value
    )
    // Force refresh conversation list
    refreshConversationList()
  }

  // Clear processed errors for new conversation
  processedErrors.value.clear()

  const userMessage = {
    key: `user-${Date.now()}`,
    role: 'user',
    content: content.trim(),
    timestamp: Date.now(),
  }

  messages.value.push(userMessage)
  // Save messages to localStorage
  saveMessages(currentConversationId.value, messages.value)

  inputValue.value = ''

  // Add loading message
  const loadingMessageKey = `ai-loading-${Date.now()}`
  const loadingMessage = {
    key: loadingMessageKey,
    role: 'ai',
    content: '',
    loading: true,
    timestamp: Date.now(),
  }
  messages.value.push(loadingMessage)

  // Clear current thought chain for new submission
  thoughtChainItems.value = []
  pendingSourceTables.value = []

  loading.value = true
  currentAnswer.value = ''
  currentAnswerId.value = null

  // Scroll to bottom
  await nextTick()
  scrollToBottom()

  // Start streaming request
  abortController.value = askStream(
    {
      question: content.trim(),
      project_id: currentProjectId.value,
      datasource_id: currentDatasourceId.value,
      user_id: props.userId,
      conversation_id: currentConversationId.value,
      // 指标问数项目必填;非指标问数项目后端忽略
      org_code: currentOrgCode.value || undefined,
    },
    {
      onMessage: handleSSEMessage,
      onError: handleError,
      onFinish: handleFinish,
    }
  )
}

// Handle SSE messages
const handleSSEMessage = (eventType, data) => {
  console.log('SSE Event:', eventType, data)

  // Update conversation ID if present (from backend)
  if (data?.conversation_id) {
    // If we don't have a conversation ID yet, use the one from backend
    // Otherwise, keep our generated one
    if (!currentConversationId.value) {
      currentConversationId.value = data.conversation_id
      updateConversationList()
    }
  }

  switch (eventType) {
    case 'ping':
      // Heartbeat, ignore
      break

    case 'agent_answer':
      handleAgentAnswer(data)
      break

    case 'agent_answer_end':
      handleAgentAnswerEnd(data)
      break

    case 'source':
      handleSourceEvent(data)
      break

    case 'intent_classification':
      addThoughtChainItem({
        title: '意图分类与选表',
        description: `意图: ${data.intent || '未知'}`,
        status: 'success',
        icon: h(ReadOutlined),
        content: `**分析思考**: ${data.reasoning || '无'}\n\n**重写问法**: ${data.rephrased_question || '保持原样'}`,
      })
      break

    case 'misleading_assistance':
      handleIncrementalContent('引导性建议', data)
      break

    case 'data_assistance':
      handleIncrementalContent('数据分析建议', data)
      break

    case 'sql_generation_reasoning':
      handleIncrementalContent('SQL 生成思考', data)
      break

    case 'sql_generate':
      addThoughtChainItem({
        title: '生成 SQL',
        description: '正在将自然语言转换为 SQL 语句',
        status: 'success',
        icon: h(CodeOutlined),
        content: data.semantic_sql,
        originalContent: data.semantic_sql,
      })
      break

    case 'sql_execute':
      // Create table component for query_data
      const queryData = data.query_data || []
      const tableContent = queryData.length > 0
        ? buildResultTable(queryData)
        : h('div', { style: { padding: '16px', color: '#999' } }, '暂无数据')

      // Add to thought chain as history
      addThoughtChainItem({
        title: '执行 SQL',
        description: `查询结果：${queryData.length} 条记录`,
        status: 'success',
        icon: h(CheckCircleOutlined),
        content: tableContent,
        originalContent: JSON.stringify(queryData, null, 2),
      })

      // ALSO update the main chat bubble with the RAW DATA (stringified)
      // This ensures it persists to localStorage correctly
      const rawDataString = JSON.stringify(queryData)
      const loadingIndex = messages.value.findIndex(m => m.loading || m.key === `ai-${currentAnswerId.value}`)
      if (loadingIndex >= 0) {
        messages.value[loadingIndex] = {
          ...messages.value[loadingIndex],
          content: rawDataString,
          loading: false,
          timestamp: Date.now(),
        }
      } else {
        // Fallback: push new bubble
        messages.value.push({
          key: `table-result-${Date.now()}`,
          role: 'ai',
          content: rawDataString,
          loading: false,
          timestamp: Date.now(),
        })
      }
      break

    case 'before_tool_execution':
      addThoughtChainItem({
        title: `准备执行工具: ${data.tool_name}`,
        description: '等待用户批准',
        status: 'pending',
        icon: h(ToolOutlined),
        content: `参数: ${data.tool_arguments}`,
      })
      break

    case 'tool_execution':
      addThoughtChainItem({
        title: `工具执行: ${data.tool_name}`,
        description: '执行完成',
        status: 'success',
        icon: h(CheckCircleOutlined),
        content: `结果: ${data.tool_result}`,
      })
      break

    case 'hitl_ai_request':
      handleHitlAiRequest(data)
      break

    case 'hitl_tool_approval':
      handleHitlToolApproval(data)
      break

    case 'similar_question':
      handleSimilarQuestion(data)
      break

    case 'error':
      handleSSEError(data)
      break

    case 'finished':
      handleFinish(data)
      break

    default:
      console.log('Unhandled event type:', eventType, data)
  }
}

// Handle source event
const handleSourceEvent = (data) => {
  if (data.tables && data.tables.length > 0) {
    pendingSourceTables.value = data.tables
    // Write directly to message if possible
    const loadingIndex = messages.value.findIndex((m) => m.loading || m.key === `ai-${currentAnswerId.value}`);
    if (loadingIndex >= 0) {
      messages.value[loadingIndex] = {
        ...messages.value[loadingIndex],
        sourceTables: [...data.tables]
      };
    }

    addThoughtChainItem({
      title: '数据溯源',
      description: `使用了 ${data.tables.length} 张表`,
      status: 'success',
      icon: h(DatabaseOutlined),
      content: data.tables.join(', '),
    })
  }
}

// Handle similar question event (multi-caliber + vector-recall similar indices)
// 后端在两种场景触发:
//   1) caliber_groups: 同 standardName 多口径(人行/银监/省联社)
//   2) similar_indices: 向量召回但 LLM 没选中的近邻指标(问"存款余额"召回到对公存款/储蓄存款等)
// UI 双通道展示:
//   - 思维链追加一条记录,便于回溯
//   - 主聊天流末尾追加一条 AI 气泡(纯 markdown,天然兼容 localStorage 持久化)
const handleSimilarQuestion = (data) => {
  const groups = Array.isArray(data.caliber_groups) ? data.caliber_groups : []
  const similar = Array.isArray(data.similar_indices) ? data.similar_indices : []
  if (groups.length === 0 && similar.length === 0) return

  // 1) 思维链
  const chainSections = []
  if (groups.length > 0) {
    chainSections.push(groups.map(g => {
      const entries = (g.entries || [])
        .map(e => {
          const tag = e.source != null ? ` [来源${e.source}]` : ''
          return `- \`${e.index_number}\`${tag}`
        })
        .join('\n')
      return `**${g.standard_name}** 涉及多个口径:\n${entries}`
    }).join('\n\n'))
  }
  if (similar.length > 0) {
    const lines = similar.map(e => {
      const aliases = Array.isArray(e.aliases) && e.aliases.length ? ` (别名: ${e.aliases.join('/')})` : ''
      const src = e.source != null ? ` [来源${e.source}]` : ''
      return `- \`${e.index_number}\` ${e.standard_name || ''}${aliases}${src}`
    }).join('\n')
    chainSections.push(`**召回的近邻指标 (向量相似):**\n${lines}`)
  }
  addThoughtChainItem({
    title: '相似问提示',
    description: groups.length + similar.length + ' 项相关指标',
    status: 'success',
    icon: h(BulbOutlined, { style: { color: '#fa8c16' } }),
    content: chainSections.join('\n\n---\n\n'),
  })

  // 2) 主气泡:用纯 markdown
  const mdParts = ['💡 **您可能还想问**', '']
  if (groups.length > 0) {
    mdParts.push('**多口径同名指标**（可以追问任一具体口径）:')
    mdParts.push('')
    groups.forEach(g => {
      const lines = (g.entries || [])
        .map(e => `  - \`${e.index_number}\`${e.source != null ? ` (来源 ${e.source})` : ''}`)
        .join('\n')
      mdParts.push(`- **${g.standard_name}**\n${lines}`)
    })
    mdParts.push('')
  }
  if (similar.length > 0) {
    mdParts.push('**相关指标**（向量召回，可能也是您想了解的）:')
    mdParts.push('')
    similar.forEach(e => {
      const aliases = Array.isArray(e.aliases) && e.aliases.length ? ` _(别名: ${e.aliases.join('/')})_` : ''
      mdParts.push(`- \`${e.index_number}\` **${e.standard_name || ''}**${aliases}`)
    })
  }
  messages.value.push({
    key: `similar-${Date.now()}`,
    role: 'ai',
    content: mdParts.join('\n'),
    loading: false,
    timestamp: Date.now(),
  })
}

// Handle SSE error event
const handleSSEError = (data) => {
  // Error data might be a string or an object
  let errorMsg = '服务器处理错误'
  if (typeof data === 'string') {
    errorMsg = data.trim()
  } else if (data?.error) {
    errorMsg = String(data.error).trim()
  } else if (data?.message) {
    errorMsg = String(data.message).trim()
  } else if (data) {
    // Try to stringify if it's an object
    try {
      errorMsg = JSON.stringify(data).trim()
    } catch (e) {
      errorMsg = String(data).trim()
    }
  }

  // Create a hash of the error message to check for duplicates
  const errorHash = errorMsg.substring(0, 100)

  // Skip if this exact error was already processed
  if (processedErrors.value.has(errorHash)) {
    console.log('Skipping duplicate error:', errorMsg.substring(0, 50))
    return
  }

  // Mark this error as processed
  processedErrors.value.add(errorHash)

  // Stop loading
  loading.value = false

  // Remove loading message
  const loadingIndex = messages.value.findIndex((m) => m.loading)
  if (loadingIndex >= 0) {
    messages.value.splice(loadingIndex, 1)
  }

  // Format error message for display
  const displayErrorMsg = errorMsg.length > 200
    ? errorMsg.substring(0, 200) + '...'
    : errorMsg

  // Add error message to chat
  const errorMessageKey = `error-${Date.now()}`
  const errorMessage = {
    key: errorMessageKey,
    role: 'ai',
    content: `错误: ${displayErrorMsg}`,
    timestamp: Date.now(),
  }
  messages.value.push(errorMessage)

  // Save messages to localStorage
  if (currentConversationId.value) {
    saveMessages(currentConversationId.value, messages.value)
  }

  // Add to thought chain
  addThoughtChainItem({
    title: '错误',
    description: displayErrorMsg,
    status: 'error',
    icon: h(ExclamationCircleOutlined),
    content: errorMsg, // Full error message in content
  })

  // Show error notification (only once, with shorter message)
  const notificationMsg = errorMsg.length > 100
    ? errorMsg.substring(0, 100) + '...'
    : errorMsg

  message.error({
    content: notificationMsg,
    duration: 6,
  })

  // Clean up old errors from the set (keep only last 10)
  if (processedErrors.value.size > 10) {
    const errorsArray = Array.from(processedErrors.value)
    processedErrors.value = new Set(errorsArray.slice(-10))
  }
}

// Handle incremental content for thought chain
const handleIncrementalContent = (title, data) => {
  const content = data.content || ''
  const error = data.error

  if (error) {
    addThoughtChainItem({
      title: title,
      description: '发生错误',
      status: 'error',
      icon: h(ExclamationCircleOutlined),
      content: error,
    })
    return
  }

  // Find if we already have an item with this title in the current chain
  const existingIndex = thoughtChainItems.value.findIndex(item => item.title === title)

  if (existingIndex >= 0) {
    // Update existing item
    const item = thoughtChainItems.value[existingIndex]
    // Use originalContent for string accumulation to avoid [object Object]
    const newContent = (item.originalContent || '') + content

    // Create updated item - addThoughtChainItem will handle VNode conversion
    const updatedItem = {
      ...item,
      content: newContent,
      originalContent: newContent,
      status: 'success'
    }

    // Update the ref - addThoughtChainItem handles the complexity of VNodes but for updates
    // we need to be careful. Let's reuse addThoughtChainItem logic by manually processing or re-calling it.
    // Actually, the simplest way is to just call a helper or re-process.
    // Let's manually convert to VNode here for the update to keep it simple.

    // We'll just replace the item and let the reactive system handle it.
    // However, addThoughtChainItem does the h() conversion.
    // Let's refactor slightly to avoid logic duplication.
    thoughtChainItems.value.splice(existingIndex, 1)
    addThoughtChainItem(updatedItem)
  } else {
    // Create new item
    addThoughtChainItem({
      title: title,
      description: '正在生成...',
      status: 'success',
      icon: h(FireOutlined),
      content: content,
    })
  }
}

// Handle agent answer streaming
const handleAgentAnswer = (data) => {
  if (!currentAnswerId.value) {
    currentAnswerId.value = data.answer_id
  }

  currentAnswer.value += data.answer || ''

  // Update or create AI message
  const messageKey = `ai-${currentAnswerId.value}`
  const existingIndex = messages.value.findIndex((m) => m.key === messageKey)

  const aiMessage = {
    key: messageKey,
    role: 'ai',
    content: currentAnswer.value,
    loading: false,
    timestamp: Date.now(),
    sourceTables: existingIndex >= 0 && messages.value[existingIndex].sourceTables
      ? messages.value[existingIndex].sourceTables
      : (pendingSourceTables.value.length > 0 ? [...pendingSourceTables.value] : null)
  }

  if (existingIndex >= 0) {
    messages.value[existingIndex] = aiMessage
  } else {
    // Remove loading message if exists
    const loadingIndex = messages.value.findIndex((m) => m.loading)
    if (loadingIndex >= 0) {
      messages.value.splice(loadingIndex, 1)
    }
    messages.value.push(aiMessage)
  }

  // Save messages to localStorage
  if (currentConversationId.value) {
    saveMessages(currentConversationId.value, messages.value)
  }

  nextTick(() => {
    scrollToBottom()
  })
}

// Handle agent answer end
const handleAgentAnswerEnd = (data) => {
  currentAnswer.value = ''
  currentAnswerId.value = null

  // Update reasoning items in thought chain to 'Completed'
  thoughtChainItems.value = thoughtChainItems.value.map(item => {
    if (item.description === '正在生成...') {
      return { ...item, description: '生成完成' }
    }
    return item
  })
}

// Handle HITL AI request
const handleHitlAiRequest = (data) => {
  hitlAiRequestModal.value = {
    visible: true,
    message: data.ai_request || 'AI 需要您的输入',
    conversationId: data.conversation_id,
    userInput: '',
  }
}

// Handle HITL tool approval
const handleHitlToolApproval = (data) => {
  hitlToolApprovalModal.value = {
    visible: true,
    message: data.tool_approval || '是否允许执行此工具？',
    conversationId: data.conversation_id,
    toolId: data.tool_id,
    toolName: data.tool_name || '未知工具',
    toolArguments: data.tool_arguments || '',
  }
}

// Submit AI request response
const handleSubmitAiRequest = async () => {
  if (!hitlAiRequestModal.value.userInput.trim()) {
    message.warning('请输入回复内容')
    return
  }

  try {
    await sendUserResponse({
      conversation_id: hitlAiRequestModal.value.conversationId,
      user_response: hitlAiRequestModal.value.userInput,
    })

    hitlAiRequestModal.value.visible = false
    message.success('回复已发送')
  } catch (error) {
    console.error('Error sending user response:', error)
    message.error('发送回复失败')
  }
}

// Handle tool approval
const handleToolApproval = async (approved) => {
  try {
    await sendUserApproval({
      conversation_id: hitlToolApprovalModal.value.conversationId,
      user_approval: approved,
    })

    hitlToolApprovalModal.value.visible = false
    message.success(approved ? '已批准' : '已拒绝')
  } catch (error) {
    console.error('Error sending approval:', error)
    message.error('操作失败')
  }
}

// Add thought chain item
const addThoughtChainItem = (item) => {
  // Store original content for localStorage (before converting to VNode)
  // If originalContent is provided, use it; otherwise use content
  const originalContent = item.originalContent !== undefined
    ? item.originalContent
    : (typeof item.content === 'string' ? item.content : '')

  // Process content to support markdown or VNode
  let processedContent = item.content

  // If content is already a VNode (like Table component), use it directly
  if (processedContent && typeof processedContent !== 'string') {
    // It's already a VNode, use as is
    processedContent = processedContent
  } else if (typeof processedContent === 'string' && hasMarkdown(processedContent)) {
    // Convert markdown to VNode
    const html = renderMarkdown(processedContent)
    processedContent = h('div', {
      class: 'markdown-content',
      innerHTML: html,
    })
  } else if (typeof processedContent === 'string') {
    // Plain text with line breaks
    processedContent = h('div', {
      class: 'plain-text-content',
      style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    }, processedContent)
  }

  const thoughtItem = {
    ...item,
    content: processedContent,
    originalContent: originalContent, // Store original for localStorage
    key: `thought-${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
  }

  thoughtChainItems.value.push(thoughtItem)

  // Keep only last 20 items
  if (thoughtChainItems.value.length > 20) {
    thoughtChainItems.value.shift()
  }

  // Save to localStorage
  if (currentConversationId.value) {
    // Convert VNodes back to strings for storage
    const itemsForStorage = thoughtChainItems.value.map(item => ({
      title: item.title,
      description: item.description,
      status: item.status,
      content: item.originalContent || (typeof item.content === 'string' ? item.content : ''),
      timestamp: item.timestamp,
    }))
    saveThoughtChain(currentConversationId.value, itemsForStorage)
  }
}

// Handle error (for network/fetch errors, not SSE error events)
const handleError = (error) => {
  console.error('Chat error:', error)
  loading.value = false

  // Remove loading message
  const loadingIndex = messages.value.findIndex((m) => m.loading)
  if (loadingIndex >= 0) {
    messages.value.splice(loadingIndex, 1)
  }

  // Check if error message already exists
  const errorMsg = error.message || '请求失败，请稍后重试'
  const errorExists = messages.value.some(
    (m) => m.role === 'ai' && m.content && m.content.includes(errorMsg.substring(0, 30))
  )

  if (!errorExists) {
    // Add error message
    const errorMessage = {
      key: `error-${Date.now()}`,
      role: 'ai',
      content: `错误: ${errorMsg}`,
    }
    messages.value.push(errorMessage)

    addThoughtChainItem({
      title: '错误',
      description: errorMsg,
      status: 'error',
      icon: h(ExclamationCircleOutlined),
    })
  }

  message.error(errorMsg)
}

// Handle finish
const handleFinish = (data) => {
  loading.value = false

  // Remove loading message
  const loadingIndex = messages.value.findIndex((m) => m.loading)
  if (loadingIndex >= 0) {
    messages.value.splice(loadingIndex, 1)
  }

  // Final update to thought chain items to ensure none are left in 'Generating' state
  thoughtChainItems.value = thoughtChainItems.value.map(item => {
    if (item.description === '正在生成...') {
      return { ...item, description: '生成完成' }
    }
    return item
  })

  // Save final messages and thought chain
  if (currentConversationId.value) {
    saveMessages(currentConversationId.value, messages.value)
    saveThoughtChain(currentConversationId.value, thoughtChainItems.value)

    // Update conversation title from first message
    const title = getConversationTitle(messages.value)
    addConversation(currentConversationId.value, title)

    // Force refresh conversation list
    refreshConversationList()
  }

  if (data?.status === 'succeeded') {
    addThoughtChainItem({
      title: '完成',
      description: '请求处理完成',
      status: 'success',
      icon: h(CheckCircleOutlined),
    })
  }

  currentAnswer.value = ''
  currentAnswerId.value = null
}

// Handle prompt click
const handlePromptClick = (info) => {
  inputValue.value = info.data.description
  handleSubmit(info.data.description)
}

// Handle delete conversation
const handleDeleteConversation = (conversationId) => {
  if (!conversationId) return

  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这条对话记录吗？删除后无法恢复。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => {
      try {
        // Delete from localStorage
        deleteConversation(conversationId)

        // If deleted conversation is currently active, clear it
        if (currentConversationId.value === conversationId) {
          handleNewConversation()
        }

        // Force refresh conversation list
        refreshConversationList()

        // Show success message
        message.success('对话已删除')
      } catch (error) {
        console.error('Error deleting conversation:', error)
        message.error('删除失败，请稍后重试')
      }
    },
  })
}

// Handle conversation change from Conversations component (onActiveChange)
const handleConversationChange = (key) => {
  console.log('Conversation active changed:', key)
  if (key && key !== currentConversationId.value) {
    currentConversationId.value = key
    loadConversation(key)
  }
}

// Load conversation from localStorage
const loadConversation = (conversationId) => {
  if (!conversationId) {
    console.warn('loadConversation: conversationId is empty')
    return
  }

  console.log('=== Loading conversation ===')
  console.log('Conversation ID:', conversationId)

  // Load conversation metadata (includes projectId / datasourceId / orgCode)
  const conversation = getConversation(conversationId)
  if (conversation) {
    currentProjectId.value = conversation.projectId || null
    currentDatasourceId.value = conversation.datasourceId || null
    currentOrgCode.value = conversation.orgCode || null
    console.log('Loaded project:', currentProjectId.value, 'datasource:', currentDatasourceId.value,
                'orgCode:', currentOrgCode.value)
  }

  // Load messages
  const savedMessages = getMessages(conversationId)
  console.log('Loaded messages count:', savedMessages?.length || 0)
  messages.value = savedMessages || []

  // Load thought chain and convert to VNodes
  const savedThoughtChain = getThoughtChain(conversationId)
  console.log('Loaded thought chain items count:', savedThoughtChain?.length || 0)
  console.log('Thought chain:', savedThoughtChain)
  thoughtChainItems.value = savedThoughtChain ? loadThoughtChainItems(savedThoughtChain) : []

  // Clear processed errors
  processedErrors.value.clear()

  console.log('After loading - messages.value.length:', messages.value.length)
  console.log('After loading - thoughtChainItems.value.length:', thoughtChainItems.value.length)

  // Scroll to bottom
  nextTick(() => {
    scrollToBottom()
  })
}

// Update conversation list
const updateConversationList = () => {
  if (currentConversationId.value) {
    // Update conversation title from messages
    const title = getConversationTitle(messages.value)
    addConversation(currentConversationId.value, title)
    // Force refresh conversation list
    refreshConversationList()
  }
}

// Scroll to bottom
const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
  }
}

// Cleanup on unmount
onUnmounted(() => {
  if (abortController.value) {
    abortController.value()
  }
})

// Load thought chain items from storage (convert strings back to VNodes)
const loadThoughtChainItems = (items) => {
  return items.map(item => {
    return {
      ...item,
      content: reconstructContent(item.content),
      originalContent: item.content,
    }
  })
}

// Focus sender on mount
onMounted(() => {
  nextTick(() => {
    senderRef.value?.focus()
  })
})
</script>

<style scoped>
/* 工具参数样式 */
.tool-arguments {
  margin: 0;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
  line-height: 1.5;
  max-height: 200px;
  overflow-y: auto;
}

/* Markdown 内容样式 */
.markdown-content {
  line-height: 1.8;
  word-wrap: break-word;
  font-size: 15px;
  color: #1d1d1f;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  line-height: 1.25;
}

.markdown-content :deep(h1) {
  font-size: 1.8em;
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.3em;
}

.markdown-content :deep(h2) {
  font-size: 1.4em;
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.3em;
}

.markdown-content :deep(h3) {
  font-size: 1.2em;
}

.markdown-content :deep(p) {
  margin-bottom: 12px;
  line-height: 1.7;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-bottom: 12px;
  padding-left: 2em;
}

.markdown-content :deep(li) {
  margin-bottom: 8px;
  line-height: 1.7;
}

.markdown-content :deep(blockquote) {
  margin: 16px 0;
  padding: 0 16px;
  border-left: 4px solid #1677ff;
  color: #666;
  font-style: italic;
}

.markdown-content :deep(code) {
  padding: 2px 6px;
  margin: 0 2px;
  font-size: 0.9em;
  background: #f5f5f5;
  border-radius: 4px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  color: #d63384;
}

.markdown-content :deep(pre) {
  padding: 16px;
  overflow: auto;
  background: #f5f5f5;
  border-radius: 8px;
  margin: 16px 0;
  font-size: 0.9em;
  line-height: 1.5;
}

.markdown-content :deep(pre code) {
  display: block;
  padding: 0;
  margin: 0;
  background: transparent;
  border-radius: 0;
  color: inherit;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  margin: 16px 0;
  width: 100%;
}

.markdown-content :deep(table th),
.markdown-content :deep(table td) {
  padding: 10px 14px;
  border: 1px solid #e8e8e8;
  text-align: left;
}

.markdown-content :deep(table th) {
  background: #fafafa;
  font-weight: 600;
}

.markdown-content :deep(table tr:nth-child(2n)) {
  background: #fafafa;
}

.markdown-content :deep(a) {
  color: #1677ff;
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(strong) {
  font-weight: 600;
}

.markdown-content :deep(em) {
  font-style: italic;
}

.markdown-content :deep(hr) {
  height: 0;
  margin: 16px 0;
  background: transparent;
  border: 0;
  border-top: 1px solid #eaecef;
}

.plain-text-content {
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.7;
  font-size: 15px;
  color: #1d1d1f;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}
</style>
