const { hasQueryContextContent } = require('./queryContext');

function getSysHeader(transaction) {
  return transaction?.Header?.sysHeader || transaction?.header?.sysHeader || null;
}

function getBizBody(transaction) {
  return transaction?.Body?.request?.bizBody || transaction?.body?.request?.bizBody || null;
}

function validateEsbRequest(body) {
  const transaction = body?.Transaction || body?.transaction;
  if (!transaction) {
    return { ok: false, error: '缺少 Transaction 根节点' };
  }

  const sysHeader = getSysHeader(transaction);
  if (!sysHeader) {
    return { ok: false, error: '缺少 Transaction.Header.sysHeader' };
  }

  for (const field of ['msgId', 'msgDate', 'msgTime', 'serviceCd', 'clientCd', 'serverCd']) {
    if (!sysHeader[field]) {
      // 部分字段缺失，但已有的字段（例如 msgId）仍回填给调用方便于对账
      return { ok: false, error: `sysHeader 缺少字段: ${field}`, sysHeader };
    }
  }

  const bizBody = getBizBody(transaction);
  if (!bizBody) {
    return { ok: false, error: '缺少 Transaction.Body.request.bizBody', sysHeader };
  }

  if (!bizBody.orgCode || !String(bizBody.orgCode).trim()) {
    return { ok: false, error: 'bizBody 缺少 orgCode（机构号）', sysHeader };
  }
  if (!bizBody.userNum || !String(bizBody.userNum).trim()) {
    return { ok: false, error: 'bizBody 缺少 userNum（员工号）', sysHeader };
  }

  // 统一循环模拟流式协议：首轮提交 text 拿 streamId，后续携带 streamId 继续轮询。
  if (bizBody.streamMode !== undefined) {
    delete bizBody.streamMode;
  }

  const isPoll = !!(bizBody.streamId && String(bizBody.streamId).trim());
  if (!isPoll) {
    if (!bizBody.scene || !String(bizBody.scene).trim()) {
      return { ok: false, error: 'bizBody 缺少 scene（智能体场景标识）', sysHeader };
    }
  }

  // text、queryContext 二选一必填：queryContext 有有效内容时可省略 text（此时 text 直接由 queryContext 生成）
  if (!isPoll) {
    const hasText = !!(bizBody.text && String(bizBody.text).trim());
    const hasContext = hasQueryContextContent(bizBody.queryContext);
    if (!hasText && !hasContext) {
      return { ok: false, error: 'bizBody 缺少 text（用户问题）或 queryContext（上下文）', sysHeader };
    }
  }

  return { ok: true, transaction, sysHeader, bizBody };
}

function buildSuccessResponse(sysHeader, bizBody, payload) {
  return {
    Transaction: {
      Header: {
        sysHeader: {
          ...sysHeader,
          resCode: '000000',
          resText: '交易成功',
          bizResCode: '1',
          bizResText: '成功',
        },
      },
      Body: {
        response: {
          bizHeader: {},
          bizBody: {
            result: '1',
            ...payload,
          },
        },
      },
    },
  };
}

function buildErrorResponse(sysHeader, bizBody, message, bizResCode = '0') {
  const header = sysHeader || {
    msgId: '',
    msgDate: '',
    msgTime: '',
    serviceCd: '',
    clientCd: '',
    serverCd: '',
  };

  return {
    Transaction: {
      Header: {
        sysHeader: {
          ...header,
          resCode: '000000',
          resText: '交易成功',
          bizResCode,
          bizResText: message,
        },
      },
      Body: {
        response: {
          bizHeader: {},
          bizBody: {
            result: '0',
            error: message,
          },
        },
      },
    },
  };
}

/**
 * @param {string} message
 * @param {object} [sysHeader] 校验失败时若已解析出（部分）原始 sysHeader，回填其中的 msgId 等字段，
 *   便于 ESB 调用方按 msgId 对账；resCode/resText/bizResCode/bizResText 仍固定为系统错误值。
 */
function buildSystemErrorResponse(message, sysHeader) {
  return {
    Transaction: {
      Header: {
        sysHeader: {
          msgId: '',
          msgDate: '',
          msgTime: '',
          serviceCd: '',
          clientCd: '',
          serverCd: '',
          ...sysHeader,
          resCode: '999999',
          resText: message,
          bizResCode: '0',
          bizResText: message,
        },
      },
      Body: {
        response: {
          bizHeader: {},
          bizBody: {
            result: '0',
            error: message,
          },
        },
      },
    },
  };
}

module.exports = {
  validateEsbRequest,
  buildSuccessResponse,
  buildErrorResponse,
  buildSystemErrorResponse,
};
