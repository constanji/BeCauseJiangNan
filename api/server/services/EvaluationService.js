const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class EvaluationService {
  static async evaluate(benchmarkRoot, predictionsPath, datasetId, sqlDialect, metrics = ['EX'], onProgress = null) {
    const results = {};
    for (const metric of metrics) {
      try {
        const metricResult = await this.runEvaluationMetric(
          benchmarkRoot,
          metric,
          predictionsPath,
          datasetId,
          sqlDialect,
          onProgress,
        );
        results[metric] = metricResult;
      } catch (error) {
        console.error(`Error evaluating metric ${metric}:`, error);
        results[metric] = { error: error.message };
      }
    }
    return results;
  }

  static runEvaluationMetric(benchmarkRoot, metric, predictionsPath, datasetId, sqlDialect, onProgress) {
    return new Promise((resolve, reject) => {
      const scriptMap = {
        EX: 'evaluation_ex.py',
        'R-VES': 'evaluation_ves.py',
        'Soft F1': 'evaluation_f1.py',
      };
      const scriptName = scriptMap[metric];
      if (!scriptName) return reject(new Error(`Unknown metric: ${metric}`));

      const root = benchmarkRoot || path.join(__dirname, '../../benchmark');
      const scriptPath = path.join(root, 'evaluation', scriptName);
      const dbRootPath = path.join(root, 'data', 'dev_databases') + path.sep;
      const evaluationDir = path.join(root, 'evaluation');
      const groundTruthPath = predictionsPath.groundTruth;
      const diffJsonPath = predictionsPath.diffJsonl || path.join(path.dirname(predictionsPath.predictions), `${path.basename(predictionsPath.predictions, '_predictions.json')}_diff.jsonl`);

      fs.access(scriptPath)
        .then(() => {
          const pythonProcess = spawn(
            'python3',
            [
              scriptPath,
              '--predicted_sql_path',
              predictionsPath.predictions,
              '--ground_truth_path',
              groundTruthPath,
              '--db_root_path',
              dbRootPath,
              '--sql_dialect',
              sqlDialect,
              '--diff_json_path',
              diffJsonPath,
              '--num_cpus',
              '4',
              '--meta_time_out',
              '30.0',
            ],
            {
              cwd: evaluationDir,
              env: { ...process.env, PYTHONPATH: evaluationDir },
            },
          );

          let stdout = '';
          let stderr = '';

          pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            if (onProgress) onProgress(50);
          });
          pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });
          pythonProcess.on('close', (code) => {
            if (code !== 0) {
              console.error(`[EvaluationService] ${metric} script exited ${code}. stderr:`, stderr);
              return reject(new Error(`Evaluation script failed with code ${code}: ${stderr}`));
            }
            try {
              resolve(this.parseEvaluationOutput(stdout, metric));
            } catch (error) {
              console.error(`[EvaluationService] Failed to parse ${metric} output. stdout:`, stdout.slice(0, 500));
              reject(new Error(`Failed to parse evaluation output: ${error.message}`));
            }
          });
        })
        .catch((err) => {
          console.warn(`[EvaluationService] Python script not available or error for ${metric}:`, err?.message || err);
          this.runNodeJSEvaluation(metric, predictionsPath, datasetId, sqlDialect).then(resolve).catch(reject);
        });
    });
  }

  static async runNodeJSEvaluation(metric, predictionsPath, datasetId, sqlDialect) {
    return {
      metric,
      note: 'Node.js fallback evaluation (simplified)',
      accuracy: 0,
      simple: 0,
      moderate: 0,
      challenging: 0,
      total: 0,
      count_simple: 0,
      count_moderate: 0,
      count_challenging: 0,
    };
  }

  /**
   * 解析 Python 评估脚本 stdout。典型格式：
   *                      simple    moderate   challenging   total
   * count                3         22         7             32
   * ======================================    EX    =======
   * EX                   66.67     59.09      42.86         56.25
   *
   * - accuracy/simple/moderate/challenging：百分比分数
   * - total / count_simple / count_moderate / count_challenging：题目数量
   */
  static parseEvaluationOutput(output, metric) {
    const lines = output.split('\n');
    const result = {
      metric,
      accuracy: 0,
      simple: 0,
      moderate: 0,
      challenging: 0,
      total: 0,
      count_simple: 0,
      count_moderate: 0,
      count_challenging: 0,
    };

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (
        line.includes('simple') &&
        line.includes('moderate') &&
        line.includes('challenging') &&
        line.includes('total')
      ) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex >= 0) {
      // 紧随表头的 count 行：题目数量（simple / moderate / challenging / total）
      for (let i = headerIndex + 1; i < Math.min(headerIndex + 4, lines.length); i++) {
        const line = lines[i].trim();
        if (!line || line.includes('===')) continue;
        const parts = line.split(/\s+/).filter((p) => p.length > 0);
        if (parts[0] === 'count') {
          const counts = parts
            .slice(1)
            .map((p) => parseInt(p, 10))
            .filter((n) => !Number.isNaN(n));
          if (counts.length >= 4) {
            result.count_simple = counts[0];
            result.count_moderate = counts[1];
            result.count_challenging = counts[2];
            result.total = counts[3];
          }
          break;
        }
      }

      for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes('===') || line.length === 0) continue;
        if (/^count\b/i.test(line)) continue;

        const metricVariants = [metric === 'Soft F1' ? 'Soft-F1' : metric, metric].filter(Boolean);
        for (const metricName of metricVariants) {
          const metricPattern = new RegExp(`^${metricName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`);
          if (line.match(metricPattern)) {
            const regex = new RegExp(
              `${metricName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+\\.?\\d*)\\s+(\\d+\\.?\\d*)\\s+(\\d+\\.?\\d*)\\s+(\\d+\\.?\\d*)`,
            );
            const match = line.match(regex);
            if (match) {
              result.simple = parseFloat(match[1]) || 0;
              result.moderate = parseFloat(match[2]) || 0;
              result.challenging = parseFloat(match[3]) || 0;
              result.accuracy = parseFloat(match[4]) || 0;
              return result;
            }
            const parts = line.split(/\s+/).filter((p) => p.length > 0);
            const metricIndex = parts.findIndex((p) => p === metricName || p.startsWith(metricName));
            if (metricIndex >= 0) {
              const numbers = parts
                .slice(metricIndex + 1)
                .map((p) => parseFloat(p))
                .filter((n) => !Number.isNaN(n));
              if (numbers.length >= 4) {
                result.simple = numbers[0] || 0;
                result.moderate = numbers[1] || 0;
                result.challenging = numbers[2] || 0;
                result.accuracy = numbers[3] || 0;
                return result;
              }
            }
          }
        }
      }
    }

    // 兜底：仅当未解析到分数时，才从 "total: xx" 取总体准确率（避免误吃 count 行的 total）
    if (!result.accuracy) {
      const totalMatch = output.match(/(?:^|\n)\s*(?:EX|Soft-?F1|R-VES)\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+(\d+\.?\d*)/i);
      if (totalMatch) result.accuracy = parseFloat(totalMatch[1]);
    }
    return result;
  }
}

module.exports = EvaluationService;
