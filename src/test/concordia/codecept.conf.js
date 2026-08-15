const { event } = require('codeceptjs');
const fs = require('fs');
const path = require('path');

let startTime;
let startCpu;
let peakMemory = 0;
const testMetrics = [];

event.dispatcher.on(event.test.before, function () {
    startTime = Date.now();
    startCpu = process.cpuUsage();
    peakMemory = process.memoryUsage().heapUsed;
});

event.dispatcher.on(event.test.after, function (test) {
    const duration = Date.now() - startTime;
    const cpuUsage = process.cpuUsage(startCpu);
    const memAfter = process.memoryUsage().heapUsed;
    if (memAfter > peakMemory) peakMemory = memAfter;

    const memPeakMB = peakMemory / 1024 / 1024;
    const cpuUserMs = cpuUsage.user / 1000;
    const cpuSystemMs = cpuUsage.system / 1000;
    const cpuUserPercent = duration > 0 ? (cpuUserMs / duration) * 100 : 0;
    const cpuSystemPercent = duration > 0 ? (cpuSystemMs / duration) * 100 : 0;

    const testName = test.title || 'unknown';
    const status = test.state === 'passed' ? 'passed' : 'failed';

    testMetrics.push({
        testName,
        status,
        durationMs: duration,
        peakMemoryMB: parseFloat(memPeakMB.toFixed(2)),
        cpuUserPercent: parseFloat(cpuUserPercent.toFixed(2)),
        cpuSystemPercent: parseFloat(cpuSystemPercent.toFixed(2)),
    });
});

event.dispatcher.on(event.all.after, function () {
    const runIndex = process.env.RUN_INDEX || '0';
    const outputDir = path.resolve(process.cwd(), 'results');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `run-${runIndex}-${timestamp}.json`;
    const filePath = path.join(outputDir, filename);

    const summary = {
        totalTests: testMetrics.length,
        passed: testMetrics.filter(r => r.status === 'passed').length,
        failed: testMetrics.filter(r => r.status === 'failed').length,
        sumDurationMs: testMetrics.reduce((s, r) => s + r.durationMs, 0),
        avgPeakMemoryMB: testMetrics.length ? parseFloat((testMetrics.reduce((s, r) => s + r.peakMemoryMB, 0) / testMetrics.length).toFixed(2)) : 0,
        maxPeakMemoryMB: testMetrics.length ? parseFloat(Math.max(...testMetrics.map(r => r.peakMemoryMB)).toFixed(2)) : 0,
        avgCpuUserPercent: testMetrics.length ? parseFloat((testMetrics.reduce((s, r) => s + r.cpuUserPercent, 0) / testMetrics.length).toFixed(2)) : 0,
        avgCpuSystemPercent: testMetrics.length ? parseFloat((testMetrics.reduce((s, r) => s + r.cpuSystemPercent, 0) / testMetrics.length).toFixed(2)) : 0,
        maxCpuUserPercent: testMetrics.length ? parseFloat(Math.max(...testMetrics.map(r => r.cpuUserPercent)).toFixed(2)) : 0,
        maxCpuSystemPercent: testMetrics.length ? parseFloat(Math.max(...testMetrics.map(r => r.cpuSystemPercent)).toFixed(2)) : 0,
    };

    fs.writeFileSync(filePath, JSON.stringify({ timestamp, summary, testResults: testMetrics }, null, 2), 'utf-8');
    console.log(`\n Метрики сохранены в ${filePath}`);
});

exports.config = {
    silent: true,
    tests: './test/*.js',
    output: './output',
    helpers: {
        Playwright: {
            url: 'http://localhost:8080',
            show: false,
            browser: 'chromium'
        }
    },
    include: {},
    mocha: {},
    bootstrap: async function () {
        console.log(' Инициализация тестов завершена');
    },
    name: 'concordia_tests'
};

