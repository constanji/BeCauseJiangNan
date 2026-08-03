<script setup>
import { ref, onMounted, computed } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  SearchOutlined,
  PlusOutlined,
  DeleteOutlined,
  ClearOutlined,
  FileTextOutlined,
  SwapOutlined,
  CodeOutlined,
  UploadOutlined,
  InboxOutlined,
  AppstoreOutlined,
  ApartmentOutlined,
  ReloadOutlined,
  DatabaseOutlined
} from '@ant-design/icons-vue'
import { getProjects } from '@/api/project'
import {
  listSqlPairs, retrieveSqlPairs, addSqlPair, removeSqlPair, removeAllSqlPairs,
  listSynonyms, retrieveSynonyms, addSynonym, removeSynonym, removeAllSynonyms,
  listDocs, retrieveDocs, addDoc, removeDoc, removeAllDocs, uploadDocFile
} from '@/api/contentStore'
import {
  listIndexEntries, upsertIndexEntry, uploadIndexEntryFile,
  importKpiInfo, removeIndexEntry, removeAllIndexEntries,
  listDatasourceTables, listDatasourceSchemas, getTableColumns, importFromTable
} from '@/api/indexEntry'
import { getDatasources } from '@/api/datasource'
import {
  getOrgNodes, removeAllOrgNodes,
  importOrgNodesFromTable, importOrgNodesFromExcel, listOrgDataTimes,
  getOrgActiveDataDt, activateOrgDataDt,
  updateOrgNodeBrchLv, addOrgNode, updateOrgNode, deleteOrgNode
} from '@/api/org'

// 项目选择
const projects = ref([])
const selectedProjectId = ref('')
const loading = ref(false)

// Tab 控制
const activeTab = ref('sql-pairs')

// SQL Pairs 数据
const sqlPairs = ref([])
const sqlSearchQuery = ref('')
const sqlModalVisible = ref(false)
const sqlForm = ref({ question: '', sql: '' })

// Synonyms 数据
const synonyms = ref([])
const synSearchQuery = ref('')
const synModalVisible = ref(false)
const synForm = ref({ word: '', synonyms: '' })

// Docs 数据
const docs = ref([])
const docSearchQuery = ref('')
const docModalVisible = ref(false)
const docForm = ref({ content: '' })
const uploadModalVisible = ref(false)
const uploading = ref(false)

// Index Entries 数据(指标库)
const indexEntries = ref([])
const indexSearchQuery = ref('')
const indexModalVisible = ref(false)
const indexForm = ref({ indexNumber: '', standardName: '', aliases: '', source: undefined, frequency: '' })
const indexEditingId = ref(null)            // 非空时表示"编辑模式"(本质还是按 indexNumber upsert)
const indexUploadModalVisible = ref(false)
const indexUploading = ref(false)
const indexUploadResult = ref(null)          // { upserted, skippedRows, errors }

// kpi_info 数据源导入(从数据源表)
const indexTableImportModalVisible = ref(false)
const indexTableImportStep = ref('datasource')  // datasource → table → result
const tableImportDatasources = ref([])
const tableImportSelectedDs = ref('')
const tableImportSchemas = ref([])
const tableImportSelectedSchema = ref('')
const tableImportTables = ref([])
const tableImportSelectedTable = ref('')
const tableImportLoading = ref(false)
const tableImportColumns = ref(null)     // { tableName, columns, valid, message }
const tableImportResult = ref(null)      // { upserted, totalEntries }

// 机构信息 — 从数据源表导入
const orgTableImportModalVisible = ref(false)
const orgTableImportStep = ref('datasource')     // datasource → table → result
const orgTableImportDatasources = ref([])
const orgTableImportSelectedDs = ref('')
const orgTableImportSchemas = ref([])
const orgTableImportSelectedSchema = ref('')
const orgTableImportTables = ref([])
const orgTableImportSelectedTable = ref('')
const orgTableImportLoading = ref(false)
const orgTableImportColumns = ref(null)          // { tableName, columns, valid, message }
const orgTableImportResult = ref(null)           // { imported, dataDt }
const orgNodesTree = ref([])                     // 机构树（嵌套，供 a-tree 预览）
const orgNodesLoading = ref(false)
const orgDataTimes = ref([])                     // 可用的 dataDt 快照列表
const orgActiveDataDt = ref('')                  // 当前激活的快照日期
const orgActiveDtIsManual = ref(false)           // 是否手动切换（false=自动最新）
const orgNodeModalVisible = ref(false)           // 手动新增/编辑机构弹窗
const orgNodeEditingCode = ref(null)             // null=新增，非空=编辑
const orgNodeForm = ref({
  orgCode: '',
  orgName: '',
  parentOrgCode: undefined,
  brchLv: undefined
})
const orgNodeFormSubmitting = ref(false)
const orgExcelUploading = ref(false)
const orgExcelUploadResult = ref(null)

// 加载项目列表
const loadProjects = async () => {
  try {
    projects.value = await getProjects()
    if (projects.value.length > 0) {
      selectedProjectId.value = projects.value[0].id
    }
  } catch (error) {
    message.error('加载项目列表失败: ' + error.message)
  }
}

// SQL Pairs 操作
const loadSqlPairs = async () => {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    sqlPairs.value = await listSqlPairs(selectedProjectId.value)
  } catch (error) {
    message.error('加载SQL示例对失败: ' + error.message)
    sqlPairs.value = []
  } finally {
    loading.value = false
  }
}

const searchSqlPairs = async () => {
  if (!selectedProjectId.value || !sqlSearchQuery.value.trim()) {
    await loadSqlPairs()
    return
  }
  loading.value = true
  try {
    sqlPairs.value = await retrieveSqlPairs(selectedProjectId.value, sqlSearchQuery.value)
    message.success(`检索到 ${sqlPairs.value.length} 个相关结果`)
  } catch (error) {
    message.error('检索失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const handleAddSqlPair = async () => {
  if (!sqlForm.value.question || !sqlForm.value.sql) {
    message.warning('请填写问题和SQL')
    return
  }
  try {
    await addSqlPair(selectedProjectId.value, {
      question: sqlForm.value.question,
      sql: sqlForm.value.sql
    })
    message.success('添加成功')
    sqlModalVisible.value = false
    sqlForm.value = { question: '', sql: '' }
    await loadSqlPairs()
  } catch (error) {
    message.error('添加失败: ' + error.message)
  }
}

const handleRemoveSqlPair = async (id) => {
  try {
    await removeSqlPair(selectedProjectId.value, id)
    message.success('删除成功')
    await loadSqlPairs()
  } catch (error) {
    message.error('删除失败: ' + error.message)
  }
}

const handleClearAllSqlPairs = () => {
  Modal.confirm({
    title: '确认清空',
    content: '确定要清空所有SQL示例对吗？此操作不可恢复！',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await removeAllSqlPairs(selectedProjectId.value)
        message.success('清空成功')
        await loadSqlPairs()
      } catch (error) {
        message.error('清空失败: ' + error.message)
      }
    }
  })
}

// Synonyms 操作
const loadSynonyms = async () => {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    synonyms.value = await listSynonyms(selectedProjectId.value)
  } catch (error) {
    message.error('加载同义词失败: ' + error.message)
    synonyms.value = []
  } finally {
    loading.value = false
  }
}

const searchSynonyms = async () => {
  if (!selectedProjectId.value || !synSearchQuery.value.trim()) {
    await loadSynonyms()
    return
  }
  loading.value = true
  try {
    synonyms.value = await retrieveSynonyms(selectedProjectId.value, synSearchQuery.value)
    message.success(`检索到 ${synonyms.value.length} 个相关结果`)
  } catch (error) {
    message.error('检索失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const handleAddSynonym = async () => {
  if (!synForm.value.word || !synForm.value.synonyms) {
    message.warning('请填写词和同义词')
    return
  }
  try {
    await addSynonym(selectedProjectId.value, {
      word: synForm.value.word,
      synonyms: synForm.value.synonyms.split(',').map(s => s.trim()).filter(s => s)
    })
    message.success('添加成功')
    synModalVisible.value = false
    synForm.value = { word: '', synonyms: '' }
    await loadSynonyms()
  } catch (error) {
    message.error('添加失败: ' + error.message)
  }
}

const handleRemoveSynonym = async (id) => {
  try {
    await removeSynonym(selectedProjectId.value, id)
    message.success('删除成功')
    await loadSynonyms()
  } catch (error) {
    message.error('删除失败: ' + error.message)
  }
}

const handleClearAllSynonyms = () => {
  Modal.confirm({
    title: '确认清空',
    content: '确定要清空所有同义词吗？此操作不可恢复！',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await removeAllSynonyms(selectedProjectId.value)
        message.success('清空成功')
        await loadSynonyms()
      } catch (error) {
        message.error('清空失败: ' + error.message)
      }
    }
  })
}

// Docs 操作
const loadDocs = async () => {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    docs.value = await listDocs(selectedProjectId.value)
  } catch (error) {
    message.error('加载业务知识失败: ' + error.message)
    docs.value = []
  } finally {
    loading.value = false
  }
}

const searchDocs = async () => {
  if (!selectedProjectId.value || !docSearchQuery.value.trim()) {
    await loadDocs()
    return
  }
  loading.value = true
  try {
    docs.value = await retrieveDocs(selectedProjectId.value, docSearchQuery.value)
    message.success(`检索到 ${docs.value.length} 个相关结果`)
  } catch (error) {
    message.error('检索失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const handleAddDoc = async () => {
  if (!docForm.value.content) {
    message.warning('请填写知识内容')
    return
  }
  try {
    await addDoc(selectedProjectId.value, docForm.value.content)
    message.success('添加成功')
    docModalVisible.value = false
    docForm.value = { content: '' }
    await loadDocs()
  } catch (error) {
    message.error('添加失败: ' + error.message)
  }
}

const handleRemoveDoc = async (id) => {
  try {
    await removeDoc(selectedProjectId.value, id)
    message.success('删除成功')
    await loadDocs()
  } catch (error) {
    message.error('删除失败: ' + error.message)
  }
}

const handleClearAllDocs = () => {
  Modal.confirm({
    title: '确认清空',
    content: '确定要清空所有业务知识吗？此操作不可恢复！',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await removeAllDocs(selectedProjectId.value)
        message.success('清空成功')
        await loadDocs()
      } catch (error) {
        message.error('清空失败: ' + error.message)
      }
    }
  })
}

// 文件上传处理
const handleFileUpload = async (file) => {
  uploading.value = true
  try {
    const result = await uploadDocFile(selectedProjectId.value, file)
    message.success(`文件 "${result.filename}" 上传成功，解析了 ${result.contentLength} 个字符`)
    uploadModalVisible.value = false
    await loadDocs()
  } catch (error) {
    message.error('上传失败: ' + error.message)
  } finally {
    uploading.value = false
  }
  return false // 阻止默认上传行为
}

// 项目切换时加载数据
const handleProjectChange = async () => {
  if (activeTab.value === 'sql-pairs') {
    await loadSqlPairs()
  } else if (activeTab.value === 'synonyms') {
    await loadSynonyms()
  } else if (activeTab.value === 'index-entries') {
    await loadIndexEntries()
  } else if (activeTab.value === 'org-staff') {
    await loadOrgNodes()
    await loadOrgDataTimes()
  } else {
    await loadDocs()
  }
}

// ============ Index Entries (指标库) ============

const loadIndexEntries = async () => {
  if (!selectedProjectId.value) return
  loading.value = true
  try {
    indexEntries.value = await listIndexEntries(selectedProjectId.value)
  } catch (error) {
    message.error('加载指标库失败: ' + error.message)
    indexEntries.value = []
  } finally {
    loading.value = false
  }
}

const searchIndexEntries = async () => {
  // 后端 list 接口本身不带模糊检索,前端本地子串过滤(对小规模指标库够用)
  if (!selectedProjectId.value) return
  await loadIndexEntries()
  const q = (indexSearchQuery.value || '').trim()
  if (q) {
    indexEntries.value = indexEntries.value.filter(e =>
      (e.indexNumber || '').includes(q) ||
      (e.standardName || '').includes(q) ||
      (e.aliases || []).some(a => (a || '').includes(q))
    )
    message.success(`本地过滤到 ${indexEntries.value.length} 个结果`)
  }
}

const openAddIndexEntry = () => {
  indexEditingId.value = null
  indexForm.value = { indexNumber: '', standardName: '', aliases: '', source: undefined, frequency: '' }
  indexModalVisible.value = true
}

const openEditIndexEntry = (record) => {
  indexEditingId.value = record.id
  indexForm.value = {
    indexNumber: record.indexNumber,
    standardName: record.standardName,
    aliases: (record.aliases || []).join('/'),
    source: record.source,
    frequency: record.frequency || ''
  }
  indexModalVisible.value = true
}

const handleSaveIndexEntry = async () => {
  const { indexNumber, standardName } = indexForm.value
  if (!indexNumber || !indexNumber.trim()) {
    message.warning('请填写指标编码')
    return
  }
  if (!standardName || !standardName.trim()) {
    message.warning('请填写指标名称')
    return
  }
  const aliases = (indexForm.value.aliases || '')
    .split(/[/,;、，；]/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s !== standardName.trim())
  try {
    await upsertIndexEntry(selectedProjectId.value, {
      indexNumber: indexNumber.trim(),
      standardName: standardName.trim(),
      aliases,
      source: indexForm.value.source,
      frequency: (indexForm.value.frequency || '').trim() || null
    })
    message.success(indexEditingId.value ? '更新成功' : '添加成功')
    indexModalVisible.value = false
    await loadIndexEntries()
  } catch (error) {
    message.error((indexEditingId.value ? '更新' : '添加') + '失败: ' + error.message)
  }
}

const handleRemoveIndexEntry = async (id) => {
  try {
    await removeIndexEntry(id)
    message.success('删除成功')
    await loadIndexEntries()
  } catch (error) {
    message.error('删除失败: ' + error.message)
  }
}

const handleClearAllIndexEntries = () => {
  Modal.confirm({
    title: '确认清空',
    content: '确定要清空该项目下所有指标吗?此操作不可恢复!',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await removeAllIndexEntries(selectedProjectId.value)
        message.success('清空成功')
        await loadIndexEntries()
      } catch (error) {
        message.error('清空失败: ' + error.message)
      }
    }
  })
}

// Ant Design Upload 的 customRequest;返回 false 阻止默认 ajax
const handleUploadIndexEntryFile = async ({ file }) => {
  if (!selectedProjectId.value) {
    message.warning('请先选择项目')
    return false
  }
  indexUploading.value = true
  indexUploadResult.value = null
  try {
    const result = await uploadIndexEntryFile(selectedProjectId.value, file)
    indexUploadResult.value = result
    const errCount = (result.errors || []).length
    if (errCount === 0) {
      message.success(`导入成功:写入 ${result.upserted} 条,跳过空行 ${result.skippedRows} 行`)
    } else {
      message.warning(`导入完成:写入 ${result.upserted} 条,跳过 ${result.skippedRows} 行,${errCount} 行错误(详见下方)`)
    }
    await loadIndexEntries()
  } catch (error) {
    message.error('上传失败: ' + error.message)
  } finally {
    indexUploading.value = false
  }
  return false
}

// 从数据源表导入 kpi_info
const openTableImportModal = async () => {
  if (!selectedProjectId.value) {
    message.warning('请先选择项目')
    return
  }
  indexTableImportModalVisible.value = true
  indexTableImportStep.value = 'datasource'
  tableImportSelectedDs.value = ''
  tableImportTables.value = []
  tableImportSelectedTable.value = ''
  tableImportColumns.value = null
  tableImportResult.value = null
  try {
    tableImportDatasources.value = await getDatasources(selectedProjectId.value)
  } catch (e) {
    message.error('加载数据源列表失败: ' + e.message)
  }
}

const onTableImportDsChange = async (dsId) => {
  tableImportSelectedDs.value = dsId
  tableImportSelectedSchema.value = ''
  tableImportSelectedTable.value = ''
  tableImportTables.value = []
  tableImportColumns.value = null
  if (!dsId) return
  tableImportLoading.value = true
  try {
    const schemas = await listDatasourceSchemas(dsId)
    tableImportSchemas.value = schemas || []
    if (tableImportSchemas.value.length === 1) {
      tableImportSelectedSchema.value = tableImportSchemas.value[0]
      await loadIndexImportTables(dsId, tableImportSelectedSchema.value)
    } else if (tableImportSchemas.value.length === 0) {
      await loadIndexImportTables(dsId, null)
    }
  } catch (e) {
    message.error('加载 schema 列表失败: ' + e.message)
  } finally {
    tableImportLoading.value = false
  }
}

const onTableImportSchemaChange = async (schema) => {
  tableImportSelectedSchema.value = schema
  tableImportSelectedTable.value = ''
  tableImportColumns.value = null
  tableImportTables.value = []
  if (!schema) return
  await loadIndexImportTables(tableImportSelectedDs.value, schema)
}

const loadIndexImportTables = async (dsId, schema) => {
  if (!dsId) return
  tableImportLoading.value = true
  try {
    tableImportTables.value = await listDatasourceTables(dsId, schema)
  } catch (e) {
    message.error('加载表列表失败: ' + e.message)
    tableImportTables.value = []
  } finally {
    tableImportLoading.value = false
  }
}

const qualifiedIndexTable = computed(() => {
  if (!tableImportSelectedTable.value) return ''
  if (tableImportSchemas.value.length <= 1) return tableImportSelectedTable.value
  return `${tableImportSelectedSchema.value}.${tableImportSelectedTable.value}`
})

const onTableImportTableChange = async (tableName) => {
  tableImportSelectedTable.value = tableName
  tableImportColumns.value = null
  if (!tableName || !tableImportSelectedDs.value) return
  tableImportLoading.value = true
  try {
    tableImportColumns.value = await getTableColumns(tableImportSelectedDs.value, qualifiedIndexTable.value)
  } catch (e) {
    message.error('校验表结构失败: ' + e.message)
  } finally {
    tableImportLoading.value = false
  }
}

const handleImportFromTable = async () => {
  if (!tableImportSelectedDs.value || !tableImportSelectedTable.value) {
    message.warning('请选择数据源和表')
    return
  }
  if (!tableImportColumns.value?.valid) {
    message.warning('表结构校验未通过，无法导入')
    return
  }
  tableImportLoading.value = true
  try {
    tableImportResult.value = await importFromTable(
      selectedProjectId.value,
      tableImportSelectedDs.value,
      qualifiedIndexTable.value
    )
    indexTableImportStep.value = 'result'
    message.success(`导入成功:写入 ${tableImportResult.value.upserted} 条，展开 ${tableImportResult.value.totalEntries} 条`)
    await loadIndexEntries()
  } catch (e) {
    message.error('导入失败: ' + e.message)
  } finally {
    tableImportLoading.value = false
  }
}

// ============ Org Management (机构信息 — 数据源表驱动) ============

const handleClearOrgNodes = () => {
  Modal.confirm({
    title: '确认清空',
    content: '将清空该项目下全部机构信息,清空后所有指标问数权限失效。',
    okType: 'danger',
    async onOk() {
      try {
        await removeAllOrgNodes(selectedProjectId.value)
        message.success('清空成功')
        await loadOrgNodes()
        await loadOrgDataTimes()
      } catch (error) {
        message.error('清空失败: ' + error.message)
      }
    }
  })
}

// ─── 机构信息 — 从数据源表导入 ──────────────────────────────────────────

const openOrgTableImportModal = async () => {
  if (!selectedProjectId.value) {
    message.warning('请先选择项目')
    return
  }
  orgTableImportModalVisible.value = true
  orgTableImportStep.value = 'datasource'
  orgTableImportSelectedDs.value = ''
  orgTableImportSchemas.value = []
  orgTableImportSelectedSchema.value = ''
  orgTableImportTables.value = []
  orgTableImportSelectedTable.value = ''
  orgTableImportColumns.value = null
  orgTableImportResult.value = null
  try {
    orgTableImportDatasources.value = await getDatasources(selectedProjectId.value)
  } catch (e) {
    message.error('加载数据源列表失败: ' + e.message)
  }
}

const onOrgTableImportDsChange = async (dsId) => {
  orgTableImportSelectedDs.value = dsId
  orgTableImportSelectedSchema.value = ''
  orgTableImportSelectedTable.value = ''
  orgTableImportTables.value = []
  orgTableImportColumns.value = null
  if (!dsId) return
  orgTableImportLoading.value = true
  try {
    const schemas = await listDatasourceSchemas(dsId)
    orgTableImportSchemas.value = schemas || []
    if (orgTableImportSchemas.value.length === 1) {
      orgTableImportSelectedSchema.value = orgTableImportSchemas.value[0]
      await loadOrgImportTables(dsId, orgTableImportSelectedSchema.value)
    } else if (orgTableImportSchemas.value.length === 0) {
      await loadOrgImportTables(dsId, null)
    }
  } catch (e) {
    message.error('加载 schema 列表失败: ' + e.message)
  } finally {
    orgTableImportLoading.value = false
  }
}

const onOrgTableImportSchemaChange = async (schema) => {
  orgTableImportSelectedSchema.value = schema
  orgTableImportSelectedTable.value = ''
  orgTableImportColumns.value = null
  orgTableImportTables.value = []
  if (!schema) return
  await loadOrgImportTables(orgTableImportSelectedDs.value, schema)
}

const loadOrgImportTables = async (dsId, schema) => {
  if (!dsId) return
  orgTableImportLoading.value = true
  try {
    orgTableImportTables.value = await listDatasourceTables(dsId, schema)
  } catch (e) {
    message.error('加载表列表失败: ' + e.message)
    orgTableImportTables.value = []
  } finally {
    orgTableImportLoading.value = false
  }
}

const qualifiedOrgTable = computed(() => {
  if (!orgTableImportSelectedTable.value) return ''
  if (orgTableImportSchemas.value.length <= 1) return orgTableImportSelectedTable.value
  return `${orgTableImportSelectedSchema.value}.${orgTableImportSelectedTable.value}`
})

const onOrgTableImportTableChange = async (tableName) => {
  orgTableImportSelectedTable.value = tableName
  orgTableImportColumns.value = null
  if (!tableName || !orgTableImportSelectedDs.value) return
  orgTableImportLoading.value = true
  try {
    orgTableImportColumns.value = await getTableColumns(orgTableImportSelectedDs.value, qualifiedOrgTable.value)
    // 覆写 valid 判定：机构表必填列不同于 kpi_info
    const colNames = (orgTableImportColumns.value.columns || []).map(c => c.name.toLowerCase())
    const required = ['data_dt', 'brchno', 'brchna', 'brchup', 'brchlv']
    const missing = required.filter(r => !colNames.includes(r))
    orgTableImportColumns.value.valid = missing.length === 0
    if (!orgTableImportColumns.value.valid) {
      orgTableImportColumns.value.message = `表结构不符合 c_par_brch_level 规范，缺少必填列: ${missing.join(', ')}`
    } else {
      orgTableImportColumns.value.message = `表 ${tableName} 包含 ${orgTableImportColumns.value.columns.length} 列，符合 c_par_brch_level 规范`
    }
  } catch (e) {
    message.error('校验表结构失败: ' + e.message)
  } finally {
    orgTableImportLoading.value = false
  }
}

const handleOrgImportFromTable = async () => {
  if (!orgTableImportSelectedDs.value || !orgTableImportSelectedTable.value) {
    message.warning('请选择数据源和表')
    return
  }
  if (!orgTableImportColumns.value?.valid) {
    message.warning('表结构校验未通过，无法导入')
    return
  }
  orgTableImportLoading.value = true
  try {
    orgTableImportResult.value = await importOrgNodesFromTable(
      selectedProjectId.value,
      orgTableImportSelectedDs.value,
      qualifiedOrgTable.value
    )
    orgTableImportStep.value = 'result'
    message.success(`导入成功: ${orgTableImportResult.value.imported} 个机构节点, dataDt=${orgTableImportResult.value.dataDt}`)
    await loadOrgNodes()
    await loadOrgDataTimes()
  } catch (e) {
    message.error('导入失败: ' + e.message)
  } finally {
    orgTableImportLoading.value = false
  }
}

const handleOrgImportFromExcel = async ({ file }) => {
  if (!selectedProjectId.value) {
    message.warning('请先选择项目')
    return false
  }
  orgExcelUploading.value = true
  orgExcelUploadResult.value = null
  try {
    const result = await importOrgNodesFromExcel(selectedProjectId.value, file)
    orgExcelUploadResult.value = result
    message.success(`Excel 导入成功: ${result.imported} 个机构节点, dataDt=${result.dataDt}`)
    await loadOrgNodes()
    await loadOrgDataTimes()
  } catch (e) {
    message.error('Excel 导入失败: ' + e.message)
  } finally {
    orgExcelUploading.value = false
  }
  return false
}

const loadOrgDataTimes = async () => {
  if (!selectedProjectId.value) return
  try {
    orgDataTimes.value = await listOrgDataTimes(selectedProjectId.value)
    const active = await getOrgActiveDataDt(selectedProjectId.value)
    orgActiveDataDt.value = active.activeDataDt || ''
    orgActiveDtIsManual.value = active.isManual || false
  } catch (e) {
    orgDataTimes.value = []
    orgActiveDataDt.value = ''
    orgActiveDtIsManual.value = false
  }
}

const BRCH_LV_OPTIONS = [
  { value: 1, label: '1 全行（查所有）' },
  { value: 2, label: '2 本级+下级' },
  { value: 3, label: '3 管理行本级+下级' },
  { value: 4, label: '4 仅本级' }
]

const toTreeNode = (node) => ({
  key: node.orgCode,
  orgCode: node.orgCode,
  orgName: node.orgName || '',
  brchLv: node.brchLv ?? null,
  dataScope: node.dataScope || 'SELF',
  managementOrg: node.managementOrg,
  children: (node.children || []).map(toTreeNode)
})

const handleUpdateBrchLv = async (node, newLv) => {
  if (!selectedProjectId.value) return
  if (node.brchLv === newLv) return
  try {
    await updateOrgNodeBrchLv(selectedProjectId.value, node.orgCode, newLv)
    message.success(`${node.orgCode} 数据权限已更新为级别 ${newLv}`)
    await loadOrgNodes()
  } catch (e) {
    message.error(`修改失败: ${e.message || e}`)
  }
}

// ─── 手动机构节点维护 ─────────────────────────────────────────────────

const orgNodeParentOptions = computed(() => {
  // 扁平化当前树，生成 parentOrgCode 下拉选项
  const walk = (nodes, result) => {
    for (const n of nodes || []) {
      result.push({ value: n.orgCode, label: `${n.orgCode} ${n.orgName}` })
      walk(n.children, result)
    }
    return result
  }
  return walk(orgNodesTree.value, [])
})

const orgNodeFormRules = {
  orgCode: [{ required: true, message: '请输入机构编码', trigger: 'blur' }],
  orgName: [{ required: true, message: '请输入机构名称', trigger: 'blur' }],
  brchLv: [{ required: true, message: '请选择数据权限级别', trigger: 'change' }]
}

const resetOrgNodeForm = () => {
  orgNodeForm.value = {
    orgCode: '',
    orgName: '',
    parentOrgCode: undefined,
    brchLv: undefined
  }
  orgNodeEditingCode.value = null
}

const openAddOrgNode = (parentOrgCode = undefined) => {
  resetOrgNodeForm()
  orgNodeForm.value.parentOrgCode = parentOrgCode
  orgNodeForm.value.brchLv = 4
  orgNodeModalVisible.value = true
}

const openEditOrgNode = (node) => {
  resetOrgNodeForm()
  orgNodeEditingCode.value = node.orgCode
  orgNodeForm.value = {
    orgCode: node.orgCode,
    orgName: node.orgName,
    parentOrgCode: node.parentOrgCode || undefined,
    brchLv: node.brchLv ?? undefined
  }
  orgNodeModalVisible.value = true
}

const handleSaveOrgNode = async () => {
  if (!selectedProjectId.value) {
    message.warning('请先选择项目')
    return
  }
  const { orgCode, orgName, parentOrgCode, brchLv } = orgNodeForm.value
  if (!orgCode?.trim() || !orgName?.trim() || brchLv == null) {
    message.warning('请填写完整机构信息')
    return
  }
  orgNodeFormSubmitting.value = true
  try {
    const payload = {
      orgName: orgName.trim(),
      parentOrgCode: parentOrgCode || '',
      brchLv
    }
    if (orgNodeEditingCode.value) {
      await updateOrgNode(selectedProjectId.value, orgNodeEditingCode.value, payload)
      message.success('机构信息更新成功')
    } else {
      await addOrgNode(selectedProjectId.value, { ...payload, orgCode: orgCode.trim() })
      message.success('机构新增成功')
    }
    orgNodeModalVisible.value = false
    resetOrgNodeForm()
    await loadOrgNodes()
    await loadOrgDataTimes()
  } catch (e) {
    message.error((orgNodeEditingCode.value ? '更新' : '新增') + '失败: ' + e.message)
  } finally {
    orgNodeFormSubmitting.value = false
  }
}

const handleDeleteOrgNode = async (node) => {
  if (!selectedProjectId.value) return
  const hasChildren = (node.children || []).length > 0
  Modal.confirm({
    title: `确认删除机构 ${node.orgCode}？`,
    content: hasChildren
      ? '该机构存在子机构，删除将级联删除整个子树。此操作不可恢复！'
      : '此操作不可恢复！',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await deleteOrgNode(selectedProjectId.value, node.orgCode, hasChildren)
        message.success('删除成功')
        await loadOrgNodes()
        await loadOrgDataTimes()
      } catch (e) {
        message.error('删除失败: ' + e.message)
      }
    }
  })
}

const loadOrgNodes = async () => {
  if (!selectedProjectId.value) {
    orgNodesTree.value = []
    return
  }
  orgNodesLoading.value = true
  try {
    const tree = await getOrgNodes(selectedProjectId.value)
    orgNodesTree.value = (tree || []).map(toTreeNode)
  } catch (e) {
    orgNodesTree.value = []
  } finally {
    orgNodesLoading.value = false
  }
}

const handleActivateOrgDataDt = async (dataDt) => {
  // dataDt 为 null 或空字符串表示恢复"自动最新"
  if (!selectedProjectId.value) return
  try {
    const result = await activateOrgDataDt(selectedProjectId.value, dataDt || null)
    message.success(result.message || '快照切换成功')
    orgActiveDataDt.value = result.activeDataDt || ''
    orgActiveDtIsManual.value = result.isManual || false
    await loadOrgNodes()
  } catch (e) {
    message.error('切换快照失败: ' + e.message)
  }
}

// Tab 切换时加载数据
const handleTabChange = async (key) => {
  activeTab.value = key
  await handleProjectChange()
}

// SQL Pairs 表格列
const sqlColumns = [
  { title: '问题', dataIndex: 'question', key: 'question', ellipsis: true },
  { title: 'SQL', dataIndex: 'sql', key: 'sql', ellipsis: true },
  { title: '操作', key: 'action', width: 80 }
]

// Synonyms 表格列
const synColumns = [
  { title: '词', dataIndex: 'word', key: 'word', width: 150 },
  { title: '同义词', dataIndex: 'synonyms', key: 'synonyms' },
  { title: '操作', key: 'action', width: 80 }
]

// Docs 表格列 - 由于 docs 是字符串列表，需要特殊处理
const docColumns = [
  { title: '序号', key: 'index', width: 80 },
  { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
  { title: '操作', key: 'action', width: 80 }
]

// 将 docs 数组转换为表格数据
const docsTableData = computed(() => {
  return docs.value.map((item, index) => ({
    key: item.id,
    id: item.id,
    index: index + 1,
    content: item.content
  }))
})

// Index Entries 表格列
const indexColumns = [
  { title: '指标编码', dataIndex: 'indexNumber', key: 'indexNumber', width: 130 },
  { title: '指标名称', dataIndex: 'standardName', key: 'standardName', width: 200 },
  { title: '别名', dataIndex: 'aliases', key: 'aliases' },
  { title: '来源', dataIndex: 'source', key: 'source', width: 90 },
  { title: '频度', dataIndex: 'frequency', key: 'frequency', width: 80 },
  { title: '操作', key: 'action', width: 130 }
]

// 来源(1=人行,2=银监,3=省联社)的显示映射
const sourceLabel = (n) => {
  if (n == null) return '-'
  return { 1: '人行', 2: '银监', 3: '省联社' }[n] || String(n)
}

onMounted(async () => {
  await loadProjects()
  if (selectedProjectId.value) {
    await loadSqlPairs()
  }
})
</script>

<template>
  <div class="content-store-manager">
    <div class="page-header">
      <h2><FileTextOutlined /> 内容管理</h2>
      <a-select
        v-model:value="selectedProjectId"
        style="width: 240px"
        placeholder="选择项目"
        :options="projects.map(p => ({ label: p.name, value: p.id }))"
        @change="handleProjectChange"
      />
    </div>

    <a-alert
      v-if="!selectedProjectId"
      message="请先选择一个项目"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
    />

    <a-tabs v-model:activeKey="activeTab" @change="handleTabChange">
      <!-- SQL Pairs Tab -->
      <a-tab-pane key="sql-pairs">
        <template #tab>
          <CodeOutlined /> SQL 示例对
        </template>
        
        <div class="tab-actions">
          <a-space>
            <a-input-search
              v-model:value="sqlSearchQuery"
              placeholder="输入问题检索相关SQL..."
              enter-button="检索"
              style="width: 350px"
              @search="searchSqlPairs"
            />
          </a-space>
          <a-space>
            <a-button type="primary" @click="sqlModalVisible = true" :disabled="!selectedProjectId">
              <PlusOutlined /> 添加
            </a-button>
            <a-button danger @click="handleClearAllSqlPairs" :disabled="!selectedProjectId || sqlPairs.length === 0">
              <ClearOutlined /> 清空全部
            </a-button>
          </a-space>
        </div>

        <a-table
          :columns="sqlColumns"
          :data-source="sqlPairs.map((item) => ({ ...item, key: item.id }))"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'sql'">
              <code class="sql-code">{{ record.sql }}</code>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-popconfirm
                title="确定删除此项吗？"
                @confirm="handleRemoveSqlPair(record.id)"
              >
                <a-button type="link" danger size="small">
                  <DeleteOutlined />
                </a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Synonyms Tab -->
      <a-tab-pane key="synonyms">
        <template #tab>
          <SwapOutlined /> 同义词
        </template>
        
        <div class="tab-actions">
          <a-space>
            <a-input-search
              v-model:value="synSearchQuery"
              placeholder="输入词语检索相关同义词..."
              enter-button="检索"
              style="width: 350px"
              @search="searchSynonyms"
            />
          </a-space>
          <a-space>
            <a-button type="primary" @click="synModalVisible = true" :disabled="!selectedProjectId">
              <PlusOutlined /> 添加
            </a-button>
            <a-button danger @click="handleClearAllSynonyms" :disabled="!selectedProjectId || synonyms.length === 0">
              <ClearOutlined /> 清空全部
            </a-button>
          </a-space>
        </div>

        <a-table
          :columns="synColumns"
          :data-source="synonyms.map((item) => ({ ...item, key: item.id }))"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'synonyms'">
              <a-tag v-for="syn in record.synonyms" :key="syn" color="blue">{{ syn }}</a-tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-popconfirm
                title="确定删除此项吗？"
                @confirm="handleRemoveSynonym(record.id)"
              >
                <a-button type="link" danger size="small">
                  <DeleteOutlined />
                </a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Docs Tab -->
      <a-tab-pane key="docs">
        <template #tab>
          <FileTextOutlined /> 业务知识
        </template>
        
        <div class="tab-actions">
          <a-space>
            <a-input-search
              v-model:value="docSearchQuery"
              placeholder="输入关键词检索相关知识..."
              enter-button="检索"
              style="width: 350px"
              @search="searchDocs"
            />
          </a-space>
          <a-space>
            <a-button type="primary" @click="docModalVisible = true" :disabled="!selectedProjectId">
              <PlusOutlined /> 添加文本
            </a-button>
            <a-button @click="uploadModalVisible = true" :disabled="!selectedProjectId">
              <UploadOutlined /> 上传文件
            </a-button>
            <a-button danger @click="handleClearAllDocs" :disabled="!selectedProjectId || docs.length === 0">
              <ClearOutlined /> 清空全部
            </a-button>
          </a-space>
        </div>

        <a-table
          :columns="docColumns"
          :data-source="docsTableData"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'action'">
              <a-popconfirm
                title="确定删除此项吗？"
                @confirm="handleRemoveDoc(record.id)"
              >
                <a-button type="link" danger size="small">
                  <DeleteOutlined />
                </a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Index Entries Tab (指标库) -->
      <a-tab-pane key="index-entries">
        <template #tab>
          <AppstoreOutlined /> 指标库
        </template>

        <div class="tab-actions">
          <a-space>
            <a-input-search
              v-model:value="indexSearchQuery"
              placeholder="按编码 / 名称 / 别名过滤..."
              enter-button="检索"
              style="width: 350px"
              @search="searchIndexEntries"
              allow-clear
            />
          </a-space>
          <a-space>
            <a-button type="primary" @click="openAddIndexEntry" :disabled="!selectedProjectId">
              <PlusOutlined /> 添加
            </a-button>
            <a-button @click="indexUploadModalVisible = true" :disabled="!selectedProjectId">
              <UploadOutlined /> 上传 Excel
            </a-button>
            <a-button @click="openTableImportModal" :disabled="!selectedProjectId">
              <DatabaseOutlined /> 从数据源导入
            </a-button>
            <a-button danger @click="handleClearAllIndexEntries"
                      :disabled="!selectedProjectId || indexEntries.length === 0">
              <ClearOutlined /> 清空全部
            </a-button>
          </a-space>
        </div>

        <a-table
          :columns="indexColumns"
          :data-source="indexEntries.map((item) => ({ ...item, key: item.id }))"
          :loading="loading"
          :pagination="{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'aliases'">
              <a-tag v-for="al in (record.aliases || [])" :key="al" color="blue">{{ al }}</a-tag>
              <span v-if="!(record.aliases && record.aliases.length)" style="color:#bbb">-</span>
            </template>
            <template v-else-if="column.key === 'source'">
              <a-tag v-if="record.source != null" color="green">{{ sourceLabel(record.source) }}</a-tag>
              <span v-else style="color:#bbb">-</span>
            </template>
            <template v-else-if="column.key === 'frequency'">
              <a-tag v-if="record.frequency" color="purple">{{ record.frequency }}</a-tag>
              <span v-else style="color:#bbb">-</span>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-button type="link" size="small" @click="openEditIndexEntry(record)">编辑</a-button>
              <a-popconfirm title="确定删除此项吗?" @confirm="handleRemoveIndexEntry(record.id)">
                <a-button type="link" danger size="small"><DeleteOutlined /></a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- 机构信息 Tab（数据源表驱动） -->
      <a-tab-pane key="org-staff">
        <template #tab>
          机构信息
          <a-badge v-if="!orgActiveDataDt && orgDataTimes.length === 0" status="warning" style="margin-left:4px;" />
        </template>

        <a-card title="机构信息" size="small">
          <template #extra>
            <a-space>
              <a-button size="small" type="primary"
                        @click="openAddOrgNode()" :disabled="!selectedProjectId">
                <PlusOutlined /> 添加机构
              </a-button>
              <a-button size="small" type="primary"
                        @click="openOrgTableImportModal" :disabled="!selectedProjectId">
                <DatabaseOutlined /> 从数据源导入
              </a-button>
              <a-upload
                :disabled="!selectedProjectId || orgExcelUploading"
                :showUploadList="false"
                :beforeUpload="handleOrgImportFromExcel"
                accept=".xlsx"
              >
                <a-button size="small" :loading="orgExcelUploading" :disabled="!selectedProjectId">
                  <UploadOutlined /> 上传 Excel
                </a-button>
              </a-upload>
              <a-button danger size="small"
                        @click="handleClearOrgNodes" :disabled="!selectedProjectId">
                <DeleteOutlined /> 清空机构信息
              </a-button>
            </a-space>
          </template>

          <!-- 快照切换器 -->
          <div v-if="orgDataTimes.length > 0" style="margin-bottom: 12px;">
            <div style="font-size: 13px; color: #555; margin-bottom: 8px;">
              当前快照：<a-tag :color="orgActiveDtIsManual ? 'orange' : 'blue'">
                {{ orgActiveDtIsManual ? '📌' : '🕐' }} {{ orgActiveDataDt || '最新' }}
              </a-tag>
              <a-tooltip title="通过 c_par_brch_level 表的 data_dt 列管理快照">
                <span style="cursor:help; margin-left:4px;">ⓘ</span>
              </a-tooltip>
            </div>
            <div style="font-size: 12px; color: #999; margin-bottom: 6px;">
              数据快照切换
              <a-tooltip title="点击快照日期切换到该历史版本；切换后数据权限立即生效">
                <span style="cursor:help; margin-left:4px;">ⓘ</span>
              </a-tooltip>
            </div>
            <a-space wrap :size="[4, 4]">
              <a-tag
                v-for="dt in orgDataTimes"
                :key="dt"
                :color="dt === orgActiveDataDt && orgActiveDtIsManual ? 'orange' : dt === orgActiveDataDt ? 'blue' : 'default'"
                :style="{
                  cursor: 'pointer',
                  fontWeight: dt === orgActiveDataDt ? 'bold' : 'normal',
                  opacity: dt === orgActiveDataDt ? 1 : 0.75
                }"
                @click="handleActivateOrgDataDt(dt)"
              >
                {{ dt }}
              </a-tag>
            </a-space>
            <a-button
              v-if="orgActiveDtIsManual"
              type="link"
              size="small"
              style="margin-top: 4px; padding: 0;"
              @click="handleActivateOrgDataDt('')"
            >
              <ReloadOutlined /> 恢复自动（最新）
            </a-button>
          </div>

          <!-- 机构树预览 -->
          <a-divider v-if="orgDataTimes.length > 0 && orgNodesTree.length > 0" style="margin: 12px 0;" />
          <a-spin :spinning="orgNodesLoading">
            <a-tree
              v-if="orgNodesTree.length > 0"
              :tree-data="orgNodesTree"
              :default-expand-all="false"
              :default-expanded-keys="[orgNodesTree[0]?.key]"
              show-line
              block-node
              style="max-height: 400px; overflow: auto;"
            >
              <template #title="node">
                <span style="display: inline-flex; align-items: center; gap: 8px;">
                  <span>{{ node.orgCode }} {{ node.orgName }}</span>
                  <a-select
                    :value="node.brchLv"
                    size="small"
                    style="width: 180px;"
                    :options="BRCH_LV_OPTIONS"
                    placeholder="未设置"
                    @change="v => handleUpdateBrchLv(node, v)"
                    @click.stop
                  />
                  <a-space size="small" @click.stop>
                    <a-button type="link" size="small" @click="openAddOrgNode(node.orgCode)">
                      <PlusOutlined /> 添加子机构
                    </a-button>
                    <a-button type="link" size="small" @click="openEditOrgNode(node)">
                      编辑
                    </a-button>
                    <a-button type="link" danger size="small" @click="handleDeleteOrgNode(node)">
                      删除
                    </a-button>
                  </a-space>
                </span>
              </template>
            </a-tree>
            <a-empty v-else-if="!orgNodesLoading" description="尚未从数据源导入机构信息" />
          </a-spin>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- SQL Pair 添加弹窗 -->
    <a-modal
      v-model:open="sqlModalVisible"
      title="添加 SQL 示例对"
      @ok="handleAddSqlPair"
      :width="600"
    >
      <a-form layout="vertical">
        <a-form-item label="问题" required>
          <a-input v-model:value="sqlForm.question" placeholder="例如：本月销售额是多少？" />
        </a-form-item>
        <a-form-item label="SQL" required>
          <a-textarea v-model:value="sqlForm.sql" :rows="4" placeholder="例如：SELECT SUM(amount) FROM sales WHERE month = CURRENT_MONTH" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Synonym 添加弹窗 -->
    <a-modal
      v-model:open="synModalVisible"
      title="添加同义词"
      @ok="handleAddSynonym"
      :width="500"
    >
      <a-form layout="vertical">
        <a-form-item label="词" required>
          <a-input v-model:value="synForm.word" placeholder="例如：销售额" />
        </a-form-item>
        <a-form-item label="同义词（多个用逗号分隔）" required>
          <a-input v-model:value="synForm.synonyms" placeholder="例如：营收,营业额,销售收入" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Doc 添加弹窗 -->
    <a-modal
      v-model:open="docModalVisible"
      title="添加业务知识"
      @ok="handleAddDoc"
      :width="600"
    >
      <a-form layout="vertical">
        <a-form-item label="知识内容" required>
          <a-textarea v-model:value="docForm.content" :rows="6" placeholder="输入业务知识、术语定义或规则说明..." />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 文件上传弹窗 -->
    <a-modal
      v-model:open="uploadModalVisible"
      title="上传知识文档"
      :footer="null"
      :width="500"
    >
      <a-upload-dragger
        :disabled="uploading"
        :showUploadList="false"
        :beforeUpload="handleFileUpload"
        accept=".txt,.md,.pdf,.doc,.docx,.html,.xml,.json,.csv"
      >
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p class="ant-upload-hint">
          支持 TXT, Markdown, PDF, Word 等格式
        </p>
      </a-upload-dragger>
      <div v-if="uploading" style="text-align: center; margin-top: 16px;">
        <a-spin tip="正在解析文件..." />
      </div>
    </a-modal>

    <!-- 指标库 添加/编辑 弹窗 -->
    <a-modal
      v-model:open="indexModalVisible"
      :title="indexEditingId ? '编辑指标' : '添加指标'"
      @ok="handleSaveIndexEntry"
      :width="600"
    >
      <a-form layout="vertical">
        <a-form-item label="指标编码" required>
          <a-input v-model:value="indexForm.indexNumber"
                   placeholder="例如:KPI0001"
                   :disabled="!!indexEditingId" />
          <div v-if="indexEditingId" style="color:#999; font-size:12px; margin-top:4px;">
            编码作为唯一标识,编辑模式下不可修改
          </div>
        </a-form-item>
        <a-form-item label="指标名称" required>
          <a-input v-model:value="indexForm.standardName" placeholder="例如:各项存款余额" />
        </a-form-item>
        <a-form-item label="别名">
          <a-input v-model:value="indexForm.aliases"
                   placeholder='多个用 "/" 分隔,例如:存款余额/总存款' />
          <div style="color:#999; font-size:12px; margin-top:4px;">
            等于指标名称的别名会自动去重剔除
          </div>
        </a-form-item>
        <a-form-item label="指标来源">
          <a-select v-model:value="indexForm.source" allow-clear placeholder="选择来源口径">
            <a-select-option :value="1">人行口径</a-select-option>
            <a-select-option :value="2">银监口径</a-select-option>
            <a-select-option :value="3">省联社口径</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="指标频度">
          <a-select v-model:value="indexForm.frequency" allow-clear placeholder="选择频度">
            <a-select-option value="日">日</a-select-option>
            <a-select-option value="旬">旬</a-select-option>
            <a-select-option value="月">月</a-select-option>
            <a-select-option value="季">季</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 指标库 Excel 上传弹窗 -->
    <a-modal
      v-model:open="indexUploadModalVisible"
      title="上传指标库 Excel"
      :footer="null"
      :width="640"
      @cancel="indexUploadResult = null"
    >
<!--      <a-alert
        message="表头约定"
        type="info"
        show-icon
        style="margin-bottom: 12px;"
        :description="`必填:指标编码 / 指标名称(中英文表头均可:index_number / standard_name)。可选:指标别名(/ 分隔,多别名)、指标来源、指标频率。`"
      />-->
      <a-upload-dragger
        :disabled="indexUploading"
        :showUploadList="false"
        :customRequest="handleUploadIndexEntryFile"
        accept=".xlsx,.xls"
      >
        <p class="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p class="ant-upload-text">点击或拖拽 .xlsx 文件到此区域上传</p>
        <p class="ant-upload-hint">单行错误不会中断整批,导入结束会列出每行结果</p>
      </a-upload-dragger>
      <div v-if="indexUploading" style="text-align: center; margin-top: 16px;">
        <a-spin tip="正在解析与入库..." />
      </div>
      <div v-if="indexUploadResult" style="margin-top: 16px;">
        <a-descriptions :column="3" size="small" bordered>
          <a-descriptions-item label="写入条数">{{ indexUploadResult.upserted }}</a-descriptions-item>
          <a-descriptions-item label="跳过空行">{{ indexUploadResult.skippedRows }}</a-descriptions-item>
          <a-descriptions-item label="错误行数">{{ (indexUploadResult.errors || []).length }}</a-descriptions-item>
        </a-descriptions>
        <a-table
          v-if="(indexUploadResult.errors || []).length > 0"
          style="margin-top: 12px;"
          :columns="[
            { title: '行号', dataIndex: 'rowNumber', key: 'rowNumber', width: 80 },
            { title: '错误信息', dataIndex: 'message', key: 'message' }
          ]"
          :data-source="indexUploadResult.errors.map((e, i) => ({ ...e, key: i }))"
          :pagination="{ pageSize: 5 }"
          size="small"
        />
      </div>
    </a-modal>

    <!-- 从数据源表导入指标库弹窗 -->
    <a-modal
      v-model:open="indexTableImportModalVisible"
      title="从数据源表导入指标库"
      :footer="null"
      :width="640"
      @cancel="indexTableImportResult = null"
    >
      <a-steps :current="indexTableImportStep === 'datasource' ? 0 : indexTableImportStep === 'table' ? 1 : 2" size="small" style="margin-bottom: 16px;">
        <a-step title="选择数据源" />
        <a-step title="选择表并校验" />
        <a-step title="导入完成" />
      </a-steps>

      <!-- Step 1: 选择数据源 -->
      <div v-if="indexTableImportStep === 'datasource'">
        <a-select
          v-model:value="tableImportSelectedDs"
          placeholder="请选择数据源"
          style="width: 100%"
          @change="onTableImportDsChange"
        >
          <a-select-option v-for="ds in tableImportDatasources" :key="ds.id" :value="ds.id">
            {{ ds.name }} ({{ ds.provider }})
          </a-select-option>
        </a-select>
        <div style="margin-top: 12px; text-align: right;">
          <a-button type="primary" :disabled="!tableImportSelectedDs || tableImportTables.length === 0"
                    @click="indexTableImportStep = 'table'">
            下一步
          </a-button>
        </div>
      </div>

      <!-- Step 2: 选择表并校验 -->
      <div v-if="indexTableImportStep === 'table'">
        <a-spin :spinning="tableImportLoading" tip="正在加载...">
          <a-select
            v-if="tableImportSchemas.length > 1"
            v-model:value="tableImportSelectedSchema"
            placeholder="请选择 schema"
            style="width: 100%; margin-bottom: 12px"
            @change="onTableImportSchemaChange"
          >
            <a-select-option v-for="s in tableImportSchemas" :key="s" :value="s">{{ s }}</a-select-option>
          </a-select>
          <a-select
            v-model:value="tableImportSelectedTable"
            placeholder="请选择表（如 kpi_info）"
            style="width: 100%"
            :filter-option="(input, option) => option.value.toLowerCase().includes(input.toLowerCase())"
            show-search
            @change="onTableImportTableChange"
          >
            <a-select-option v-for="t in tableImportTables" :key="t" :value="t">{{ t }}</a-select-option>
          </a-select>
        </a-spin>

        <!-- Schema 校验结果 -->
        <div v-if="tableImportColumns" style="margin-top: 12px;">
          <a-alert
            :type="tableImportColumns.valid ? 'success' : 'error'"
            :message="tableImportColumns.valid ? 'Schema 校验通过' : 'Schema 校验失败'"
            :description="tableImportColumns.valid
              ? `表 ${tableImportColumns.tableName} 包含 ${tableImportColumns.columns.length} 列，符合 kpi_info 规范。`
              : tableImportColumns.message"
            show-icon
          />
          <div v-if="tableImportColumns.columns?.length" style="margin-top: 8px; max-height: 200px; overflow-y: auto;">
            <a-tag v-for="c in tableImportColumns.columns" :key="c.name" style="margin: 2px;">
              {{ c.name }} <small>({{ c.type }})</small>
            </a-tag>
          </div>
        </div>

        <div style="margin-top: 12px; text-align: right;">
          <a-button @click="indexTableImportStep = 'datasource'" style="margin-right: 8px;">上一步</a-button>
          <a-button type="primary" :disabled="!tableImportColumns?.valid" :loading="tableImportLoading"
                    @click="handleImportFromTable">
            开始导入
          </a-button>
        </div>
      </div>

      <!-- Step 3: 导入结果 -->
      <div v-if="indexTableImportStep === 'result' && tableImportResult">
        <a-result status="success" title="导入成功" style="padding: 12px 0;">
          <template #subTitle>
            从数据源表成功导入指标库
          </template>
        </a-result>
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="写入条数">{{ tableImportResult.upserted }}</a-descriptions-item>
          <a-descriptions-item label="展开口径条目">{{ tableImportResult.totalEntries }}</a-descriptions-item>
        </a-descriptions>
        <div style="margin-top: 12px; text-align: center;">
          <a-button type="primary" @click="indexTableImportModalVisible = false">关闭</a-button>
        </div>
      </div>
    </a-modal>

    <!-- 从数据源表导入机构信息弹窗 -->
    <a-modal
      v-model:open="orgTableImportModalVisible"
      title="从数据源表导入机构信息"
      :footer="null"
      :width="640"
      @cancel="orgTableImportResult = null"
    >
      <a-steps :current="orgTableImportStep === 'datasource' ? 0 : orgTableImportStep === 'table' ? 1 : 2" size="small" style="margin-bottom: 16px;">
        <a-step title="选择数据源" />
        <a-step title="选择表并校验" />
        <a-step title="导入完成" />
      </a-steps>

      <!-- Step 1: 选择数据源 -->
      <div v-if="orgTableImportStep === 'datasource'">
        <a-select
          v-model:value="orgTableImportSelectedDs"
          placeholder="请选择数据源"
          style="width: 100%"
          @change="onOrgTableImportDsChange"
        >
          <a-select-option v-for="ds in orgTableImportDatasources" :key="ds.id" :value="ds.id">
            {{ ds.name }} ({{ ds.provider }})
          </a-select-option>
        </a-select>
        <div style="margin-top: 12px; text-align: right;">
          <a-button type="primary" :disabled="!orgTableImportSelectedDs || orgTableImportTables.length === 0"
                    @click="orgTableImportStep = 'table'">
            下一步
          </a-button>
        </div>
      </div>

      <!-- Step 2: 选择表并校验 -->
      <div v-if="orgTableImportStep === 'table'">
        <a-spin :spinning="orgTableImportLoading" tip="正在加载...">
          <a-select
            v-if="orgTableImportSchemas.length > 1"
            v-model:value="orgTableImportSelectedSchema"
            placeholder="请选择 schema"
            style="width: 100%; margin-bottom: 12px"
            @change="onOrgTableImportSchemaChange"
          >
            <a-select-option v-for="s in orgTableImportSchemas" :key="s" :value="s">{{ s }}</a-select-option>
          </a-select>
          <a-select
            v-model:value="orgTableImportSelectedTable"
            placeholder="请选择表（如 c_par_brch_level）"
            style="width: 100%"
            :filter-option="(input, option) => option.value.toLowerCase().includes(input.toLowerCase())"
            show-search
            @change="onOrgTableImportTableChange"
          >
            <a-select-option v-for="t in orgTableImportTables" :key="t" :value="t">{{ t }}</a-select-option>
          </a-select>
        </a-spin>

        <!-- Schema 校验结果 -->
        <div v-if="orgTableImportColumns" style="margin-top: 12px;">
          <a-alert
            :type="orgTableImportColumns.valid ? 'success' : 'error'"
            :message="orgTableImportColumns.valid ? 'Schema 校验通过' : 'Schema 校验失败'"
            :description="orgTableImportColumns.message"
            show-icon
          />
          <div style="margin-top: 4px; color:#999;font-size:12px;">
            必填列: data_dt / brchno / brchna / brchup / brchlv
          </div>
          <div v-if="orgTableImportColumns.columns?.length" style="margin-top: 8px; max-height: 200px; overflow-y: auto;">
            <a-tag v-for="c in orgTableImportColumns.columns" :key="c.name" style="margin: 2px;">
              {{ c.name }} <small>({{ c.type }})</small>
            </a-tag>
          </div>
        </div>

        <div style="margin-top: 12px; text-align: right;">
          <a-button @click="orgTableImportStep = 'datasource'" style="margin-right: 8px;">上一步</a-button>
          <a-button type="primary" :disabled="!orgTableImportColumns?.valid" :loading="orgTableImportLoading"
                    @click="handleOrgImportFromTable">
            开始导入
          </a-button>
        </div>
      </div>

      <!-- Step 3: 导入结果 -->
      <div v-if="orgTableImportStep === 'result' && orgTableImportResult">
        <a-result status="success" title="导入成功" style="padding: 12px 0;">
          <template #subTitle>
            从数据源表成功导入机构信息
          </template>
        </a-result>
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="导入节点数">{{ orgTableImportResult.imported }}</a-descriptions-item>
          <a-descriptions-item label="数据日期 (dataDt)">{{ orgTableImportResult.dataDt }}</a-descriptions-item>
        </a-descriptions>
        <div style="margin-top: 12px; text-align: center;">
          <a-button type="primary" @click="orgTableImportModalVisible = false">关闭</a-button>
        </div>
      </div>
    </a-modal>

    <!-- 手动新增/编辑机构节点弹窗 -->
    <a-modal
      v-model:open="orgNodeModalVisible"
      :title="orgNodeEditingCode ? '编辑机构' : '新增机构'"
      :confirm-loading="orgNodeFormSubmitting"
      @ok="handleSaveOrgNode"
      :width="520"
    >
      <a-form layout="vertical" :model="orgNodeForm" :rules="orgNodeFormRules">
        <a-form-item label="机构编码" name="orgCode" required>
          <a-input
            v-model:value="orgNodeForm.orgCode"
            placeholder="例如：A0001"
            :disabled="!!orgNodeEditingCode"
          />
          <div v-if="orgNodeEditingCode" style="color:#999; font-size:12px; margin-top:4px;">
            编码作为唯一标识，编辑模式下不可修改
          </div>
        </a-form-item>
        <a-form-item label="机构名称" name="orgName" required>
          <a-input v-model:value="orgNodeForm.orgName" placeholder="例如：南京分行" />
        </a-form-item>
        <a-form-item label="父机构" name="parentOrgCode">
          <a-select
            v-model:value="orgNodeForm.parentOrgCode"
            allow-clear
            placeholder="留空表示根节点"
            :options="orgNodeParentOptions"
            :filter-option="(input, option) => option.label.toLowerCase().includes(input.toLowerCase())"
            show-search
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="数据权限级别" name="brchLv" required>
          <a-select
            v-model:value="orgNodeForm.brchLv"
            placeholder="请选择"
            style="width: 100%"
            :options="BRCH_LV_OPTIONS"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 组织结构配置 Modal 已废弃,机构信息由 Excel 接管 -->
  </div>
</template>

<style scoped>
.content-store-manager {
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
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab-actions {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}

.sql-code {
  font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  color: #1890ff;
  background: #f6f8fa;
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
