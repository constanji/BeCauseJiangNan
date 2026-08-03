/**
 * Datasource API Service
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080'

/**
 * 获取数据源列表
 */
export async function getDatasources(projectId) {
    const url = projectId
        ? `${BASE_URL}/api/v1/datasources?projectId=${projectId}`
        : `${BASE_URL}/api/v1/datasources`
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 获取数据源详情
 */
export async function getDatasource(id) {
    const response = await fetch(`${BASE_URL}/api/v1/datasources/${id}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 创建数据源
 */
export async function createDatasource(datasource) {
    const response = await fetch(`${BASE_URL}/api/v1/datasources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datasource),
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 更新数据源
 */
export async function updateDatasource(id, datasource) {
    const response = await fetch(`${BASE_URL}/api/v1/datasources/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datasource),
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 删除数据源
 */
export async function deleteDatasource(id) {
    const response = await fetch(`${BASE_URL}/api/v1/datasources/${id}`, {
        method: 'DELETE',
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}
