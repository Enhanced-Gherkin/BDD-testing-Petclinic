const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(process.cwd(), 'results');
const OUTPUT_DIR = path.join(process.cwd(), 'aggregated-stats');
const Z_CRITICAL = 1.96;

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function getLogFiles() {
    if (!fs.existsSync(LOGS_DIR)) return [];
    return fs.readdirSync(LOGS_DIR)
        .filter(f => f.startsWith('run-') && f.endsWith('.json') && !f.includes('overall'))
        .map(f => path.join(LOGS_DIR, f))
        .sort();
}

function readLogFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        console.warn(` Не удалось прочитать ${filePath}:`, e.message);
        return null;
    }
}

function computeStats(data) {
    const n = data.length;
    if (n === 0) return { mean: 0, variance: 0, std: 0, sem: 0, ciLower: 0, ciUpper: 0, min: 0, max: 0 };
    const mean = data.reduce((s, v) => s + v, 0) / n;
    const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    const std = Math.sqrt(variance);
    const sem = std / Math.sqrt(n);
    const margin = Z_CRITICAL * sem;
    return {
        mean,
        variance,
        std,
        sem,
        ciLower: mean - margin,
        ciUpper: mean + margin,
        min: Math.min(...data),
        max: Math.max(...data),
    };
}

function main() {
    try {
        const files = getLogFiles();
        if (files.length === 0) {
            console.error(` В папке ${LOGS_DIR} не найдено файлов run-*.json`);
            return;
        }

        const usedFiles = files;
        console.log(` Найдено ${files.length} файлов, используется ${usedFiles.length} прогонов.\n`);

        const runSummaries = [];
        const allTestEntries = [];

        for (const file of usedFiles) {
            const data = readLogFile(file);
            if (!data) continue;
            if (data.summary) {
                runSummaries.push({
                    sumDurationMs: data.summary.sumDurationMs || 0,
                    avgPeakMemoryMB: data.summary.avgPeakMemoryMB || 0,
                    avgCpuUserPercent: data.summary.avgCpuUserPercent || 0,
                    avgCpuSystemPercent: data.summary.avgCpuSystemPercent || 0,
                    passed: data.summary.passed || 0,
                    failed: data.summary.failed || 0,
                    totalTests: data.summary.totalTests || 0,
                });
            }
            if (data.testResults) {
                for (const test of data.testResults) {
                    allTestEntries.push({
                        testName: test.testName,
                        durationMs: test.durationMs || 0,
                        peakMemoryMB: test.peakMemoryMB || 0,
                        cpuUserPercent: test.cpuUserPercent !== undefined ? test.cpuUserPercent : 0,
                        cpuSystemPercent: test.cpuSystemPercent !== undefined ? test.cpuSystemPercent : 0,
                        status: test.status || 'failed',
                    });
                }
            }
        }

        if (runSummaries.length === 0) {
            console.warn(' Не найдено summary ни в одном файле.');
            return;
        }

        const sumDurationValues = runSummaries.map(s => s.sumDurationMs);
        const avgMemValues = runSummaries.map(s => s.avgPeakMemoryMB);
        const avgCpuUserValues = runSummaries.map(s => s.avgCpuUserPercent);
        const avgCpuSystemValues = runSummaries.map(s => s.avgCpuSystemPercent);
        const passedValues = runSummaries.map(s => s.passed);
        const failedValues = runSummaries.map(s => s.failed);

        const totalTestsPerRun = runSummaries.map(s => s.totalTests);
        const avgTotalTests = totalTestsPerRun.reduce((a, b) => a + b, 0) / totalTestsPerRun.length;

        const durationStats = computeStats(sumDurationValues);
        const memStats = computeStats(avgMemValues);
        const cpuUserStats = computeStats(avgCpuUserValues);
        const cpuSystemStats = computeStats(avgCpuSystemValues);
        const passedStats = computeStats(passedValues);
        const failedStats = computeStats(failedValues);

        const testGroups = {};
        for (const entry of allTestEntries) {
            if (!testGroups[entry.testName]) testGroups[entry.testName] = [];
            testGroups[entry.testName].push(entry);
        }

        const testStats = [];
        for (const [testName, entries] of Object.entries(testGroups)) {
            const durationData = entries.map(e => e.durationMs);
            const memData = entries.map(e => e.peakMemoryMB);
            const cpuUserData = entries.map(e => e.cpuUserPercent);
            const cpuSystemData = entries.map(e => e.cpuSystemPercent);
            const statusCount = entries.reduce((acc, e) => {
                acc[e.status] = (acc[e.status] || 0) + 1;
                return acc;
            }, {});

            testStats.push({
                testName,
                count: entries.length,
                statusCount,
                duration: computeStats(durationData),
                memory: computeStats(memData),
                cpuUser: computeStats(cpuUserData),
                cpuSystem: computeStats(cpuSystemData),
            });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const result = {
            timestamp,
            config: {
                totalLogFiles: files.length,
                usedLogFiles: usedFiles.length,
                confidenceLevel: 0.95,
                criticalValue: Z_CRITICAL,
            },
            summaryAcrossRuns: {
                avgSummary: {
                    totalTests: avgTotalTests,
                    passed: passedStats.mean,
                    failed: failedStats.mean,
                    sumDurationMs: durationStats.mean,
                    avgPeakMemoryMB: memStats.mean,
                    avgCpuUserPercent: cpuUserStats.mean,
                    avgCpuSystemPercent: cpuSystemStats.mean,
                },
                confidenceIntervals: {
                    sumDurationMs: durationStats,
                    avgPeakMemoryMB: memStats,
                    avgCpuUserPercent: cpuUserStats,
                    avgCpuSystemPercent: cpuSystemStats,
                },
            },
            testStats,
        };

        const outputFile = path.join(OUTPUT_DIR, `aggregated-stats-${timestamp}.json`);
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
        console.log(`JSON сохранён: ${outputFile}`);

        console.log('\n Сводка по прогонам:');
        console.log(` Количество прогонов: ${usedFiles.length}`);
        console.log(` Средняя суммарная длительность: ${durationStats.mean.toFixed(0)} мс (ДИ: ${durationStats.ciLower.toFixed(0)} – ${durationStats.ciUpper.toFixed(0)})`);
        console.log(` Среднее пиковое ОЗУ: ${memStats.mean.toFixed(2)} MB (ДИ: ${memStats.ciLower.toFixed(2)} – ${memStats.ciUpper.toFixed(2)})`);
        console.log(` Средний CPU User: ${cpuUserStats.mean.toFixed(2)} % (ДИ: ${cpuUserStats.ciLower.toFixed(2)} – ${cpuUserStats.ciUpper.toFixed(2)})`);
        console.log(` Средний CPU System: ${cpuSystemStats.mean.toFixed(2)} % (ДИ: ${cpuSystemStats.ciLower.toFixed(2)} – ${cpuSystemStats.ciUpper.toFixed(2)})`);
        console.log(` Среднее Passed: ${passedStats.mean.toFixed(1)} (ДИ: ${passedStats.ciLower.toFixed(1)} – ${passedStats.ciUpper.toFixed(1)})`);
        console.log(` Среднее Failed: ${failedStats.mean.toFixed(1)} (ДИ: ${failedStats.ciLower.toFixed(1)} – ${failedStats.ciUpper.toFixed(1)})`);

        console.log(`\n Статистика по ${testStats.length} тестам (выборочно первые 5):`);
        testStats.slice(0, 5).forEach((t, i) => {
            console.log(`  ${i+1}. ${t.testName}`);
            console.log(`  Длительность: сред. ${t.duration.mean.toFixed(0)} мс, ДИ: [${t.duration.ciLower.toFixed(0)}, ${t.duration.ciUpper.toFixed(0)}]`);
            console.log(`  ОЗУ: сред. ${t.memory.mean.toFixed(2)} MB, ДИ: [${t.memory.ciLower.toFixed(2)}, ${t.memory.ciUpper.toFixed(2)}]`);
            console.log(`  CPU User: сред. ${t.cpuUser.mean.toFixed(2)} %, ДИ: [${t.cpuUser.ciLower.toFixed(2)}, ${t.cpuUser.ciUpper.toFixed(2)}]`);
            console.log(`  CPU System: сред. ${t.cpuSystem.mean.toFixed(2)} %, ДИ: [${t.cpuSystem.ciLower.toFixed(2)}, ${t.cpuSystem.ciUpper.toFixed(2)}]`);
        });
        if (testStats.length > 5) console.log(`  ... и ещё ${testStats.length - 5} тестов.`);

        console.log(`\n ИТОГ:`);
        console.log(`  Суммарная длительность: ${durationStats.mean.toFixed(0)} мс (ДИ: ${durationStats.ciLower.toFixed(0)} – ${durationStats.ciUpper.toFixed(0)})`);
        console.log(`  Среднее пиковое ОЗУ: ${memStats.mean.toFixed(2)} MB (ДИ: ${memStats.ciLower.toFixed(2)} – ${memStats.ciUpper.toFixed(2)})`);
        console.log(`  Средний CPU User: ${cpuUserStats.mean.toFixed(2)} % (ДИ: ${cpuUserStats.ciLower.toFixed(2)} – ${cpuUserStats.ciUpper.toFixed(2)})`);
        console.log(`  Средний CPU System: ${cpuSystemStats.mean.toFixed(2)} % (ДИ: ${cpuSystemStats.ciLower.toFixed(2)} – ${cpuSystemStats.ciUpper.toFixed(2)})`);

        const csvLines = [
            ['Название теста', 'Кол-во прогонов',
             'Длительность_среднее', 'Длительность_дисперсия', 'Длительность_ДИ_нижн', 'Длительность_ДИ_верхн',
             'ОЗУ_среднее', 'ОЗУ_дисперсия', 'ОЗУ_ДИ_нижн', 'ОЗУ_ДИ_верхн',
             'CPU_User_среднее_%', 'CPU_User_дисперсия', 'CPU_User_ДИ_нижн_%', 'CPU_User_ДИ_верхн_%',
             'CPU_System_среднее_%', 'CPU_System_дисперсия', 'CPU_System_ДИ_нижн_%', 'CPU_System_ДИ_верхн_%']
        ];
        for (const t of testStats) {
            csvLines.push([
                t.testName,
                t.count,
                t.duration.mean, t.duration.variance, t.duration.ciLower, t.duration.ciUpper,
                t.memory.mean, t.memory.variance, t.memory.ciLower, t.memory.ciUpper,
                t.cpuUser.mean, t.cpuUser.variance, t.cpuUser.ciLower, t.cpuUser.ciUpper,
                t.cpuSystem.mean, t.cpuSystem.variance, t.cpuSystem.ciLower, t.cpuSystem.ciUpper,
            ]);
        }

        csvLines.push([
            'Итогово',
            usedFiles.length,
            durationStats.mean, durationStats.variance, durationStats.ciLower, durationStats.ciUpper,
            memStats.mean, memStats.variance, memStats.ciLower, memStats.ciUpper,
            cpuUserStats.mean, cpuUserStats.variance, cpuUserStats.ciLower, cpuUserStats.ciUpper,
            cpuSystemStats.mean, cpuSystemStats.variance, cpuSystemStats.ciLower, cpuSystemStats.ciUpper,
        ]);

        const csvContent = csvLines.map(row => row.join(',')).join('\n');
        const csvFile = path.join(OUTPUT_DIR, `aggregated-stats-${timestamp}.csv`);
        fs.writeFileSync(csvFile, csvContent, 'utf-8');
        console.log(`\n CSV-версия сохранена: ${csvFile}`);

    } catch (error) {
        console.error(' Ошибка при выполнении:', error);
    }
}

main();
