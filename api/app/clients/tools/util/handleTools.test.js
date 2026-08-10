const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const mockPluginService = {
  updateUserPluginAuth: jest.fn(),
  deleteUserPluginAuth: jest.fn(),
  getUserPluginAuthValue: jest.fn(),
};

jest.mock('~/server/services/PluginService', () => mockPluginService);

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    paths: { uploads: '/tmp' },
    fileStrategy: 'local',
    filteredTools: [],
    includedTools: [],
  }),
  getCachedTools: jest.fn().mockResolvedValue({
    calculator: {
      type: 'function',
      function: {
        name: 'calculator',
        description: 'Calculator',
        parameters: {},
      },
    },
  }),
}));

const { Calculator } = require('@because/agents');

const { User } = require('~/db/models');
const { validateTools, loadTools } = require('./handleTools');
const { availableTools } = require('../');

describe('Tool Handlers', () => {
  let mongoServer;
  let fakeUser;
  const pluginKey = 'calculator';
  const initialTools = [pluginKey, 'because_skills_2'];

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    mockPluginService.getUserPluginAuthValue.mockImplementation(() => null);

    fakeUser = new User({
      name: 'Fake User',
      username: 'fakeuser',
      email: 'fakeuser@example.com',
      emailVerified: false,
      password: 'fakepassword123',
      avatar: '',
      provider: 'local',
      role: 'USER',
      googleId: null,
      plugins: [],
      refreshToken: [],
    });
    await fakeUser.save();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateTools', () => {
    it('returns tools that do not require credentials', async () => {
      const validTools = await validateTools(fakeUser._id, initialTools);
      expect(validTools).toEqual(expect.arrayContaining(initialTools));
      expect(validTools.length).toBe(initialTools.length);
    });

    it('returns an empty array when no tools are provided', async () => {
      const validTools = await validateTools(fakeUser._id, []);
      expect(validTools).toEqual([]);
    });
  });

  describe('loadTools', () => {
    it('returns the expected load functions for requested tools', async () => {
      const sampleTools = ['calculator', 'because_skills_2'];
      const toolFunctions = await loadTools({
        user: fakeUser._id,
        tools: sampleTools,
        returnMap: true,
        useSpecs: true,
      });

      expect(toolFunctions.calculator).toBeDefined();
      expect(toolFunctions.because_skills_2).toBeDefined();

      const remainingTools = availableTools.filter(
        (tool) => sampleTools.indexOf(tool.pluginKey) === -1,
      );
      for (const tool of remainingTools) {
        expect(toolFunctions[tool.pluginKey]).toBeUndefined();
      }
    });

    it('should initialize calculator without authentication', async () => {
      const toolFunctions = await loadTools({
        user: fakeUser._id,
        tools: ['calculator'],
        returnMap: true,
        useSpecs: true,
      });
      const tool = await toolFunctions.calculator();
      expect(tool).toBeInstanceOf(Calculator);
    });

    it('passes agent chart_config to the ECharts tool schema', async () => {
      const toolFunctions = await loadTools({
        user: fakeUser._id,
        agent: {
          id: 'agent_chart_test',
          chart_config: { input_mode: 'simple' },
        },
        tools: ['echarts_generator_app'],
        returnMap: true,
        useSpecs: true,
      });

      const tool = await toolFunctions.echarts_generator_app();
      const simpleInput = {
        charts: [
          {
            id: 'chart_1',
            role: 'indicator',
            type: 'line',
            data: [{ data_dt: '2026-01', index_value: 1 }],
            xField: 'data_dt',
            yFields: ['index_value'],
            title: '指标趋势图',
          },
        ],
      };

      expect(tool.chartConfig).toEqual({ input_mode: 'simple' });
      expect(tool.schema.safeParse(simpleInput).success).toBe(true);
      expect(
        tool.schema.safeParse({
          charts: [{ id: 'chart_1', title: '旧协议', echartsOption: { series: [] } }],
        }).success,
      ).toBe(false);
    });

    it('returns an empty object when no tools are requested', async () => {
      const toolFunctions = await loadTools({
        user: fakeUser._id,
        returnMap: true,
        useSpecs: true,
      });
      expect(toolFunctions).toEqual({});
    });
  });
});
