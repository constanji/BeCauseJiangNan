<template>
  <a-card 
    class="email-sender-config" 
    size="small"
    :bodyStyle="{ padding: enabled ? '16px' : '0' }"
  >
    <template #title>
      <div class="card-title">
        <MailOutlined />
        <span>邮件发送器</span>
      </div>
    </template>
    <template #extra>
      <a-switch v-model:checked="enabled" @change="handleEnableChange" />
    </template>
    
    <template v-if="enabled">
      <a-form layout="vertical" size="small">
        <a-row :gutter="16">
          <a-col :span="16">
            <a-form-item label="SMTP 服务器" required>
              <a-input 
                v-model:value="config['smtp-host']" 
                placeholder="smtp.gmail.com"
                @change="emitChange"
              />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="SMTP 端口">
              <a-input-number 
                v-model:value="config['smtp-port']" 
                :min="1" 
                :max="65535"
                style="width: 100%"
                placeholder="587"
                @change="emitChange"
              />
            </a-form-item>
          </a-col>
        </a-row>
        
        <a-form-item label="发件人地址" required>
          <a-input 
            v-model:value="config['from-address']" 
            placeholder="sender@example.com"
            @change="emitChange"
          />
        </a-form-item>
        
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item>
              <a-checkbox v-model:checked="config['auth-enabled']" @change="emitChange">
                启用 SMTP 认证
              </a-checkbox>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item>
              <a-checkbox v-model:checked="config['tls-enabled']" @change="emitChange">
                启用 TLS 加密
              </a-checkbox>
            </a-form-item>
          </a-col>
        </a-row>
        
        <template v-if="config['auth-enabled']">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="用户名">
                <a-input 
                  v-model:value="config['username']" 
                  placeholder="通常为邮箱地址"
                  @change="emitChange"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="密码">
                <a-input-password 
                  v-model:value="config['password']"
                  @change="emitChange"
                />
              </a-form-item>
            </a-col>
          </a-row>
        </template>
        
        <a-form-item label="发件人名称">
          <a-input 
            v-model:value="config['from-name']" 
            placeholder="DAT Agent"
            @change="emitChange"
          />
        </a-form-item>
        
        <a-collapse ghost>
          <a-collapse-panel key="advanced" header="高级配置">
            <a-row :gutter="16">
              <a-col :span="8">
                <a-form-item label="连接超时">
                  <a-input 
                    v-model:value="config['smtp-connection-timeout']" 
                    placeholder="30s"
                    @change="emitChange"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="发送超时">
                  <a-input 
                    v-model:value="config['smtp-timeout']" 
                    placeholder="30s"
                    @change="emitChange"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="写入超时">
                  <a-input 
                    v-model:value="config['smtp-write-timeout']" 
                    placeholder="30s"
                    @change="emitChange"
                  />
                </a-form-item>
              </a-col>
            </a-row>
          </a-collapse-panel>
        </a-collapse>
      </a-form>
    </template>
  </a-card>
</template>

<script setup>
import { ref, watch, reactive } from 'vue'
import { MailOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => null
  }
})

const emit = defineEmits(['update:modelValue'])

const enabled = ref(false)

const config = reactive({
  'smtp-host': '',
  'from-address': '',
  'smtp-port': 587,
  'auth-enabled': true,
  'tls-enabled': true,
  'username': '',
  'password': '',
  'from-name': 'DAT Agent',
  'smtp-connection-timeout': '30s',
  'smtp-timeout': '30s',
  'smtp-write-timeout': '30s'
})

// 监听外部值变化
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal && typeof newVal === 'object' && Object.keys(newVal).length > 0) {
      enabled.value = true
      Object.keys(config).forEach(key => {
        if (newVal[key] !== undefined) {
          config[key] = newVal[key]
        }
      })
    } else {
      enabled.value = false
    }
  },
  { immediate: true, deep: true }
)

const handleEnableChange = (checked) => {
  if (checked) {
    emitChange()
  } else {
    emit('update:modelValue', null)
  }
}

const emitChange = () => {
  if (!enabled.value) return
  
  const result = {}
  Object.keys(config).forEach(key => {
    if (config[key] !== '' && config[key] !== null && config[key] !== undefined) {
      result[key] = config[key]
    }
  })
  emit('update:modelValue', result)
}
</script>

<style scoped>
.email-sender-config {
  margin-bottom: 16px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
