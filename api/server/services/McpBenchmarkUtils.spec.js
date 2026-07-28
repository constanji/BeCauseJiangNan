const {
  isMissingArg,
  extractTextFromMcpResult,
  parseBecauseAiServerSql,
  extractSqlFromMcpResponse,
} = require('./McpBenchmarkUtils');

describe('McpBenchmarkUtils', () => {
  describe('isMissingArg', () => {
    it('treats empty string as missing', () => {
      expect(isMissingArg('')).toBe(true);
      expect(isMissingArg(undefined)).toBe(true);
      expect(isMissingArg(null)).toBe(true);
      expect(isMissingArg('hello')).toBe(false);
    });
  });

  describe('extractTextFromMcpResult', () => {
    it('extracts string content from tuple', () => {
      expect(extractTextFromMcpResult(['SELECT 1', undefined])).toBe('SELECT 1');
    });

    it('extracts text from content array providers', () => {
      const result = [[{ type: 'text', text: 'SELECT COUNT(*) FROM account' }], undefined];
      expect(extractTextFromMcpResult(result)).toBe('SELECT COUNT(*) FROM account');
    });

    it('extracts text from single content block object', () => {
      expect(extractTextFromMcpResult([{ type: 'text', text: 'SELECT 1' }])).toBe('SELECT 1');
    });
  });

  describe('parseBecauseAiServerSql', () => {
    it('extracts SQL from semantic_to_sql section', () => {
      const response = [
        '--------------------- semantic_to_sql ---------------------',
        'Query SQL: SELECT COUNT(*) FROM account',
      ].join('\n');
      expect(parseBecauseAiServerSql(response)).toBe('SELECT COUNT(*) FROM account');
    });

    it('extracts SQL from sql_generate section with SQL: prefix', () => {
      const response = [
        '--------------------- sql_generate ---------------------',
        'SQL: SELECT player_name, pts FROM plyrs_trad ORDER BY pts DESC LIMIT 1',
      ].join('\n');
      expect(parseBecauseAiServerSql(response)).toBe(
        'SELECT player_name, pts FROM plyrs_trad ORDER BY pts DESC LIMIT 1',
      );
    });

    it('extracts SQL from full becauseai-server response with escaped newlines', () => {
      const response =
        '--------------------- intent_classification ---------------------\\n' +
        '{"rephrased_question":"本赛季得分王是谁？","intent":"TEXT_TO_SQL"}\\n' +
        '--------------------- sql_generation_reasoning ---------------------\\n' +
        'reasoning text\\n' +
        '--------------------- sql_generate ---------------------\\n' +
        'SQL: SELECT player_name, pts FROM plyrs_trad ORDER BY pts DESC LIMIT 1\\n' +
        '--------------------- sql_execute ---------------------\\n' +
        'Query Results: [{"player_name":"Shai Gilgeous-Alexander","pts":2484}]\\n';

      expect(parseBecauseAiServerSql(response)).toBe(
        'SELECT player_name, pts FROM plyrs_trad ORDER BY pts DESC LIMIT 1',
      );
    });
  });

  describe('extractSqlFromMcpResponse', () => {
    const extractSQL = (text) => text.trim();

    it('uses structured parser for becauseai-server', () => {
      const response = [
        '--------------------- semantic_to_sql ---------------------',
        'Query SQL: SELECT 1',
      ].join('\n');
      expect(extractSqlFromMcpResponse('becauseai-server', response, extractSQL)).toBe('SELECT 1');
    });
  });
});
