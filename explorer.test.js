const { normalize, parseInstructions, scanManual, generateGraph } = require('./explorer');
const fs = require('fs');
const path = require('path');

/**
 * Advanced Unit Testing with Mock Fixtures
 */

function testNormalize() {
    console.log('Running testNormalize...');
    const cases = [
        ['rv_zba', 'zba'],
        [' rv32_i ', 'i'],
        ['RV64_M', 'm'],
        ['Zicsr', 'zicsr'],
        [null, ''],
        [123, '']
    ];
    cases.forEach(([input, expected]) => {
        const result = normalize(input);
        if (result !== expected) {
            throw new Error(`Normalization failed for ${input}: expected "${expected}", got "${result}"`);
        }
    });
    console.log('testNormalize passed!');
}

function testParsingWithMock() {
    console.log('Running testParsingWithMock...');
    const mockFile = path.join(__dirname, 'mock_instr.json');
    const mockData = {
        "andn": { "extension": ["rv_zbb", "rv_zkn", "rv_zbb"] }, // Duplicate tag
        "add": { "extension": "rv_i" }, // String instead of array
        "unknown": {} // Missing extension
    };

    fs.writeFileSync(mockFile, JSON.stringify(mockData));

    try {
        const results = parseInstructions(mockFile);

        // Assert: zbb count = 1 (due to de-duplication)
        if (results.extensions['rv_zbb'].count !== 1) {
            throw new Error(`De-duplication failed: expected 1 for rv_zbb, got ${results.extensions['rv_zbb'].count}`);
        }

        // Assert: deterministic example selection
        if (results.extensions['rv_zbb'].example !== 'andn') {
            throw new Error('Example selection failed');
        }

        const isAndnMulti = results.multiExtInstructions.some(i => i.mnemonic === 'andn');
        if (!isAndnMulti) {
            throw new Error('Multi-extension detection failed for "andn"');
        }
    } finally {
        if (fs.existsSync(mockFile)) fs.unlinkSync(mockFile);
    }
    console.log('testParsingWithMock passed!');
}

function testScanManual() {
    console.log('Running testScanManual...');
    const mockDir = path.join(__dirname, 'mock_manual');
    if (!fs.existsSync(mockDir)) fs.mkdirSync(mockDir);
    const mockFile = path.join(mockDir, 'test.adoc');

    // Verify regex ignores ambiguous single letters (e.g., 'Standard' starting with 'S')
    // and matches lowercase prefixes correctly.
    fs.writeFileSync(mockFile, 'This uses zba. Standard formats apply. Ignore a Table.');

    try {
        const knownExts = ['rv_zba', 'rv_m', 'rv_s'];
        const results = scanManual(mockDir, knownExts);

        if (!results.has('zba')) throw new Error('Failed to find lowercase zba in mock manual');
        if (results.has('m')) throw new Error('Incorrectly identified lowercase "m" as extension');
        if (results.has('s')) throw new Error('Incorrectly identified "Standard" as extension');
        if (results.has('table')) throw new Error('Incorrectly identified "Table" as extension');
    } finally {
        if (fs.existsSync(mockFile)) fs.unlinkSync(mockFile);
        if (fs.existsSync(mockDir)) fs.rmdirSync(mockDir);
    }
    console.log('testScanManual passed!');
}

function testGenerateGraph() {
    const input = [
        { mnemonic: 'andn', extensions: ['rv_zbb', 'rv_zkn'] }
    ];
    const adj = generateGraph(input, true);

    if (!adj['zbb'] || !adj['zbb'].has('zkn')) throw new Error('Graph missing edge zbb -> zkn');
    if (!adj['zkn'] || !adj['zkn'].has('zbb')) throw new Error('Graph missing edge zkn -> zbb');
    console.log('testGenerateGraph passed!');
}

try {
    testNormalize();
    testParsingWithMock();
    testScanManual();
    testGenerateGraph();
    console.log('\nAll advanced tests passed successfully!');
} catch (err) {
    console.error('\nTest failed:', err.message);
    process.exit(1);
}
