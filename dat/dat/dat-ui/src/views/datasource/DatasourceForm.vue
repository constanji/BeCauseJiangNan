<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { getDatasource, createDatasource, updateDatasource } from '@/api/datasource'
import { getProjects } from '@/api/project'

const router = useRouter()
const route = useRoute()

const loading = ref(false)
const saving = ref(false)
const projects = ref([])

const isEdit = computed(() => !!route.params.id)
const pageTitle = computed(() => isEdit.value ? '编辑数据源' : '添加数据源')
// 从路由获取 projectId，如果没有则需要用户选择
const routeProjectId = computed(() => route.params.projectId || route.query.projectId)

const formState = ref({
  projectId: '',
  name: '',
  description: '',
  provider: 'mysql',
  connectionConfig: {
    host: 'localhost',
    port: 3306,
    database: '',
    username: '',
    password: ''
  }
})

const providerOptions = [
  { label: 'MySQL', value: 'mysql' },
  { label: 'PostgreSQL', value: 'postgresql' },
  { label: 'ClickHouse', value: 'clickhouse' },
  { label: 'SQLite', value: 'sqlite' },
]

const rules = {
  projectId: [{ required: true, message: '请选择所属项目', trigger: 'change' }],
  name: [{ required: true, message: '请输入数据源名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择提供者类型', trigger: 'change' }],
}

// 加载项目列表
const loadProjects = async () => {
  try {
    projects.value = await getProjects()
  } catch (error) {
    console.error('加载项目列表失败:', error)
  }
}

const loadDatasource = async () => {
  if (!isEdit.value) return
  
  loading.value = true
  try {
    const ds = await getDatasource(route.params.id)
    formState.value = {
      projectId: ds.projectId || '',
      name: ds.name || '',
      description: ds.description || '',
      provider: ds.provider || 'mysql',
      connectionConfig: ds.configuration || {}
    }
  } catch (error) {
    message.error('加载数据源失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const handleSubmit = async () => {
  saving.value = true
  try {
    const submitData = {
      projectId: formState.value.projectId,
      name: formState.value.name,
      description: formState.value.description,
      provider: formState.value.provider,
      connectionConfig: formState.value.connectionConfig
    }
    
    if (isEdit.value) {
      await updateDatasource(route.params.id, submitData)
      message.success('数据源更新成功')
    } else {
      await createDatasource(submitData)
      message.success('数据源创建成功')
    }
    router.back()
  } catch (error) {
    message.error('保存失败: ' + error.message)
  } finally {
    saving.value = false
  }
}

const handleCancel = () => {
  router.back()
}

onMounted(async () => {
  await loadProjects()
  // 如果路由中有 projectId，则预填充
  if (routeProjectId.value) {
    formState.value.projectId = routeProjectId.value
  }
  loadDatasource()
})
</script>

<template>
  <div class="datasource-form">
    <div class="page-header">
      <h2>{{ pageTitle }}</h2>
    </div>

    <a-spin :spinning="loading">
      <a-form
        :model="formState"
        :rules="rules"
        layout="vertical"
        @finish="handleSubmit"
        style="max-width: 600px"
      >
        <a-form-item label="所属项目" name="projectId">
          <a-select 
            v-model:value="formState.projectId" 
            placeholder="请选择所属项目"
            :options="projects.map(p => ({ label: p.name, value: p.id }))"
            show-search
            :filter-option="(input, option) => option.label.toLowerCase().includes(input.toLowerCase())"
          />
        </a-form-item>

        <a-form-item label="数据源名称" name="name">
          <a-input 
            v-model:value="formState.name" 
            placeholder="请输入数据源名称"
          />
        </a-form-item>

        <a-form-item label="描述" name="description">
          <a-textarea 
            v-model:value="formState.description" 
            placeholder="请输入描述"
            :rows="2"
          />
        </a-form-item>

        <a-form-item label="数据库类型" name="provider">
          <a-select v-model:value="formState.provider" :options="providerOptions" />
        </a-form-item>

        <a-divider>连接配置</a-divider>

        <a-form-item label="主机">
          <a-input v-model:value="formState.connectionConfig.host" placeholder="localhost" />
        </a-form-item>

        <a-form-item label="端口">
          <a-input-number v-model:value="formState.connectionConfig.port" style="width: 100%" />
        </a-form-item>

        <a-form-item label="数据库名">
          <a-input v-model:value="formState.connectionConfig.database" placeholder="database" />
        </a-form-item>

        <a-form-item label="用户名">
          <a-input v-model:value="formState.connectionConfig.username" placeholder="username" />
        </a-form-item>

        <a-form-item label="密码">
          <a-input-password v-model:value="formState.connectionConfig.password" placeholder="password" />
        </a-form-item>

        <a-form-item>
          <a-space>
            <a-button type="primary" html-type="submit" :loading="saving">
              {{ isEdit ? '保存修改' : '创建数据源' }}
            </a-button>
            <a-button @click="handleCancel">取消</a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-spin>
  </div>
</template>

<style scoped>
.datasource-form {
  padding: 0;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
}
</style>
