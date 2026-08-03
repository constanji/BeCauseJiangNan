<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { marked } from 'marked'
import { 
  EditOutlined, 
  DeleteOutlined, 
  ArrowLeftOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  RocketOutlined,
  DeploymentUnitOutlined,
  ClearOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  SearchOutlined
} from '@ant-design/icons-vue'
import { getDatasource, deleteDatasource } from '@/api/datasource'
import {
  generateLightSchema,
  vectorizeCells,
  clearPreprocessing,
  listLightSchemas,
  listDatasourceTables,
  listDatasourceSchemas,
  listCellTables
} from '@/api/contentStore'

const router = useRouter()
const route = useRoute()

const loading = ref(false)
const processing = ref(false)
const datasource = ref(null)
const activeTab = ref('schema')
const schemas = ref([])
const selectedTableName = ref(null)
const tableSearch = ref('')

// ========= 选表生成 / 向量化 弹窗状态 =========
// mode: 'schema' | 'cells' —— 区分调用方
const tableSelectMode = ref('schema')
const tableSelectVisible = ref(false)
const tableSelectLoading = ref(false)
const allTables = ref([])
const selectedTables = ref([])
const tableSelectSearch = ref('')

const generatedTableNames = computed(() => new Set(schemas.value.map(s => s.tableName)))
// 已向量化过单元格的表名集合 —— 单元格对话框打开时按需拉取
const cellGeneratedTables = ref(new Set())
// 弹窗里"已生成"标签应该绑定哪个数据集，取决于当前模式
const activeGeneratedSet = computed(() =>
  tableSelectMode.value === 'cells' ? cellGeneratedTables.value : generatedTableNames.value
)

// ========= 选 schema / 选表相关 =========
const dbSchemas = ref([])
const selectedDbSchema = ref(null)
const schemaLoading = ref(false)

const filteredAllTables = computed(() => {
  if (!tableSelectSearch.value) return allTables.value
  const kw = tableSelectSearch.value.toLowerCase()
  return allTables.value.filter(t => t.toLowerCase().includes(kw))
})

// 多 schema 数据源（如 PostgreSQL/GaussDB）才需要给表名加 schema 前缀
const shouldQualifyTables = computed(() => dbSchemas.value.length > 1)

// 把当前 schema 下的裸表名转成后端可识别的形式
const qualifyTable = (tableName) => {
  if (!shouldQualifyTables.value || !selectedDbSchema.value) return tableName
  return `${selectedDbSchema.value}.${tableName}`
}

// 从已选项中解析出在当前 schema 下被选中的裸表名
const selectedTablesInCurrentSchema = computed(() => {
  if (!shouldQualifyTables.value) return selectedTables.value
  const prefix = selectedDbSchema.value ? `${selectedDbSchema.value}.` : ''
  return selectedTables.value
    .filter(t => t.startsWith(prefix))
    .map(t => t.substring(prefix.length))
})

const allSelectedInFilter = computed(() => {
  if (filteredAllTables.value.length === 0) return false
  const currentSelected = new Set(selectedTablesInCurrentSchema.value)
  return filteredAllTables.value.every(t => currentSelected.has(t))
})

const indeterminateInFilter = computed(() => {
  const currentSelected = new Set(selectedTablesInCurrentSchema.value)
  const matched = filteredAllTables.value.filter(t => currentSelected.has(t))
  return matched.length > 0 && matched.length < filteredAllTables.value.length
})

const toggleSelectAllFiltered = (e) => {
  const checked = e.target.checked
  const filtered = filteredAllTables.value
  const qualified = filtered.map(t => qualifyTable(t))
  if (checked) {
    const merged = new Set([...selectedTables.value, ...qualified])
    selectedTables.value = Array.from(merged)
  } else {
    const toRemove = new Set(qualified)
    selectedTables.value = selectedTables.value.filter(t => !toRemove.has(t))
  }
}

const loadDatasource = async () => {
  loading.value = true
  try {
    const data = await getDatasource(route.params.id)
    datasource.value = data
    if (data.projectId) {
      loadSchemas()
    }
  } catch (error) {
    message.error('加载数据源失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const loadSchemas = async () => {
  try {
    const data = await listLightSchemas(datasource.value.projectId, route.params.id)
    schemas.value = data || []
    if (schemas.value.length > 0 && !selectedTableName.value) {
      selectedTableName.value = schemas.value[0].tableName
    }
  } catch (error) {
    console.error('Failed to load schemas:', error)
  }
}

const filteredSchemas = computed(() => {
  if (!tableSearch.value) return schemas.value
  return schemas.value.filter(s => 
    s.tableName.toLowerCase().includes(tableSearch.value.toLowerCase()) ||
    (s.tableDescription && s.tableDescription.toLowerCase().includes(tableSearch.value.toLowerCase()))
  )
})

const selectedSchema = computed(() => {
  return schemas.value.find(s => s.tableName === selectedTableName.value)
})

const renderedMarkdown = computed(() => {
  if (!selectedSchema.value) return ''
  // Use toMarkdown logic if available as string or reconstruct it
  // Since we get the full LightSchema object, we can reconstruct the MD for rendering
  return marked.parse(generateMarkdown(selectedSchema.value))
})

// Helper to reconstruct Markdown from the JSON object (similar to backend LightSchema.toMarkdown)
const generateMarkdown = (s) => {
  let md = `## Table: ${s.tableName}\n`
  md += `### Table description\n${s.tableDescription || 'No description available.'}\n\n`
  md += `### Column information\n`
  md += `| column_name | column_type | column_description | value_examples |\n`
  md += `| --- | --- | --- | --- |\n`
  s.columns.forEach(col => {
    const samples = col.sampleValues ? JSON.stringify(col.sampleValues) : '[]'
    md += `| ${col.name} | ${col.type} | ${col.description || ''} | ${samples} |\n`
  })
  
  if (s.primaryKeys?.length) {
    md += `\n### Primary keys\n${s.primaryKeys.join(', ')}\n`
  }
  
  if (s.foreignKeys?.length) {
    md += `\n### Foreign keys\n`
    s.foreignKeys.forEach(fk => {
      md += `- ${fk.columnName} -> ${fk.referencedTable}(${fk.referencedColumn})\n`
    })
  }
  
  if (s.indices?.length) {
    md += `\n### Indices\n${s.indices.join(', ')}\n`
  }
  return md
}

const loadTablesForSelectedSchema = async () => {
  if (!datasource.value?.projectId) return
  tableSelectLoading.value = true
  try {
    const tables = await listDatasourceTables(
      datasource.value.projectId,
      route.params.id,
      selectedDbSchema.value
    )
    allTables.value = tables || []
  } catch (e) {
    message.error('加载表列表失败: ' + e.message)
    allTables.value = []
  } finally {
    tableSelectLoading.value = false
  }
}

const onDbSchemaChange = async (schema) => {
  selectedDbSchema.value = schema
  allTables.value = []
  if (dbSchemas.value.length > 0 && !schema) return
  await loadTablesForSelectedSchema()
}

const openTableSelector = async (mode) => {
  if (!datasource.value?.projectId) {
    message.warning('数据源尚未关联项目')
    return
  }
  tableSelectMode.value = mode
  tableSelectVisible.value = true
  tableSelectSearch.value = ''
  selectedTables.value = []
  selectedDbSchema.value = null
  dbSchemas.value = []
  allTables.value = []
  schemaLoading.value = true
  tableSelectLoading.value = false

  try {
    const schemaList = await listDatasourceSchemas(datasource.value.projectId, route.params.id)
    dbSchemas.value = schemaList || []

    // 单 schema / 无 schema 场景直接选中并加载表
    if (dbSchemas.value.length === 1) {
      selectedDbSchema.value = dbSchemas.value[0]
      await loadTablesForSelectedSchema()
    } else if (dbSchemas.value.length === 0) {
      // 兜底：适配器没有 schema 概念，直接加载全部表
      await loadTablesForSelectedSchema()
    }

    // 单元格模式：拉取该数据源已向量化的表名（独立于 LightSchema 状态）
    if (mode === 'cells') {
      try {
        const cellTabs = await listCellTables(datasource.value.projectId, route.params.id)
        cellGeneratedTables.value = new Set(cellTabs || [])
      } catch (e) {
        cellGeneratedTables.value = new Set()
        console.warn('Failed to load cell tables:', e)
      }
    }
  } catch (error) {
    message.error('加载 schema 列表失败: ' + error.message)
    tableSelectVisible.value = false
  } finally {
    schemaLoading.value = false
  }
}

const handleGenerateSchema = () => openTableSelector('schema')
const handleVectorizeCells = () => openTableSelector('cells')

const confirmTableSelection = async () => {
  if (selectedTables.value.length === 0) {
    message.warning('请至少选择一张表')
    return
  }
  const projectId = datasource.value.projectId
  const datasourceId = route.params.id
  processing.value = true
  try {
    if (tableSelectMode.value === 'schema') {
      const res = await generateLightSchema(projectId, datasourceId, 5, [...selectedTables.value], true)
      message.success(res)
      await loadSchemas()
    } else {
      const res = await vectorizeCells(projectId, datasourceId, 100, [...selectedTables.value])
      message.success(res)
    }
    tableSelectVisible.value = false
  } catch (error) {
    message.error((tableSelectMode.value === 'schema' ? '生成 Light Schema 失败: ' : '向量化失败: ') + error.message)
  } finally {
    processing.value = false
  }
}

const handleClearPreprocessing = async () => {
  if (!datasource.value?.projectId) return
  try {
    const res = await clearPreprocessing(datasource.value.projectId, route.params.id)
    message.success(res)
    schemas.value = []
    selectedTableName.value = null
  } catch (error) {
    message.error('清空失败: ' + error.message)
  }
}

const handleEdit = () => {
  router.push(`/datasources/${route.params.id}/edit`)
}

const handleDelete = async () => {
  try {
    await deleteDatasource(route.params.id)
    message.success('删除成功')
    router.push('/datasources')
  } catch (error) {
    message.error('删除失败: ' + error.message)
  }
}

const handleBack = () => {
  router.push('/datasources')
}

onMounted(() => {
  loadDatasource()
})
</script>

<template>
  <div class="datasource-detail-container">
    <!-- Header Section -->
    <div class="header-banner">
      <div class="header-left">
        <a-button type="text" class="back-btn" @click="handleBack">
          <ArrowLeftOutlined />
        </a-button>
        <div class="title-section">
          <div class="breadcrumb">数据源 / 详情</div>
          <h2 class="page-title">
            <DatabaseOutlined class="icon" />
            {{ datasource?.name || '数据源详情' }}
            <a-tag :color="datasource?.enabled ? 'green' : 'red'" class="status-tag">
              {{ datasource?.enabled ? '已启用' : '已禁用' }}
            </a-tag>
          </h2>
        </div>
      </div>
      <div class="header-right">
        <a-space>
          <a-button @click="handleEdit">
            <EditOutlined /> 编辑
          </a-button>
          <a-popconfirm title="确定要删除此数据源吗？" @confirm="handleDelete">
            <a-button danger type="primary">
              <DeleteOutlined /> 删除
            </a-button>
          </a-popconfirm>
        </a-space>
      </div>
    </div>

    <div class="content-wrapper">
      <a-spin :spinning="loading" class="content-spin" :style="{ height: '100%' }">
        <div v-if="datasource" class="content-body">
          <a-tabs v-model:activeKey="activeTab" class="custom-tabs">
          <!-- SCHEMA TAB: Progressive Disclosure Style Navigator -->
          <a-tab-pane key="schema" tab="逻辑架构 (Light Schema)">
            <div class="schema-layout">
              <div class="schema-sidebar">
                <div class="sidebar-header">
                  <div class="sidebar-title">
                    <span>数据表</span>
                    <a-badge :count="schemas.length" :number-style="{ backgroundColor: '#3b82f6' }" />
                  </div>
                  <a-input v-model:value="tableSearch" placeholder="搜索表名或描述..." allow-clear size="small">
                    <template #prefix><SearchOutlined /></template>
                  </a-input>
                </div>
                <div class="table-list">
                  <div
                    v-for="s in filteredSchemas"
                    :key="s.tableName"
                    :class="['table-item', { active: selectedTableName === s.tableName }]"
                    @click="selectedTableName = s.tableName"
                  >
                    <div class="table-name">
                      {{ s.tableName }}
                      <a-tag color="green" class="generated-tag">已生成</a-tag>
                    </div>
                    <div class="table-desc" v-if="s.tableDescription">{{ s.tableDescription }}</div>
                  </div>
                  <a-empty v-if="filteredSchemas.length === 0" description="未找到表结构" style="margin-top: 40px" />
                </div>
              </div>
              
              <div class="schema-main">
                <div v-if="selectedSchema" class="markdown-preview-card">
                  <div class="preview-header">
                    <a-space>
                      <FileTextOutlined /> <span>{{ selectedSchema.tableName }} 预览</span>
                    </a-space>
                  </div>
                  <div class="markdown-body" v-html="renderedMarkdown"></div>
                </div>
                <div v-else class="empty-schema-state">
                  <div class="state-content">
                    <RocketOutlined class="big-icon" />
                    <h3>尚未生成架构描述</h3>
                    <p>点击下方按钮，我们将利用 AI 自动分析您的数据库并生成极简架构 (Light Schema)。</p>
                    <a-button type="primary" size="large" :loading="processing" @click="handleGenerateSchema">
                      立即生成 Light Schema
                    </a-button>
                  </div>
                </div>
              </div>
            </div>
          </a-tab-pane>

          <!-- OVERVIEW TAB -->
          <a-tab-pane key="overview" tab="概览与配置">
            <a-row :gutter="24">
              <a-col :span="14">
                <a-card title="基本信息" :bordered="false" class="info-card glossy">
                  <a-descriptions :column="1" size="middle">
                    <a-descriptions-item label="名称">{{ datasource.name }}</a-descriptions-item>
                    <a-descriptions-item label="类型">
                      <a-tag color="processing">{{ datasource.provider?.toUpperCase() }}</a-tag>
                    </a-descriptions-item>
                    <a-descriptions-item label="所属项目">
                      <span class="mono">{{ datasource.projectId || '未关联' }}</span>
                    </a-descriptions-item>
                    <a-descriptions-item label="描述">{{ datasource.description || '无' }}</a-descriptions-item>
                    <a-descriptions-item label="创建时间">{{ datasource.createdAt || '-' }}</a-descriptions-item>
                  </a-descriptions>
                </a-card>

                <a-card title="连接配置" :bordered="false" class="info-card glossy" style="margin-top: 24px">
                  <a-descriptions :column="2" size="middle">
                    <a-descriptions-item label="主机">{{ datasource.configuration?.host || '-' }}</a-descriptions-item>
                    <a-descriptions-item label="端口">{{ datasource.configuration?.port || '-' }}</a-descriptions-item>
                    <a-descriptions-item label="数据库">{{ datasource.configuration?.database || '-' }}</a-descriptions-item>
                    <a-descriptions-item label="用户名">{{ datasource.configuration?.username || '-' }}</a-descriptions-item>
                    <a-descriptions-item label="密码">••••••••</a-descriptions-item>
                  </a-descriptions>
                </a-card>
              </a-col>

              <a-col :span="10">
                <a-card title="预处理控制" :bordered="false" class="info-card glossy">
                  <div class="control-section">
                    <div class="control-item">
                      <div class="control-icon"><RocketOutlined /></div>
                      <div class="control-text">
                        <h4>Light Schema</h4>
                        <p>替代语义模型，提供极简架构描述供 LLM 理解。</p>
                      </div>
                      <a-button :loading="processing" @click="handleGenerateSchema">重生成</a-button>
                    </div>

                    <div class="control-item">
                      <div class="control-icon"><DeploymentUnitOutlined /></div>
                      <div class="control-text">
                        <h4>单元格向量化</h4>
                        <p>将数据库字段值存入向量库，辅助模糊匹配。</p>
                      </div>
                      <a-button :loading="processing" @click="handleVectorizeCells">开始执行</a-button>
                    </div>

                    <a-divider />
                    
                    <a-popconfirm title="确定要清空所有预处理数据吗？" @confirm="handleClearPreprocessing">
                      <a-button danger type="link" block>
                        <ClearOutlined /> 清空所有预处理数据
                      </a-button>
                    </a-popconfirm>
                  </div>
                </a-card>

                <a-alert
                  type="info"
                  show-icon
                  style="margin-top: 24px"
                  message="Text-to-SQL 增强"
                  description="Light Schema 和单元格向量化是提升 SQL 生成准确率的关键步骤。AI 会根据这些信息精准定位表和字段。"
                />
              </a-col>
            </a-row>
          </a-tab-pane>
          </a-tabs>
        </div>
        <a-empty v-else-if="!loading" description="数据源不存在" class="empty-state" />
      </a-spin>
    </div>

    <!-- ====== 选表生成 / 向量化 弹窗 ====== -->
    <a-modal
      v-model:open="tableSelectVisible"
      :title="tableSelectMode === 'schema' ? '选择要生成 Light Schema 的表' : '选择要向量化单元格的表'"
      :confirm-loading="processing"
      :width="640"
      ok-text="确认执行"
      cancel-text="取消"
      @ok="confirmTableSelection"
    >
      <a-spin :spinning="schemaLoading || tableSelectLoading">
        <a-alert
          v-if="tableSelectMode === 'schema'"
          type="info"
          show-icon
          message="只覆盖选中的表"
          description="未选中的表不会受影响。先选择 schema，再选择该 schema 下的表。"
          style="margin-bottom: 12px"
        />
        <a-select
          v-if="dbSchemas.length > 1"
          v-model:value="selectedDbSchema"
          placeholder="请选择 schema"
          style="width: 100%; margin-bottom: 12px"
          @change="onDbSchemaChange"
        >
          <a-select-option v-for="s in dbSchemas" :key="s" :value="s">{{ s }}</a-select-option>
        </a-select>
        <a-input
          v-model:value="tableSelectSearch"
          placeholder="搜索表名…"
          allow-clear
          style="margin-bottom: 12px"
        >
          <template #prefix><SearchOutlined /></template>
        </a-input>
        <div class="table-select-toolbar">
          <a-checkbox
            :checked="allSelectedInFilter"
            :indeterminate="indeterminateInFilter"
            @change="toggleSelectAllFiltered"
          >
            全选当前列表（{{ filteredAllTables.length }}）
          </a-checkbox>
          <span class="selected-count">已选 {{ selectedTables.length }} / {{ allTables.length }}</span>
        </div>
        <div class="table-select-list">
          <a-checkbox-group v-model:value="selectedTables" style="width: 100%">
            <div
              v-for="t in filteredAllTables"
              :key="t"
              class="table-select-row"
            >
              <a-checkbox :value="qualifyTable(t)">
                <span class="table-select-name">{{ t }}</span>
                <a-tag
                  v-if="activeGeneratedSet.has(qualifyTable(t))"
                  color="green"
                  size="small"
                  class="generated-tag-inline"
                >{{ tableSelectMode === 'cells' ? '已向量化' : '已生成' }}</a-tag>
              </a-checkbox>
            </div>
            <a-empty v-if="filteredAllTables.length === 0" description="未匹配到表" />
          </a-checkbox-group>
        </div>
      </a-spin>
    </a-modal>
  </div>
</template>

<style scoped>
/* ============================================
   Full Page Layout - Flex Column Structure
   ============================================ */
.datasource-detail-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  overflow: hidden; /* 防止整体页面滚动 */
}

/* ============================================
   Header Banner - Fixed at Top
   ============================================ */
.header-banner {  
  flex-shrink: 0; /* 不压缩 */
  background: #fff;
  padding: 20px 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
  border-bottom: 1px solid #eef2f6;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.back-btn {
  font-size: 18px;
  height: 40px;
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50% !important;
  transition: all 0.3s;
}

.back-btn:hover {
  background: #f1f5f9;
}

.breadcrumb {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 4px;
}

.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon {
  color: #3b82f6;
}

.status-tag {
  font-size: 12px;
  font-weight: normal;
  border-radius: 20px;
  padding: 0 10px;
}

/* ============================================
   Content Wrapper - Contains Spin and Content
   ============================================ */
.content-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-wrapper :deep(.ant-spin-nested-loading) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.content-wrapper :deep(.ant-spin-container) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.empty-state {
  margin: auto;
  padding: 100px 0;
}

/* ============================================
   Content Body - Flexible & Scrollable
   ============================================ */
.content-body {
  flex: 1;
  min-height: 0; /* 关键：让 flex 子元素能收缩 */
  display: flex;
  flex-direction: column;
  padding: 0 24px 24px;
  overflow: hidden;
}

/* Tabs Container */
.custom-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.custom-tabs :deep(.ant-tabs-nav) {
  flex-shrink: 0;
  margin-bottom: 16px;
}

.custom-tabs :deep(.ant-tabs-nav::before) {
  border-bottom: none;
}

.custom-tabs :deep(.ant-tabs-content-holder) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.custom-tabs :deep(.ant-tabs-content) {
  height: 100%;
}

.custom-tabs :deep(.ant-tabs-tabpane) {
  height: 100%;
  overflow: hidden;
}

/* ============================================
   Schema Layout - Two Column Grid
   ============================================ */
.schema-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
  height: 100%;
  overflow: hidden;
  border: 1px solid #eef2f6;
}

/* Sidebar - Table List */
.schema-sidebar {
  border-right: 1px solid #eef2f6;
  background: #fcfdfe;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.sidebar-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid #eef2f6;
}

.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-weight: 600;
  font-size: 14px;
  color: #1e293b;
}

.table-list {
  flex: 1 1 0; /* 关键：明确设置 flex-basis 为 0 */
  min-height: 0;
  max-height: 100%; /* 确保不超过父容器 */
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch; /* iOS 平滑滚动 */
}

.table-item {
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.table-item:hover {
  background: #f1f5f9;
}

.table-item.active {
  background: #eff6ff;
  border-left-color: #3b82f6;
}

.table-name {
  font-weight: 600;
  color: #1e293b;
  font-size: 13px;
  margin-bottom: 2px;
  word-break: break-all;
}

.table-desc {
  font-size: 11px;
  color: #64748b;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

/* Main Content Area */
.schema-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #fff;
}

.markdown-preview-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.preview-header {
  flex-shrink: 0;
  padding: 16px 24px;
  border-bottom: 1px solid #f1f5f9;
  font-weight: 600;
  color: #1e293b;
  display: flex;
  align-items: center;
  font-size: 16px;
  background: #fafbfc;
}

.markdown-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
}

.empty-schema-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #64748b;
}

.big-icon {
  font-size: 64px;
  color: #cbd5e1;
  margin-bottom: 24px;
}

.state-content h3 {
  font-size: 20px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 8px;
}

.state-content p {
  max-width: 400px;
  margin: 0 auto 24px;
}

/* ============================================
   Overview Tab - Scrollable Content
   ============================================ */
.custom-tabs :deep(.ant-tabs-tabpane[data-node-key="overview"]) {
  overflow-y: auto;
  padding-right: 8px;
}

/* Info Cards */
.glossy {
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
}

/* Control Items */
.control-item {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding: 12px;
  border-radius: 10px;
  transition: background 0.2s;
}

.control-item:hover {
  background: #f8fafc;
}

.control-icon {
  width: 44px;
  height: 44px;
  background: #eff6ff;
  color: #3b82f6;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.control-text {
  flex: 1;
  min-width: 0;
}

.control-text h4 {
  margin: 0 0 2px 0;
  font-weight: 600;
}

.control-text p {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

/* ============================================
   Markdown Content Styling
   ============================================ */
.markdown-body :deep(h2) {
  font-size: 1.4em;
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.3em;
  margin-top: 0;
}

.markdown-body :deep(h3) {
  font-size: 1.1em;
  margin-top: 20px;
  color: #475569;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.markdown-body :deep(th), .markdown-body :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 8px 12px;
  text-align: left;
}

.markdown-body :deep(th) {
  background-color: #f8fafc;
  font-weight: 600;
  color: #475569;
}

.markdown-body :deep(tr:nth-child(2n)) {
  background-color: #fafbfc;
}

.markdown-body :deep(tr:hover) {
  background-color: #f1f5f9;
}

/* ============================================
   Custom Scrollbar
   ============================================ */
.table-list::-webkit-scrollbar, 
.markdown-body::-webkit-scrollbar,
.custom-tabs :deep(.ant-tabs-tabpane)::-webkit-scrollbar {
  width: 6px;
}

.table-list::-webkit-scrollbar-thumb,
.markdown-body::-webkit-scrollbar-thumb,
.custom-tabs :deep(.ant-tabs-tabpane)::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 10px;
}

.table-list::-webkit-scrollbar-thumb:hover,
.markdown-body::-webkit-scrollbar-thumb:hover,
.custom-tabs :deep(.ant-tabs-tabpane)::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.table-list::-webkit-scrollbar-track,
.markdown-body::-webkit-scrollbar-track,
.custom-tabs :deep(.ant-tabs-tabpane)::-webkit-scrollbar-track {
  background: transparent;
}

/* ============================================
   Generated tag + Table select modal
   ============================================ */
.generated-tag {
  margin-left: 6px;
  font-size: 11px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 8px;
}

.table-select-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 8px;
  border-bottom: 1px dashed #e5e7eb;
  margin-bottom: 8px;
}

.selected-count {
  font-size: 12px;
  color: #64748b;
}

.table-select-list {
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}

.table-select-row {
  padding: 6px 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
}

.table-select-row:hover {
  background: #f8fafc;
}

.table-select-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: #1e293b;
}

.generated-tag-inline {
  margin-left: 8px;
  font-size: 11px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 8px;
}
</style>
