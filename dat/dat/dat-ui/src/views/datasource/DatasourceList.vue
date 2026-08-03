<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  AppstoreOutlined,
  StarOutlined,
  StarFilled
} from '@ant-design/icons-vue'
import { getDatasources, deleteDatasource } from '@/api/datasource'
import { getGlobalConfig, updateGlobalConfig } from '@/api/project'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const datasources = ref([])
const defaultDatasourceId = ref(null)
const defaultProjectId = ref(null)

const projectId = computed(() => route.params.projectId)

const columns = [
  { title: '数据源名称', dataIndex: 'name', key: 'name' },
  { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
  { title: '提供者', dataIndex: 'provider', key: 'provider', width: 120 },
  { title: '状态', dataIndex: 'enabled', key: 'enabled', width: 100 },
  {
    title: '创建时间',
    dataIndex: 'createdAt',
    key: 'createdAt',
    width: 180,
    // 自定义渲染格式化时间
    customRender: ({ record }) => {
      const isoTime = record.createdAt;
      if (!isoTime) return '-'; // 空值兜底
      const date = new Date(isoTime);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
  },
  { title: '操作', key: 'action', width: 250, fixed: 'right' },
]

const loadDatasources = async () => {
  loading.value = true
  try {
    datasources.value = await getDatasources(projectId.value)
  } catch (error) {
    message.error('加载数据源列表失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const loadGlobalConfig = async () => {
  try {
    const config = await getGlobalConfig()
    defaultProjectId.value = config.default_project_id
    defaultDatasourceId.value = config.default_datasource_id
  } catch (error) {
    console.warn('加载全局配置失败:', error.message)
  }
}

const handleCreate = () => {
  if (projectId.value) {
    router.push(`/projects/${projectId.value}/datasources/new`)
  } else {
    router.push('/datasources/new')
  }
}

const handleEdit = (record) => {
  router.push(`/datasources/${record.id}/edit`)
}

const handleView = (record) => {
  router.push(`/datasources/${record.id}`)
}

const handleModels = (record) => {
  router.push(`/datasources/${record.id}/models`)
}

const handleSetDefault = async (record) => {
  try {
    // 从数据源对象中获取关联的项目ID
    const projectIdToSet = record.projectId || projectId.value

    if (!projectIdToSet) {
      message.error('无法获取项目ID，请确保数据源关联了项目')
      return
    }

    // 设置默认数据源时，同时设置关联的项目ID
    await updateGlobalConfig({
      default_project_id: projectIdToSet,
      default_datasource_id: record.id
    })

    defaultProjectId.value = projectIdToSet
    defaultDatasourceId.value = record.id
    message.success(`已将 "${record.name}" 设为默认数据源`)
  } catch (error) {
    message.error('设置默认数据源失败: ' + error.message)
  }
}

const handleDelete = (record) => {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除数据源 "${record.name}" 吗？此操作不可恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await deleteDatasource(record.id)
        message.success('删除成功')
        loadDatasources()
      } catch (error) {
        message.error('删除失败: ' + error.message)
      }
    },
  })
}

onMounted(() => {
  loadDatasources()
  loadGlobalConfig()
})
</script>

<template>
  <div class="datasource-list">
    <div class="page-header">
      <h2>数据源管理</h2>
      <a-button type="primary" @click="handleCreate">
        <PlusOutlined /> 添加数据源
      </a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="datasources"
      :loading="loading"
      :pagination="{ pageSize: 10 }"
      row-key="id"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'enabled'">
          <a-tag :color="record.enabled ? 'green' : 'red'">
            {{ record.enabled ? '已启用' : '已禁用' }}
          </a-tag>
        </template>
        <template v-if="column.key === 'action'">
          <a-space>
            <a-tooltip :title="record.id === defaultDatasourceId ? '默认数据源' : '设为默认'">
              <a-button
                size="small"
                :type="record.id === defaultDatasourceId ? 'primary' : 'default'"
                @click="handleSetDefault(record)"
                :disabled="record.id === defaultDatasourceId"
              >
                <StarFilled v-if="record.id === defaultDatasourceId" />
                <StarOutlined v-else />
              </a-button>
            </a-tooltip>
            <a-tooltip title="查看">
              <a-button size="small" @click="handleView(record)">
                <EyeOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="编辑">
              <a-button size="small" @click="handleEdit(record)">
                <EditOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="删除">
              <a-button size="small" danger @click="handleDelete(record)">
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<style scoped>
.datasource-list {
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
</style>
