const manifest = require('./manifest');

// Structured Tools (internal / no external API key)
const BeCauseSkills2 = require('./structured/BeCauseSkills2');
const BeCauseSkills3 = require('./structured/BeCauseSkills3');
const BeCauseSkillsJN = require('./structured/BeCauseSkillsJN');
const GenerateExcel = require('./structured/GenerateExcel');
const EChartsGeneratorAPP = require('./structured/EChartsGeneratorAPP');

module.exports = {
  ...manifest,
  BeCauseSkills2,
  BeCauseSkills3,
  BeCauseSkillsJN,
  GenerateExcel,
  EChartsGeneratorAPP,
};
