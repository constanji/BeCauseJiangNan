/**
 * 自定义基准测试数据集 JSON 校验工具
 *
 * 校验规则:
 *   1. 必须是 JSON 数组
 *   2. 每项必须包含 question_id(数字)、db_id(字符串)、question(字符串)、SQL(字符串)
 *   3. question_id 必须唯一
 *   4. difficulty 若存在，必须为 simple / moderate / challenging
 *   5. SQL 不能为空
 */

const VALID_DIFFICULTIES = ['simple', 'moderate', 'challenging'];

/**
 * 校验上传的自定义基准测试数据集
 * @param {any} data - 解析后的 JSON 数据
 * @returns {{ valid: boolean, errors: string[], stats: object }}
 */
function validateBenchmarkDataset(data) {
  const errors = [];

  // 1. 必须是数组
  if (!Array.isArray(data)) {
    return {
      valid: false,
      errors: ['数据必须是 JSON 数组格式'],
      stats: null,
    };
  }

  if (data.length === 0) {
    return {
      valid: false,
      errors: ['数据集不能为空，至少需要包含一个测试项'],
      stats: null,
    };
  }

  const seenIds = new Set();
  const dbIds = new Set();
  const difficultyCount = { simple: 0, moderate: 0, challenging: 0 };

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const prefix = `第 ${i + 1} 项`;

    // 2. 类型检查
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${prefix}: 必须是一个对象`);
      continue;
    }

    // question_id
    if (item.question_id === undefined || item.question_id === null) {
      errors.push(`${prefix}: 缺少 question_id 字段`);
    } else if (typeof item.question_id !== 'number' || !Number.isFinite(item.question_id)) {
      errors.push(`${prefix}: question_id 必须是有效的数字`);
    } else if (seenIds.has(item.question_id)) {
      errors.push(`${prefix}: question_id ${item.question_id} 重复`);
    } else {
      seenIds.add(item.question_id);
    }

    // db_id
    if (!item.db_id || typeof item.db_id !== 'string' || !item.db_id.trim()) {
      errors.push(`${prefix}: 缺少 db_id 字段或格式不正确（应为非空字符串）`);
    } else {
      dbIds.add(item.db_id.trim());
    }

    // question
    if (!item.question || typeof item.question !== 'string' || !item.question.trim()) {
      errors.push(`${prefix}: 缺少 question 字段或格式不正确（应为非空字符串）`);
    }

    // SQL (标准答案)
    if (!item.SQL || typeof item.SQL !== 'string' || !item.SQL.trim()) {
      errors.push(`${prefix}: 缺少 SQL 字段或格式不正确（应为非空字符串）`);
    }

    // difficulty (可选)
    if (item.difficulty !== undefined && item.difficulty !== null) {
      if (typeof item.difficulty !== 'string' || !VALID_DIFFICULTIES.includes(item.difficulty)) {
        errors.push(
          `${prefix}: difficulty 值 "${item.difficulty}" 无效，必须为 simple / moderate / challenging`,
        );
      } else {
        difficultyCount[item.difficulty]++;
      }
    } else {
      // 没有 difficulty 的默认归为 simple
      difficultyCount.simple++;
    }
  }

  const stats = {
    total: data.length,
    databases: Array.from(dbIds),
    databaseCount: dbIds.size,
    difficulty: { ...difficultyCount },
  };

  return {
    valid: errors.length === 0,
    errors,
    stats,
  };
}

/**
 * 生成模板数据
 * @returns {Array}
 */
function generateTemplate() {
  return [
    {
      question_id: 1,
      db_id: 'my_database',
      question: '查询所有年龄大于30岁的用户',
      evidence: '年龄字段为 age，用户表为 users',
      SQL: 'SELECT * FROM users WHERE age > 30',
      difficulty: 'simple',
    },
    {
      question_id: 2,
      db_id: 'my_database',
      question: '统计每个部门的平均工资',
      evidence: '部门表为 departments，员工表为 employees，需要连接查询',
      SQL: 'SELECT d.name, AVG(e.salary) FROM departments d JOIN employees e ON d.id = e.department_id GROUP BY d.name',
      difficulty: 'moderate',
    },
    {
      question_id: 3,
      db_id: 'my_database',
      question: '查找工资最高的前3个部门，并列出每个部门的员工数和平均工资',
      evidence:
        '需要多层子查询或窗口函数，部门表为 departments，员工表为 employees',
      SQL: 'SELECT d.name, COUNT(e.id) AS employee_count, AVG(e.salary) AS avg_salary FROM departments d JOIN employees e ON d.id = e.department_id GROUP BY d.name ORDER BY avg_salary DESC LIMIT 3',
      difficulty: 'challenging',
    },
  ];
}

module.exports = {
  validateBenchmarkDataset,
  generateTemplate,
  VALID_DIFFICULTIES,
};
