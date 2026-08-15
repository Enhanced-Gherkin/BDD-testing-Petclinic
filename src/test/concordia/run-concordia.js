const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNS = 25;
const PROJECT_ROOT = process.cwd();
const METRICS_DIR = path.join(PROJECT_ROOT, 'results');
if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR, { recursive: true });

const configPath = path.join(PROJECT_ROOT, 'codecept.conf.js');
if (!fs.existsSync(configPath)) {
    console.error(' Файл codecept.conf.js не найден.');
    process.exit(1);
}

console.log('Генерация тестовых скриптов...');
try {
    execSync('npx concordia --just-script', { cwd: PROJECT_ROOT, stdio: 'inherit' });
} catch (err) {
    console.error('Ошибка генерации:', err);
    process.exit(1);
}
const srcDir = path.join(PROJECT_ROOT, 'test');

function buildNameMapping(testDir) {
    const mapping = {};
    const featuresDir = path.join(PROJECT_ROOT, 'features');
    if (!fs.existsSync(featuresDir)) return mapping;
    const featureFiles = fs.readdirSync(featuresDir).filter(f => f.endsWith('.feature'));
    for (const featureFile of featureFiles) {
        const baseName = path.basename(featureFile, '.feature');
        const jsFile = path.join(testDir, baseName + '.js');
        if (!fs.existsSync(jsFile)) continue;

        const content = fs.readFileSync(path.join(featuresDir, featureFile), 'utf-8');
        const lines = content.split('\n');
        const variants = [];
        let currentScenario = null;
        let currentVariant = null;
        let insideScenario = false;
        for (const line of lines) {
            const trimmed = line.trim();
            const scenarioMatch = trimmed.match(/^Scenario:\s*(.+)/);
            if (scenarioMatch) {
                currentScenario = scenarioMatch[1].trim();
                insideScenario = true;
                continue;
            }
            const variantMatch = trimmed.match(/^Variant:\s*(.+)/);
            if (variantMatch && insideScenario) {
                currentVariant = variantMatch[1].trim();
                if (currentScenario && currentVariant) {
                    variants.push({ scenarioName: currentScenario, variantName: currentVariant });
                }
                continue;
            }
        }
        if (variants.length === 0 && currentScenario) {
            variants.push({ scenarioName: currentScenario, variantName: null });
        }
        const jsContent = fs.readFileSync(jsFile, 'utf-8');
        const jsMatches = jsContent.matchAll(/Scenario\s*\(\s*["'`](.*?)["'`]/g);
        const jsNames = [];
        for (const match of jsMatches) {
            if (match[1]) jsNames.push(match[1].trim());
        }
        const count = Math.min(variants.length, jsNames.length);
        for (let i = 0; i < count; i++) {
            const fv = variants[i];
            let correctName;
            if (fv.variantName) {
                const suffix = jsNames[i].includes(' - 1') ? ' - 1' : '';
                correctName = `${fv.scenarioName} | ${fv.variantName}${suffix}`;
            } else {
                correctName = fv.scenarioName;
            }
            mapping[jsNames[i]] = correctName;
        }
    }
    return mapping;
}

function replaceScenarioNames(testDir) {
    const nameMapping = buildNameMapping(testDir);
    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const filePath = path.join(testDir, file);
        let content = fs.readFileSync(filePath, 'utf-8');
        let changed = false;
        const matches = content.matchAll(/Scenario\s*\(\s*["'`](.*?)["'`]/g);
        for (const match of matches) {
            const currentName = match[1].trim();
            const correctName = nameMapping[currentName];
            if (correctName && correctName !== currentName) {
                const oldStr = `Scenario("${currentName}"`;
                const newStr = `Scenario("${correctName}"`;
                content = content.replace(oldStr, newStr);
                changed = true;
            }
        }
        if (changed) {
            fs.writeFileSync(filePath, content, 'utf-8');
        }
    }
}
replaceScenarioNames(srcDir);
console.log(' Имена сценариев исправлены.');

const originalDir = path.join(PROJECT_ROOT, 'test_original');
if (!fs.existsSync(srcDir)) {
    console.error(' Папка test не найдена после генерации.');
    process.exit(1);
}
if (fs.existsSync(originalDir)) fs.rmSync(originalDir, { recursive: true, force: true });
fs.cpSync(srcDir, originalDir, { recursive: true });

function replaceInFiles(dir, from, to) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            replaceInFiles(fullPath, from, to);
        } else if (item.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf-8');
            content = content.replace(new RegExp(from, 'g'), to);
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }
}

console.log(`\nЗапуск ${RUNS} прогонов...`);

for (let i = 1; i <= RUNS; i++) {
    console.log(`\n Прогон ${i} из ${RUNS}...`);
    if (fs.existsSync(srcDir)) fs.rmSync(srcDir, { recursive: true, force: true });
    fs.cpSync(originalDir, srcDir, { recursive: true });

    replaceScenarioNames(srcDir);
    replaceInFiles(srcDir, 'Alice', `Alice_${i}`);

    const env = { ...process.env, RUN_INDEX: String(i) };
    try {
        execSync('npx codeceptjs run -c codecept.conf.js', {
            cwd: PROJECT_ROOT,
            stdio: 'inherit',
            env,
        });
        console.log(` Прогон ${i} завершён успешно.`);
    } catch (err) {
        console.error(` Прогон ${i} завершился с ошибкой (код ${err.status}).`);
    }
}
console.log(`\n Все ${RUNS} прогонов выполнены.`);
console.log(`Метрики сохранены в ${METRICS_DIR}`);
