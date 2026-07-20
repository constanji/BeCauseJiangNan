const { OpenAI } = require('openai');
const { decrypt } = require('../lib/crypto');

function sanitizeModelName(model) {
  return String(model || '')
    .replace(/\./g, '')
    .replace(/:/g, '')
    .trim();
}

function isEnabled(value) {
  if (value === true || value === 'true' || value === '1') return true;
  return false;
}

/**
 * Replicate LibreChat / getOpenAILLMConfig assembly for outbound chat.completions body.
 */
function assembleOpenAIRequest({
  model,
  messages,
  stream = true,
  max_tokens = 64,
  temperature = 0,
  endpointType = 'openai',
  azure = null,
  dropParams = [],
  addParams = {},
  useResponsesApi = false,
}) {
  const assemblyNotes = [];
  const body = {
    model: model ?? '',
    messages,
    stream,
    max_tokens,
    temperature,
  };

  if (addParams && typeof addParams === 'object') {
    for (const [key, value] of Object.entries(addParams)) {
      body[key] = value;
      assemblyNotes.push(`addParams: set ${key}`);
    }
  }

  if (Array.isArray(dropParams)) {
    for (const param of dropParams) {
      if (param in body) {
        delete body[param];
        assemblyNotes.push(`dropParams: removed ${param}`);
      }
    }
  }

  if (endpointType === 'google') {
    body.modelName = body.model;
    delete body.model;
    assemblyNotes.push('google: model → modelName');
  }

  if (endpointType === 'anthropic') {
    assemblyNotes.push('anthropic: OpenAI-compat proxy expected; model kept as-is');
  }

  if (endpointType === 'azure' || endpointType === 'azureOpenAI') {
    const useModelName = isEnabled(process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME);
    const deployment = useModelName
      ? sanitizeModelName(body.model || '')
      : azure?.azureOpenAIApiDeploymentName || body.model;

    if (useModelName) {
      assemblyNotes.push('azure: AZURE_USE_MODEL_AS_DEPLOYMENT_NAME → deployment from model');
    }

    if (process.env.AZURE_OPENAI_DEFAULT_MODEL) {
      body.model = process.env.AZURE_OPENAI_DEFAULT_MODEL;
      assemblyNotes.push(`azure: AZURE_OPENAI_DEFAULT_MODEL=${process.env.AZURE_OPENAI_DEFAULT_MODEL}`);
    } else {
      body.model = deployment;
      assemblyNotes.push(`azure: model → deploymentName (${deployment})`);
    }

    if (useResponsesApi) {
      delete body.model;
      assemblyNotes.push('azure responses API: removed model from body');
    }
  }

  return { body, assemblyNotes };
}

function createOpenAIClient(endpoint) {
  const apiKey = decrypt(endpoint.api_key_enc);
  return new OpenAI({
    apiKey,
    baseURL: endpoint.base_url,
    defaultHeaders: endpoint.extra_headers || undefined,
  });
}

function parseEndpointRow(row) {
  if (!row) return null;
  return {
    ...row,
    azure: row.azure_json ? JSON.parse(row.azure_json) : null,
    dropParams: row.drop_params_json ? JSON.parse(row.drop_params_json) : [],
    addParams: row.add_params_json ? JSON.parse(row.add_params_json) : {},
    extra_headers: row.extra_headers_json ? JSON.parse(row.extra_headers_json) : {},
  };
}

function l2Snapshot(body) {
  const snap = {};
  if (body.model != null) snap.model = body.model;
  if (body.modelName != null) snap.modelName = body.modelName;
  if (body.max_tokens != null) snap.max_tokens = body.max_tokens;
  if (body.stream != null) snap.stream = body.stream;
  return snap;
}

function l3FromResponse(responseModel, usage) {
  const l3 = {};
  if (responseModel) l3.model = responseModel;
  if (usage) {
    l3.prompt_tokens = usage.prompt_tokens ?? usage.input_tokens;
    l3.completion_tokens = usage.completion_tokens ?? usage.output_tokens;
    l3.total_tokens = usage.total_tokens;
  }
  return l3;
}

function identityMatch(l1, l2, l3) {
  const candidates = [l1, l2.model, l2.modelName, l3.model].filter(Boolean);
  if (candidates.length < 2) return true;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = norm(candidates[0]);
  return candidates.every((c) => norm(c) === base || norm(c).includes(base) || base.includes(norm(c)));
}

module.exports = {
  assembleOpenAIRequest,
  createOpenAIClient,
  parseEndpointRow,
  l2Snapshot,
  l3FromResponse,
  identityMatch,
  sanitizeModelName,
};
