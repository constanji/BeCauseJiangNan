<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ProjectOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  MessageOutlined,
  ArrowRightOutlined
} from '@ant-design/icons-vue'
import { getProjects } from '@/api/project'
import { getDatasources } from '@/api/datasource'

const router = useRouter()

const stats = ref([
  { title: '项目数量', value: 0, icon: ProjectOutlined, color: '#1890ff', path: '/projects' },
  { title: '数据源', value: 0, icon: DatabaseOutlined, color: '#52c41a', path: '/datasources' },
])

const quickActions = [
  { title: '创建项目', description: '创建一个新的 DAT 项目', path: '/projects/new' },
  { title: '管理数据源', description: '查看和管理所有数据源', path: '/datasources' },
  { title: '开始对话', description: '使用自然语言查询数据', path: '/chat' },
]

const goTo = (path) => {
  router.push(path)
}

// 加载统计数据
const loadStats = async () => {
  try {
    const [projects, datasources] = await Promise.all([
      getProjects(),
      getDatasources()
    ])

    stats.value[0].value = projects?.length || 0
    stats.value[1].value = datasources?.length || 0
    // 对话次数暂时保持为 0
  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

onMounted(() => {
  loadStats()
})
</script>

<template>
  <div class="dashboard">
    <h2 class="page-title">仪表盘</h2>

    <!-- 统计卡片 -->
    <a-row :gutter="16" class="stats-row">
      <a-col :span="8" v-for="stat in stats" :key="stat.title">
        <a-card hoverable @click="goTo(stat.path)">
          <a-statistic :title="stat.title" :value="stat.value">
            <template #prefix>
              <component :is="stat.icon" :style="{ color: stat.color }" />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- 快速操作 -->
    <h3 class="section-title">快速开始</h3>
    <a-row :gutter="16">
      <a-col :span="6" v-for="action in quickActions" :key="action.title">
        <a-card hoverable @click="goTo(action.path)" class="action-card">
          <h4>{{ action.title }}</h4>
          <p>{{ action.description }}</p>
          <a-button type="link" class="action-link">
            开始 <ArrowRightOutlined />
          </a-button>
        </a-card>
      </a-col>
    </a-row>

    <!-- 最近活动 -->
    <h3 class="section-title">使用指南</h3>
    <a-card>
      <a-timeline>
        <a-timeline-item color="blue">
          <strong>Step 1: 创建项目</strong>
          <p>项目是 DAT 的顶层组织单元，包含数据库配置、LLM配置等</p>
        </a-timeline-item>
        <a-timeline-item color="green">
          <strong>Step 2: 添加数据源</strong>
          <p>配置数据库连接，支持 MySQL、PostgreSQL、ClickHouse 等</p>
        </a-timeline-item>
        <a-timeline-item color="purple">
          <strong>Step 3: 预处理与 Light Schema</strong>
          <p>生成 Light Schema 和向量化关键列值，显著提升 AI 对数据库结构的理解能力</p>
        </a-timeline-item>
        <a-timeline-item color="orange">
          <strong>Step 4: 开始对话</strong>
          <p>使用自然语言查询数据，系统自动生成 SQL 并执行</p>
        </a-timeline-item>
      </a-timeline>
    </a-card>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 0;
}

.page-title {
  margin-bottom: 24px;
  font-size: 24px;
  font-weight: 600;
}

.section-title {
  margin: 32px 0 16px;
  font-size: 18px;
  font-weight: 500;
}

.stats-row {
  margin-bottom: 24px;
}

.action-card {
  height: 150px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.action-card h4 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}

.action-card p {
  color: #666;
  margin-bottom: 8px;
}

.action-link {
  padding: 0;
}
</style>
