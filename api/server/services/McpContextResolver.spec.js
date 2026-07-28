jest.mock('@because/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('~/models/DatDatasource', () => ({ getDatDatasourceModel: jest.fn() }));
jest.mock('~/models/Conversation', () => ({ getConvo: jest.fn() }));
jest.mock('~/db/models', () => ({
  Conversation: { findOneAndUpdate: jest.fn() },
  OrgPermissionSettings: {
    findOne: jest.fn(),
  },
  OrgPermissionUnit: {
    find: jest.fn(),
  },
}));
jest.mock('~/server/services/DataSource', () => ({ getDataSourceByAgentId: jest.fn() }));

const { getDatDatasourceModel } = require('~/models/DatDatasource');
const { OrgPermissionSettings, OrgPermissionUnit } = require('~/db/models');
const { invalidateOrgPermissionCache } = require('~/server/services/OrgPermissionCache');
const {
  stripHiddenParamsFromSchema,
  applyContextInjection,
  getContextInjectionConfig,
  resolveOrgCode,
  injectNeedsDatasourceContext,
  resolveAndInjectMcpContext,
} = require('./McpContextResolver');

describe('McpContextResolver', () => {
  beforeEach(() => {
    invalidateOrgPermissionCache();
    OrgPermissionSettings.findOne.mockReset();
    OrgPermissionUnit.find.mockReset();
    OrgPermissionSettings.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ enforcementEnabled: false }),
    });
    OrgPermissionUnit.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
  });

  describe('resolveOrgCode', () => {
    it('prefers requestBody.orgCode over user.orgCode', () => {
      expect(
        resolveOrgCode({
          requestBody: { orgCode: 'REQ01' },
          user: { orgCode: 'USER01' },
        }),
      ).toBe('REQ01');
    });

    it('falls back to user.orgCode when requestBody is empty', () => {
      expect(
        resolveOrgCode({
          requestBody: {},
          user: { orgCode: 'USER01' },
        }),
      ).toBe('USER01');
    });

    it('returns existing when already set', () => {
      expect(
        resolveOrgCode({
          requestBody: { orgCode: 'REQ01' },
          user: { orgCode: 'USER01' },
          existing: 'EXISTING',
        }),
      ).toBe('EXISTING');
    });

    it('returns undefined when nothing is available', () => {
      expect(resolveOrgCode({})).toBeUndefined();
      expect(resolveOrgCode({ requestBody: { orgCode: '' }, user: {} })).toBeUndefined();
    });
  });

  describe('injectNeedsDatasourceContext', () => {
    it('detects projectId/datasourceId requirements', () => {
      expect(injectNeedsDatasourceContext({ arg4: 'orgCode' })).toBe(false);
      expect(
        injectNeedsDatasourceContext({ arg1: 'projectId', arg4: 'orgCode' }),
      ).toBe(true);
      expect(injectNeedsDatasourceContext({ ds: 'datasourceId' })).toBe(true);
    });
  });

  describe('getContextInjectionConfig', () => {
    it('returns tool-specific default config for becauseai-server ask_data', () => {
      const config = getContextInjectionConfig('becauseai-server', undefined, 'ask_data');
      expect(config?.inject).toEqual({
        projectId: 'projectId',
        arg1: 'projectId',
        arg2: 'datasourceId',
        arg4: 'orgCode',
        arg5: 'question',
      });
      expect(config?.hideFromSchema).toEqual(
        expect.arrayContaining(['arg1', 'arg2', 'arg4']),
      );
    });

    it('prefers tool-specific mcpConfig override when provided', () => {
      const custom = {
        'custom-server': {
          contextInjection: {
            run: {
              resolve: [{ from: 'requestBody', field: 'datasourceId' }],
              inject: { foo: 'projectId' },
              hideFromSchema: ['foo'],
            },
          },
        },
      };
      const config = getContextInjectionConfig('custom-server', custom, 'run');
      expect(config?.inject).toEqual({ foo: 'projectId' });
    });

    it('prefers server-level mcpConfig override when provided', () => {
      const custom = {
        'custom-server': {
          contextInjection: {
            resolve: [{ from: 'requestBody', field: 'datasourceId' }],
            inject: { foo: 'projectId' },
            hideFromSchema: ['foo'],
          },
        },
      };
      const config = getContextInjectionConfig('custom-server', custom);
      expect(config?.inject).toEqual({ foo: 'projectId' });
    });
  });

  describe('stripHiddenParamsFromSchema', () => {
    it('removes hidden properties and required entries', () => {
      const parameters = {
        type: 'object',
        properties: {
          query: { type: 'string' },
          arg1: { type: 'string' },
          arg2: { type: 'string' },
        },
        required: ['query', 'arg1', 'arg2'],
      };
      const result = stripHiddenParamsFromSchema(parameters, ['arg1', 'arg2']);
      expect(result.properties).not.toHaveProperty('arg1');
      expect(result.properties).not.toHaveProperty('arg2');
      expect(result.required).toEqual(['query']);
    });
  });

  describe('applyContextInjection', () => {
    it('injects mapped fields without overwriting explicit values', () => {
      const args = applyContextInjection(
        { arg1: 'user-set', query: 'sales' },
        { projectId: 'p1', datasourceId: 'd1' },
        { arg1: 'projectId', arg2: 'datasourceId' },
        ['arg1', 'arg2'],
      );
      expect(args.arg1).toBe('user-set');
      expect(args.arg2).toBe('d1');
      expect(args.query).toBe('sales');
    });

    it('maps question-like fields to arg4 when configured', () => {
      const args = applyContextInjection(
        { question: 'how many accounts' },
        { projectId: 'p1', datasourceId: 'd1' },
        { arg1: 'projectId', arg2: 'datasourceId', arg4: 'question' },
        ['arg1', 'arg2'],
      );
      expect(args.arg1).toBe('p1');
      expect(args.arg2).toBe('d1');
      expect(args.arg4).toBe('how many accounts');
      expect(args.question).toBe('how many accounts');
    });

    it('reads question from inject-mapped param (arg5) and routes orgCode into arg4', () => {
      const args = applyContextInjection(
        { arg5: 'how many accounts' },
        { projectId: 'p1', datasourceId: 'd1', orgCode: 'H0001' },
        {
          arg1: 'projectId',
          arg2: 'datasourceId',
          arg4: 'orgCode',
          arg5: 'question',
        },
        ['arg1', 'arg2', 'arg4'],
      );
      expect(args.arg1).toBe('p1');
      expect(args.arg2).toBe('d1');
      expect(args.arg4).toBe('H0001');
      expect(args.arg5).toBe('how many accounts');
    });

    it('does not treat a user-supplied arg4 (orgCode) as the question text', () => {
      const args = applyContextInjection(
        { arg4: 'H0001', question: 'how many accounts' },
        { projectId: 'p1', datasourceId: 'd1' },
        {
          arg1: 'projectId',
          arg2: 'datasourceId',
          arg4: 'orgCode',
          arg5: 'question',
        },
        ['arg1', 'arg2', 'arg4'],
      );
      expect(args.arg4).toBe('H0001');
      expect(args.arg5).toBe('how many accounts');
    });
  });

  describe('resolveAndInjectMcpContext orgCode-only', () => {
    beforeEach(() => {
      getDatDatasourceModel.mockReset();
    });

    it('injects orgCode without datasource when inject map only needs orgCode', async () => {
      const result = await resolveAndInjectMcpContext({
        serverName: 'other-agent',
        toolName: 'my_tool',
        toolArguments: { query: 'hello' },
        configurable: {
          requestBody: { orgCode: 'ORG99' },
          user: { id: 'u1', orgCode: 'USER01' },
        },
        mcpConfig: {
          'other-agent': {
            contextInjection: {
              my_tool: {
                resolve: [],
                inject: { org_code: 'orgCode' },
                hideFromSchema: ['org_code'],
              },
            },
          },
        },
      });
      expect(result.org_code).toBe('ORG99');
      expect(result.query).toBe('hello');
      expect(getDatDatasourceModel).not.toHaveBeenCalled();
    });

    it('prefers requestBody.orgCode over user.orgCode during injection', async () => {
      const result = await resolveAndInjectMcpContext({
        serverName: 'other-agent',
        toolName: 'my_tool',
        toolArguments: {},
        configurable: {
          requestBody: { orgCode: 'FROM_BODY' },
          user: { orgCode: 'FROM_USER' },
        },
        mcpConfig: {
          'other-agent': {
            contextInjection: {
              my_tool: {
                resolve: [],
                inject: { org_code: 'orgCode' },
              },
            },
          },
        },
      });
      expect(result.org_code).toBe('FROM_BODY');
    });

    it('falls back to user.orgCode when requestBody has no orgCode', async () => {
      const result = await resolveAndInjectMcpContext({
        serverName: 'other-agent',
        toolName: 'my_tool',
        toolArguments: {},
        configurable: {
          requestBody: {},
          user: { orgCode: 'FROM_USER' },
        },
        mcpConfig: {
          'other-agent': {
            contextInjection: {
              my_tool: {
                resolve: [],
                inject: { org_code: 'orgCode' },
              },
            },
          },
        },
      });
      expect(result.org_code).toBe('FROM_USER');
    });

    it('still requires datasource for becauseai-server ask_data and returns args when missing', async () => {
      getDatDatasourceModel.mockResolvedValue({
        findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        }),
      });

      const result = await resolveAndInjectMcpContext({
        serverName: 'becauseai-server',
        toolName: 'ask_data',
        toolArguments: { arg5: 'how many' },
        configurable: {
          requestBody: { orgCode: 'ORG99' },
          user: { id: 'u1', orgCode: 'USER01' },
        },
      });
      expect(result).toEqual({ arg5: 'how many' });
      expect(result.arg4).toBeUndefined();
    });
  });

  describe('org permission enforcement', () => {
    const orgOnlyConfig = {
      'other-agent': {
        contextInjection: {
          my_tool: {
            resolve: [],
            inject: { org_code: 'orgCode' },
          },
        },
      },
    };

    function enableEnforcement(units) {
      OrgPermissionSettings.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ enforcementEnabled: true }),
      });
      OrgPermissionUnit.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue(units),
      });
    }

    it('does not block when enforcement is off even if orgCode missing', async () => {
      const result = await resolveAndInjectMcpContext({
        serverName: 'other-agent',
        toolName: 'my_tool',
        toolArguments: { query: 'x' },
        configurable: { requestBody: {}, user: {} },
        mcpConfig: orgOnlyConfig,
      });
      expect(result).toEqual({ query: 'x' });
    });

    it('throws when enforcement on and orgCode missing', async () => {
      enableEnforcement([]);
      await expect(
        resolveAndInjectMcpContext({
          serverName: 'other-agent',
          toolName: 'my_tool',
          toolArguments: {},
          configurable: { requestBody: {}, user: {} },
          mcpConfig: orgOnlyConfig,
        }),
      ).rejects.toThrow(/未提供机构编码/);
    });

    it('throws when enforcement on and orgCode not in tree', async () => {
      enableEnforcement([
        { orgCode: 'FR001', brchLv: 1, enabled: true, parentOrgCode: null },
      ]);
      await expect(
        resolveAndInjectMcpContext({
          serverName: 'other-agent',
          toolName: 'my_tool',
          toolArguments: {},
          configurable: { requestBody: { orgCode: 'UNKNOWN' }, user: {} },
          mcpConfig: orgOnlyConfig,
        }),
      ).rejects.toThrow(/不存在、已禁用或未配置权限级别/);
    });

    it('allows known org and keeps single orgCode in inject (no dataScope rewrite)', async () => {
      enableEnforcement([
        { orgCode: 'FR001', brchLv: 1, enabled: true, parentOrgCode: null },
        { orgCode: 'B001', brchLv: 4, enabled: true, parentOrgCode: 'FR001' },
      ]);
      const result = await resolveAndInjectMcpContext({
        serverName: 'other-agent',
        toolName: 'my_tool',
        toolArguments: {},
        configurable: { requestBody: { orgCode: 'B001' }, user: {} },
        mcpConfig: orgOnlyConfig,
      });
      expect(result.org_code).toBe('B001');
    });

    it('never enforces tools whose inject map has no orgCode', async () => {
      enableEnforcement([]);
      const result = await resolveAndInjectMcpContext({
        serverName: 'other-agent',
        toolName: 'plain',
        toolArguments: { q: '1' },
        configurable: { requestBody: {}, user: {} },
        mcpConfig: {
          'other-agent': {
            contextInjection: {
              plain: {
                resolve: [],
                inject: { foo: 'question' },
              },
            },
          },
        },
      });
      expect(result).toEqual({ q: '1' });
    });
  });
});
