/**
 * Project API Service
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080'

/**
 * 获取项目列表
 */
export async function getProjects() {
    const response = await fetch(`${BASE_URL}/api/v1/projects`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 获取项目详情
 */
export async function getProject(id) {
    const response = await fetch(`${BASE_URL}/api/v1/projects/${id}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 创建项目
 */
export async function createProject(project) {
    const response = await fetch(`${BASE_URL}/api/v1/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 更新项目
 */
export async function updateProject(id, project) {
    const response = await fetch(`${BASE_URL}/api/v1/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 删除项目
 */
export async function deleteProject(id) {
    const response = await fetch(`${BASE_URL}/api/v1/projects/${id}`, {
        method: 'DELETE',
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 获取全局配置（默认项目和数据源）
 */
export async function getGlobalConfig() {
    const response = await fetch(`${BASE_URL}/api/v1/config/global`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 更新全局配置（设置默认项目和数据源）
 */
export async function updateGlobalConfig(config) {
    const response = await fetch(`${BASE_URL}/api/v1/config/global`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 清除默认配置
 */
export async function clearDefaultConfig() {
    const response = await fetch(`${BASE_URL}/api/v1/config/global/defaults`, {
        method: 'DELETE',
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}
