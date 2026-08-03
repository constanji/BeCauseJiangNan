/**
 * Content Store API Service
 * 提供 SQL 示例对、同义词、业务知识的 CRUD 接口
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080'

// ============ SQL Pairs ============

/**
 * 获取所有 SQL 示例对
 */
export async function listSqlPairs(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/sql-pairs?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 检索相关的 SQL 示例对
 */
export async function retrieveSqlPairs(projectId, query) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/sql-pairs/retrieve?projectId=${projectId}&query=${encodeURIComponent(query)}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 添加 SQL 示例对
 */
export async function addSqlPair(projectId, sqlPair) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/sql-pairs?projectId=${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sqlPair)
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.text()
}

/**
 * 删除 SQL 示例对
 */
export async function removeSqlPair(projectId, id) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/sql-pairs/${id}?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

/**
 * 清空所有 SQL 示例对
 */
export async function removeAllSqlPairs(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/sql-pairs?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

// ============ Synonyms ============

/**
 * 获取所有同义词对
 */
export async function listSynonyms(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/synonyms?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 检索相关的同义词对
 */
export async function retrieveSynonyms(projectId, query) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/synonyms/retrieve?projectId=${projectId}&query=${encodeURIComponent(query)}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 添加同义词对
 */
export async function addSynonym(projectId, synonym) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/synonyms?projectId=${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(synonym)
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.text()
}

/**
 * 删除同义词对
 */
export async function removeSynonym(projectId, id) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/synonyms/${id}?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

/**
 * 清空所有同义词对
 */
export async function removeAllSynonyms(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/synonyms?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

// ============ Docs ============

/**
 * 获取所有业务知识文档
 */
export async function listDocs(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/docs?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 检索相关的业务知识文档
 */
export async function retrieveDocs(projectId, query) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/docs/retrieve?projectId=${projectId}&query=${encodeURIComponent(query)}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 添加业务知识文档
 */
export async function addDoc(projectId, content) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/docs?projectId=${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.text()
}

/**
 * 删除业务知识文档
 */
export async function removeDoc(projectId, id) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/docs/${id}?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

/**
 * 清空所有业务知识文档
 */
export async function removeAllDocs(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/docs?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

/**
 * 上传文件并解析为业务知识文档
 * 支持 TXT, MD, PDF, DOC, DOCX 等格式
 */
export async function uploadDocFile(projectId, file) {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${BASE_URL}/api/v1/content-store/docs/upload?projectId=${projectId}`, {
        method: 'POST',
        body: formData
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 获取支持的文件格式列表
 */
export async function getSupportedFormats(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/docs/supported-formats?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

// ============ Preprocessing (Light Schema & Cells) ============

/**
 * 生成并保存 Light Schema
 * @param {string} projectId
 * @param {string} datasourceId
 * @param {number} sampleLimit 采样行数，默认 5
 * @param {string[]|null} tableNames 可选，选中的表名列表；为空则全量重建
 * @param {boolean} enrich 是否启用 AI 补全描述
 */
export async function generateLightSchema(projectId, datasourceId, sampleLimit = 5, tableNames = null, enrich = true) {
    const url = `${BASE_URL}/api/v1/content-store/light-schema/generate?projectId=${projectId}&datasourceId=${datasourceId}&sampleLimit=${sampleLimit}&enrich=${enrich}`
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNames: tableNames || [] })
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.text()
}

/**
 * 向量化数据库单元格值
 * @param {string} projectId
 * @param {string} datasourceId
 * @param {number} rowLimit 采样行数，默认 100
 * @param {string[]|null} tableNames 可选，选中的表名列表；为空则全量向量化
 */
export async function vectorizeCells(projectId, datasourceId, rowLimit = 100, tableNames = null) {
    const url = `${BASE_URL}/api/v1/content-store/cells/vectorize?projectId=${projectId}&datasourceId=${datasourceId}&rowLimit=${rowLimit}`
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNames: tableNames || [] })
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.text()
}

/**
 * 清空预处理数据 (Light Schema 和 Cells)
 */
export async function clearPreprocessing(projectId, datasourceId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/preprocessing/clear?projectId=${projectId}&datasourceId=${datasourceId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.text()
}

/**
 * 获取数据源的所有 Light Schema
 */
export async function listLightSchemas(projectId, datasourceId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/light-schema/list?projectId=${projectId}&datasourceId=${datasourceId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 获取数据源中的所有 schema 列表（用于 PostgreSQL/GaussDB 多模式场景）。
 */
export async function listDatasourceSchemas(projectId, datasourceId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/datasource/schemas?projectId=${projectId}&datasourceId=${datasourceId}`)
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 获取数据源中的所有表名（用于 UI 多选）。
 * 传入 schema 时只返回该 schema 下的表。
 */
export async function listDatasourceTables(projectId, datasourceId, schema = null) {
    let url = `${BASE_URL}/api/v1/content-store/datasource/tables?projectId=${projectId}&datasourceId=${datasourceId}`
    if (schema) {
        url += `&schema=${encodeURIComponent(schema)}`
    }
    const response = await fetch(url)
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 获取该数据源下已被向量化过单元格的表名集合
 */
export async function listCellTables(projectId, datasourceId) {
    const response = await fetch(`${BASE_URL}/api/v1/content-store/cells/tables?projectId=${projectId}&datasourceId=${datasourceId}`)
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
    }
    return response.json()
}
