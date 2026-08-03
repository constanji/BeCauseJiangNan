<template>
  <a-card class="mcp-servers-config" size="small">
    <template #title>
      <div class="card-title">
        <ApiOutlined />
        <span>MCP 服务器</span>
      </div>
    </template>
    <template #extra>
      <a-button type="primary" size="small" @click="openAddModal">
        <template #icon><PlusOutlined /></template>
        添加服务器
      </a-button>
    </template>
    
    <a-empty v-if="serverList.length === 0" description="暂无 MCP 服务器配置" />
    
    <div v-else class="server-list">
      <div 
        v-for="server in serverList" 
        :key="server.name" 
        class="server-item"
      >
        <div class="server-info">
          <div class="server-name">
            <CloudServerOutlined />
            <strong>{{ server.name }}</strong>
          </div>
          <div class="server-detail">
            <a-tag :color="server.config.transport === 'http' ? 'blue' : 'green'">
              {{ server.config.transport.toUpperCase() }}
            </a-tag>
            <span class="server-url">
              {{ getServerUrl(server.config) }}
            </span>
          </div>
        </div>
        <div class="server-actions">
          <a-button type="text" size="small" @click="openEditModal(server)">
            <template #icon><EditOutlined /></template>
          </a-button>
          <a-popconfirm
            title="确定删除此服务器配置?"
            ok-text="确定"
            cancel-text="取消"
            @confirm="removeServer(server.name)"
          >
            <a-button type="text" danger size="small">
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </a-popconfirm>
        </div>
      </div>
    </div>
    
    <McpServerModal
      v-model:open="modalVisible"
      :server-name="editingServer?.name || ''"
      :server-config="editingServer?.config || null"
      @save="handleSave"
    />
  </a-card>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { 
  ApiOutlined, 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined,
  CloudServerOutlined 
} from '@ant-design/icons-vue'
import McpServerModal from './McpServerModal.vue'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue'])

const modalVisible = ref(false)
const editingServer = ref(null)

// 将对象转换为数组形式
const serverList = computed(() => {
  if (!props.modelValue || typeof props.modelValue !== 'object') {
    return []
  }
  return Object.entries(props.modelValue).map(([name, config]) => ({
    name,
    config
  }))
})

const getServerUrl = (config) => {
  if (config.transport === 'http') {
    return config.url || config['sse-url'] || '-'
  } else {
    const cmd = config.command
    return Array.isArray(cmd) ? cmd.join(' ') : (cmd || '-')
  }
}

const openAddModal = () => {
  editingServer.value = null
  modalVisible.value = true
}

const openEditModal = (server) => {
  editingServer.value = server
  modalVisible.value = true
}

const removeServer = (name) => {
  const newValue = { ...props.modelValue }
  delete newValue[name]
  emit('update:modelValue', newValue)
}

const handleSave = ({ name, config }) => {
  const newValue = { ...props.modelValue }
  
  // 如果是编辑且名称变了，删除旧的
  if (editingServer.value && editingServer.value.name !== name) {
    delete newValue[editingServer.value.name]
  }
  
  newValue[name] = config
  emit('update:modelValue', newValue)
}
</script>

<style scoped>
.mcp-servers-config {
  margin-bottom: 16px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.server-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  background: #fafafa;
}

.server-info {
  flex: 1;
}

.server-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.server-detail {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #666;
}

.server-url {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-actions {
  display: flex;
  gap: 4px;
}
</style>
