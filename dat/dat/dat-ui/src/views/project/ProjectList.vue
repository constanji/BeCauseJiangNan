<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  DatabaseOutlined
} from '@ant-design/icons-vue'
import { getProjects, deleteProject } from '@/api/project'

const router = useRouter()
const loading = ref(false)
const projects = ref([])

const columns = [
  { title: '项目名称', dataIndex: 'name', key: 'name' },
  { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
  { title: '版本', dataIndex: 'version', key: 'version', width: 80 },
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
  { title: '操作', key: 'action', width: 200, fixed: 'right' },
]

const loadProjects = async () => {
  loading.value = true
  try {
    projects.value = await getProjects()
  } catch (error) {
    message.error('加载项目列表失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const handleCreate = () => {
  router.push('/projects/new')
}

const handleEdit = (record) => {
  router.push(`/projects/${record.id}/edit`)
}

const handleView = (record) => {
  router.push(`/projects/${record.id}`)
}

const handleDatasources = (record) => {
  router.push(`/projects/${record.id}/datasources`)
}

const handleDelete = (record) => {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除项目 "${record.name}" 吗？此操作不可恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await deleteProject(record.id)
        message.success('删除成功')
        loadProjects()
      } catch (error) {
        message.error('删除失败: ' + error.message)
      }
    },
  })
}

onMounted(() => {
  loadProjects()
})
</script>

<template>
  <div class="project-list">
    <div class="page-header">
      <h2>项目管理</h2>
      <a-button type="primary" @click="handleCreate">
        <PlusOutlined /> 创建项目
      </a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="projects"
      :loading="loading"
      :pagination="{ pageSize: 10 }"
      row-key="id"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'action'">
          <a-space>
            <a-tooltip title="查看">
              <a-button size="small" @click="handleView(record)">
                <EyeOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="数据源">
              <a-button size="small" @click="handleDatasources(record)">
                <DatabaseOutlined />
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
.project-list {
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
