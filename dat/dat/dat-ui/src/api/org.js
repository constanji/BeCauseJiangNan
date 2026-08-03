/**
 * Org Management API — 机构信息由数据源表 c_par_brch_level 驱动，同时支持手动维护单条节点。
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080'

/** 获取当前机构树（只读，供前端预览）。返回嵌套树。 */
export async function getOrgNodes(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/** 清空项目下全部机构信息。 */
export async function removeAllOrgNodes(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/all?projectId=${projectId}`, {
        method: 'DELETE'
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
}

/**
 * 从 Excel 文件导入机构信息。
 * @param {string} projectId
 * @param {File} file - .xlsx 文件
 * @returns {Promise<{imported: number, dataDt: string}>}
 */
export async function importOrgNodesFromExcel(projectId, file) {
  const formData = new FormData()
  formData.append('projectId', projectId)
  formData.append('file', file)
  const response = await fetch(`${BASE_URL}/api/v1/org/nodes/import-excel`, {
    method: 'POST',
    body: formData
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const err = new Error(body?.message || `HTTP error! status: ${response.status}`)
    err.code = body?.error
    throw err
  }
  return body
}

/**
 * 从数据源表导入机构信息。
 * Body: { projectId, datasourceId, tableName }
 * 返回: { imported, dataDt }
 */
export async function importOrgNodesFromTable(projectId, datasourceId, tableName) {
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/import-from-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, datasourceId, tableName })
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
        const err = new Error(body?.message || `HTTP error! status: ${response.status}`)
        err.code = body?.error
        throw err
    }
    return body
}

/** 获取项目的可用机构数据快照日期列表。返回 string[]。 */
export async function listOrgDataTimes(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/datatimes?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/** 获取项目当前激活的 dataDt。返回 { activeDataDt, isManual, latestDataDt }。 */
export async function getOrgActiveDataDt(projectId) {
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/active-data-dt?projectId=${projectId}`)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
    }
    return response.json()
}

/**
 * 切换项目活跃机构数据快照。
 * @param {string} projectId
 * @param {string|null} dataDt - 快照日期；传 null 或空字符串恢复自动使用最新
 */
export async function activateOrgDataDt(projectId, dataDt) {
    const params = new URLSearchParams({ projectId })
    if (dataDt) params.append('dataDt', dataDt)
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/activate-data-dt?${params}`, {
        method: 'PUT'
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
        const err = new Error(body?.message || `HTTP error! status: ${response.status}`)
        err.code = body?.error
        throw err
    }
    return body
}

/**
 * 手动新增机构节点。
 * Body: { projectId, orgCode, orgName, parentOrgCode, brchLv }
 * 返回: 保存后的节点对象
 */
export async function addOrgNode(projectId, node) {
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...node })
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
        const err = new Error(body?.message || `HTTP error! status: ${response.status}`)
        err.code = body?.error
        throw err
    }
    return body
}

/**
 * 手动编辑机构节点。
 * Body: { projectId, orgName, parentOrgCode, brchLv }
 * 返回: 保存后的节点对象
 */
export async function updateOrgNode(projectId, orgCode, node) {
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/${encodeURIComponent(orgCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...node })
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
        const err = new Error(body?.message || `HTTP error! status: ${response.status}`)
        err.code = body?.error
        throw err
    }
    return body
}

/**
 * 删除机构节点。
 * @param {string} projectId
 * @param {string} orgCode
 * @param {boolean} cascade - 是否级联删除子节点
 */
export async function deleteOrgNode(projectId, orgCode, cascade = false) {
    const params = new URLSearchParams({ projectId })
    if (cascade) params.append('cascade', 'true')
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/${encodeURIComponent(orgCode)}?${params}`, {
        method: 'DELETE'
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
        const err = new Error(body?.message || `HTTP error! status: ${response.status}`)
        err.code = body?.error
        throw err
    }
    return body
}

/**
 * 修改单个机构的数据权限级别。
 * @param {string} projectId
 * @param {string} orgCode
 * @param {number} brchLv - 1/2/3/4
 * @returns {Promise<{orgCode: string, brchLv: number, dataScope: string}>}
 */
export async function updateOrgNodeBrchLv(projectId, orgCode, brchLv) {
    const params = new URLSearchParams({ projectId, orgCode, brchLv: String(brchLv) })
    const response = await fetch(`${BASE_URL}/api/v1/org/nodes/brch-lv?${params}`, {
        method: 'PUT'
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
        const err = new Error(body?.message || `HTTP error! status: ${response.status}`)
        err.code = body?.error
        throw err
    }
    return body
}
