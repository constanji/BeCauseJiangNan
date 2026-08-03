<template>
  <a-modal
    v-model:open="visible"
    :title="isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'"
    :width="600"
    @ok="handleOk"
    @cancel="handleCancel"
  >
    <a-form layout="vertical">
      <a-form-item label="服务器名称" required>
        <a-input 
          v-model:value="form.name" 
          placeholder="server_name"
          :disabled="isEdit"
        />
      </a-form-item>
      
      <a-form-item label="传输方式" required>
        <a-radio-group v-model:value="form.transport">
          <a-radio-button value="http">HTTP</a-radio-button>
          <a-radio-button value="stdio">STDIO</a-radio-button>
        </a-radio-group>
      </a-form-item>
      
      <!-- HTTP 模式配置 -->
      <template v-if="form.transport === 'http'">
        <a-form-item label="服务器 URL" required>
          <a-input 
            v-model:value="form.url" 
            placeholder="http://localhost:3002/mcp"
          />
          <template #extra>
            <span class="hint-text">Streamable HTTP 模式。如使用 SSE (已废弃)，请填写 sse-url</span>
          </template>
        </a-form-item>
        
        <a-form-item label="SSE URL (已废弃)">
          <a-input 
            v-model:value="form['sse-url']" 
            placeholder="http://localhost:3001/sse"
          />
        </a-form-item>
        
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item>
              <a-checkbox v-model:checked="form['log-requests']">
                记录请求日志
              </a-checkbox>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item>
              <a-checkbox v-model:checked="form['log-responses']">
                记录响应日志
              </a-checkbox>
            </a-form-item>
          </a-col>
        </a-row>
        
        <a-form-item label="超时时间 (ms)">
          <a-input-number 
            v-model:value="form.timeout" 
            :min="1000"
            style="width: 100%"
            placeholder="60000"
          />
        </a-form-item>
        
        <a-form-item label="自定义请求头">
          <KeyValueEditor 
            v-model="form['custom-headers']" 
            add-button-text="添加请求头"
          />
        </a-form-item>
      </template>
      
      <!-- STDIO 模式配置 -->
      <template v-if="form.transport === 'stdio'">
        <a-form-item label="启动命令" required>
          <a-input 
            v-model:value="commandString" 
            placeholder="npm exec @modelcontextprotocol/server-everything@0.6.2"
          />
          <template #extra>
            <span class="hint-text">命令和参数用空格分隔</span>
          </template>
        </a-form-item>
        
        <a-form-item>
          <a-checkbox v-model:checked="form['log-events']">
            记录事件日志
          </a-checkbox>
        </a-form-item>
        
        <a-form-item label="环境变量">
          <KeyValueEditor 
            v-model="form.environment" 
            add-button-text="添加环境变量"
          />
        </a-form-item>
      </template>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue'
import KeyValueEditor from './KeyValueEditor.vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  serverName: {
    type: String,
    default: ''
  },
  serverConfig: {
    type: Object,
    default: () => null
  }
})

const emit = defineEmits(['update:open', 'save'])

const visible = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val)
})

const isEdit = computed(() => !!props.serverName)

const getDefaultForm = () => ({
  name: '',
  transport: 'http',
  // HTTP 配置
  url: '',
  'sse-url': '',
  'log-requests': true,
  'log-responses': true,
  timeout: 60000,
  'custom-headers': {},
  // STDIO 配置
  command: [],
  'log-events': true,
  environment: {}
})

const form = reactive(getDefaultForm())

// 命令字符串转换
const commandString = computed({
  get: () => Array.isArray(form.command) ? form.command.join(' ') : '',
  set: (val) => {
    form.command = val.split(/\s+/).filter(s => s.trim())
  }
})

// 监听打开状态，重置或加载配置
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      if (props.serverConfig) {
        // 编辑模式：加载现有配置
        Object.assign(form, getDefaultForm())
        form.name = props.serverName
        Object.keys(props.serverConfig).forEach(key => {
          if (key in form) {
            form[key] = props.serverConfig[key]
          }
        })
      } else {
        // 新建模式：重置表单
        Object.assign(form, getDefaultForm())
      }
    }
  }
)

const handleOk = () => {
  if (!form.name.trim()) {
    return
  }
  
  // 构建配置对象
  const config = {
    transport: form.transport
  }
  
  if (form.transport === 'http') {
    if (form.url) config.url = form.url
    if (form['sse-url']) config['sse-url'] = form['sse-url']
    if (form['log-requests']) config['log-requests'] = form['log-requests']
    if (form['log-responses']) config['log-responses'] = form['log-responses']
    if (form.timeout) config.timeout = form.timeout
    if (form['custom-headers'] && Object.keys(form['custom-headers']).length > 0) {
      config['custom-headers'] = form['custom-headers']
    }
  } else {
    if (form.command && form.command.length > 0) {
      config.command = form.command
    }
    if (form['log-events']) config['log-events'] = form['log-events']
    if (form.environment && Object.keys(form.environment).length > 0) {
      config.environment = form.environment
    }
  }
  
  emit('save', { name: form.name.trim(), config })
  visible.value = false
}

const handleCancel = () => {
  visible.value = false
}
</script>

<style scoped>
.hint-text {
  color: #888;
  font-size: 12px;
}
</style>
