const manifest = require('./manifest');

// Structured Tools (internal / no external API key)
const SqlExecutor = require('./structured/SqlExecutor');
const BeCauseSkills2 = require('./structured/BeCauseSkills2');
const GenerateExcel = require('./structured/GenerateExcel');
const EChartsGeneratorAPP = require('./structured/EChartsGeneratorAPP');

module.exports = {
  ...manifest,
  SqlExecutor,
  BeCauseSkills2,
  GenerateExcel,
  EChartsGeneratorAPP,
};
