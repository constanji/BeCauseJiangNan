/**
 * Utilities for benchmark MCP tool calls: result parsing and becauseai-server SQL extraction.
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isMissingArg(value) {
  return value === undefined || value === null || value === '';
}

/**
 * Extract plain text from MCPManager.callTool / formatToolContent output.
 * @param {unknown} result
 * @returns {string}
 */
function extractTextFromMcpResult(result) {
  if (result == null) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (!Array.isArray(result)) {
    if (typeof result === 'object' && result !== null && 'text' in result && typeof result.text === 'string') {
      return result.text;
    }
    return JSON.stringify(result);
  }

  const [content] = result;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }

  return '';
}

/**
 * Normalize escaped newlines/tabs from JSON-encoded MCP payloads.
 * @param {string} response
 * @returns {string}
 */
function normalizeBecauseAiResponse(response) {
  if (!response.includes('\\n') && !response.includes('\\t') && !response.includes('\\r')) {
    return response;
  }
  return response.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
}

/**
 * Strip common becauseai-server SQL labels from section body.
 * @param {string} content
 * @returns {string}
 */
function stripLeadingSqlLabel(content) {
  return content
    .trim()
    .replace(/^(?:SQL|Semantic SQL|Query SQL)\s*:\s*/i, '')
    .trim();
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeSql(text) {
  return /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(text);
}

/**
 * Parse becauseai-server structured MCP response and extract executable SQL.
 * @param {string} response
 * @returns {string | null}
 */
function parseBecauseAiServerSql(response) {
  if (!response || typeof response !== 'string' || !response.includes('---------------------')) {
    return null;
  }

  const normalizedResponse = normalizeBecauseAiResponse(response);

  const semanticMatch = normalizedResponse.match(
    /--------------------- semantic_to_sql ---------------------[\r\n]+([\s\S]*?)(?=---------------------|$)/,
  );
  if (semanticMatch?.[1]) {
    let semanticContent = semanticMatch[1].trim();
    if (semanticContent) {
      if (semanticContent.startsWith('"') && semanticContent.endsWith('"')) {
        try {
          semanticContent = JSON.parse(semanticContent);
          if (typeof semanticContent !== 'string') {
            semanticContent = JSON.stringify(semanticContent);
          }
        } catch {
          // keep original
        }
      }

      try {
        const semanticData = JSON.parse(semanticContent);
        if (semanticData && typeof semanticData === 'object') {
          if (semanticData.error) {
            return null;
          }
          const sql = semanticData.QuerySQL || semanticData.query_sql || semanticData.sql;
          if (typeof sql === 'string' && sql.trim()) {
            return stripLeadingSqlLabel(sql);
          }
        }
      } catch {
        const labeled = stripLeadingSqlLabel(semanticContent);
        if (looksLikeSql(labeled)) {
          return labeled;
        }
      }
    }
  }

  const sqlMatch = normalizedResponse.match(
    /--------------------- sql_generate ---------------------[\r\n]+([\s\S]*?)(?=---------------------|$)/,
  );
  if (sqlMatch?.[1]) {
    const sqlContent = stripLeadingSqlLabel(sqlMatch[1]);
    if (sqlContent && looksLikeSql(sqlContent)) {
      return sqlContent;
    }
  }

  return null;
}

/**
 * @param {string} serverName
 * @param {string} responseText
 * @param {(text: string) => string} extractSQL
 * @returns {string}
 */
function extractSqlFromMcpResponse(serverName, responseText, extractSQL) {
  if (!responseText || !responseText.trim()) {
    return '';
  }

  if (serverName === 'becauseai-server' || serverName === 'analysis-server') {
    const structuredSql = parseBecauseAiServerSql(responseText);
    if (structuredSql) {
      return extractSQL(structuredSql);
    }
  }

  return extractSQL(responseText);
}

module.exports = {
  isMissingArg,
  extractTextFromMcpResult,
  parseBecauseAiServerSql,
  extractSqlFromMcpResponse,
};
