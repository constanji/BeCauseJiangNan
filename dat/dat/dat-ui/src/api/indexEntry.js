/**
 * Index Entry API Service
 * 提供指标库 CRUD + Excel 批量导入接口,对应后端 IndexEntryController。
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080'

/**
 * 列出项目下全部指标(带 _id)
 * 返回:Array<{id, indexNumber, standardName, aliases, source, frequency}>
 */
export async function listIndexEntries(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/index/entries?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 新增/更新单条指标(按 indexNumber upsert)
 * @param {object} entry { indexNumber, standardName, aliases, source, frequency }
 */
export async function upsertIndexEntry(projectId, entry) {
    const response = await fetch(`${BASE_URL}/api/v1/index/entries?projectId=${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.text()
}

/** 批量 upsert,返回写入数量 */
export async function upsertIndexEntries(projectId, entries) {
    const response = await fetch(`${BASE_URL}/api/v1/index/entries/batch?projectId=${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries)
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 上传 指标库.xlsx 并入库
 * 返回:{ upserted, skippedRows, errors:[{rowNumber, message}] }
 */
export async function uploadIndexEntryFile(projectId, file) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${BASE_URL}/api/v1/index/entries/upload?projectId=${projectId}`, {
        method: 'POST',
        body: formData
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/** 按 _id 删除 */
export async function removeIndexEntry(id) {
    const response = await fetch(`${BASE_URL}/api/v1/index/entries/${id}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

/**
 * 从数据源表 kpi_info 导入指标库 (SQL dump / JSON)
 * 返回:{ upserted, totalEntries }
 */
export async function importKpiInfo(projectId, file) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${BASE_URL}/api/v1/index/entries/import-kpi-info?projectId=${projectId}`, {
        method: 'POST',
        body: formData
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/** 列出数据源中的所有 schema */
export async function listDatasourceSchemas(datasourceId) {
    const response = await fetch(`${BASE_URL}/api/v1/datasources/${datasourceId}/schemas`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return response.json()
}

/** 列出数据源中的表名；传入 schema 则只返回该 schema 下的表 */
export async function listDatasourceTables(datasourceId, schema = null) {
    let url = `${BASE_URL}/api/v1/datasources/${datasourceId}/tables`
    if (schema) {
        url = `${BASE_URL}/api/v1/datasources/${datasourceId}/schemas/${encodeURIComponent(schema)}/tables`
    }
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return response.json()
}

/** 获取表列信息并校验 kpi_info schema */
export async function getTableColumns(datasourceId, tableName) {
    const response = await fetch(`${BASE_URL}/api/v1/datasources/${datasourceId}/tables/${tableName}/columns`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return response.json()
}

/** 从数据源表直接导入指标库 */
export async function importFromTable(projectId, datasourceId, tableName) {
    const response = await fetch(`${BASE_URL}/api/v1/index/entries/import-from-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, datasourceId, tableName })
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/** 清空项目下全部指标(危险操作) */
export async function removeAllIndexEntries(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/index/entries/all?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}
