const fs = require('fs');
const path = require('path');

/**
 * Normalizes extension tags for comparison.
 * Handles: trim, case-insensitivity, and stripping common RISC-V prefixes.
 */
function normalize(tag) {
    if (typeof tag !== 'string') return '';
    return tag
        .trim()
        .toLowerCase()
        .replace(/^rv(32|64)?_/, '');
}

/**
 * Tier 1: Instruction Set Parsing
 * Includes data validation and duplicate tag handling.
 */
function parseInstructions(jsonPath) {
    let data;
    try {
        const content = fs.readFileSync(jsonPath, 'utf8');
        data = JSON.parse(content);
    } catch (err) {
        throw new Error(`Failed to read or parse JSON: ${err.message}`);
    }

    const extensions = {};
    const multiExtInstructions = [];

    for (const [mnemonic, details] of Object.entries(data)) {
        if (!details || typeof details !== 'object') continue;

        let extTags = details.extension;
        if (typeof extTags === 'string') extTags = [extTags];
        if (!Array.isArray(extTags)) extTags = [];

        // De-duplicate tags for the same instruction
        const uniqueTags = [...new Set(extTags.map(t => t.trim()))];
        const normalizedTags = [...new Set(uniqueTags.map(normalize))].filter(Boolean);

        if (normalizedTags.length > 1) {
            multiExtInstructions.push({ mnemonic, extensions: uniqueTags });
        }

        uniqueTags.forEach(tag => {
            if (!extensions[tag]) {
                extensions[tag] = {
                    count: 0,
                    example: mnemonic,
                    example: mnemonic,
                    allMnemonics: []
                };
            }
            extensions[tag].count++;
            extensions[tag].allMnemonics.push(mnemonic);
        });
    }

    Object.keys(extensions).forEach(tag => {
        if (extensions[tag].allMnemonics.length > 0) {
            extensions[tag].example = extensions[tag].allMnemonics.sort()[0];
        }
    });

    return { extensions, multiExtInstructions };
}

function printTier1(results) {
    console.log('--- Tier 1: Instruction Set Parsing Summary ---');
    console.log(`${'Extension Tag'.padEnd(15)} | ${'Count'.padEnd(15)} | Example`);
    console.log('-'.repeat(50));

    Object.entries(results.extensions)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([tag, info]) => {
            console.log(`${tag.padEnd(15)} | ${info.count.toString().padEnd(12)} instructions | e.g. ${info.example.toUpperCase()}`);
        });

    if (results.multiExtInstructions.length > 0) {
        console.log('\nInstructions in multiple extensions:');
        results.multiExtInstructions.forEach(item => {
            console.log(`- ${item.mnemonic.toUpperCase()}: [${item.extensions.join(', ')}]`);
        });
    }
}

/**
 * Tier 2: Cross-Reference with the ISA Manual
 */
function scanManual(manualPath, jsonExtensions) {
    const manualExtensions = new Set();
    const files = getFiles(manualPath);
    const knownExtensions = new Set(jsonExtensions.map(normalize));

    // Matches strict uppercase single letters OR case-insensitive Z/S/X prefixed names
    const extRegex = /\b(?:[MSAFDCVQH]|[Zz][a-z0-9]+|[Ss][a-z0-9]+|[Xx][a-z0-9]+)\b/g;
    const falsePositives = new Set(['table', 'figure', 'version', 'index', 'note', 'the', 'a']);

    files.forEach(file => {
        if (!file.endsWith('.adoc')) return;
        try {
            const content = fs.readFileSync(file, 'utf8');
            const matches = content.match(extRegex);
            if (matches) {
                matches.forEach(m => {
                    const normalized = m.toLowerCase();
                    // We check normalized against the blocklist
                    if (knownExtensions.has(normalized) && !falsePositives.has(normalized)) {
                        manualExtensions.add(normalized);
                    }
                });
            }
        } catch (err) {
            console.warn(`Warning: Could not read file ${file}: ${err.message}`);
        }
    });

    return manualExtensions;
}

function getFiles(dir, fileList = []) {
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                getFiles(filePath, fileList);
            } else {
                fileList.push(filePath);
            }
        });
    } catch (err) {
        console.warn(`Warning: Could not access directory ${dir}: ${err.message}`);
    }
    return fileList;
}

function printTier2(jsonExtensions, manualExtensions) {
    const jsonNorm = new Set(jsonExtensions.map(normalize));
    const matched = [];
    const jsonOnly = [];

    jsonNorm.forEach(ext => {
        if (manualExtensions.has(ext)) {
            matched.push(ext);
        } else {
            jsonOnly.push(ext);
        }
    });

    const manualOnly = [...manualExtensions].filter(ext => !jsonNorm.has(ext));

    console.log('\n--- Tier 2: ISA Manual Cross-Reference ---');
    console.log(`Matched: ${matched.length}`);
    console.log(`In JSON only: ${jsonOnly.length}`);
    console.log(`In manual only: ${manualOnly.length}`);
    console.log(`Summary: ${matched.length} matched, ${jsonOnly.length} in JSON only, ${manualOnly.length} in manual only`);

    if (jsonOnly.length > 0) {
        console.log('\nExtensions in JSON but NOT found in Manual:');
        console.log(jsonOnly.sort().join(', '));
    }

    if (manualOnly.length > 0) {
        console.log('\nExtensions in Manual but NOT found in JSON:');
        console.log(manualOnly.sort().join(', '));
    }
}

/**
 * Tier 3: Relationship Graph
 */
function generateGraph(multiExtInstructions, quiet = false) {
    const adj = {};
    multiExtInstructions.forEach(item => {
        const exts = [...new Set(item.extensions.map(normalize))];
        for (let i = 0; i < exts.length; i++) {
            for (let j = i + 1; j < exts.length; j++) {
                const u = exts[i];
                const v = exts[j];
                if (!adj[u]) adj[u] = new Set();
                if (!adj[v]) adj[v] = new Set();
                adj[u].add(v);
                adj[v].add(u);
            }
        }
    });

    if (!quiet) {
        console.log('\n--- Tier 3: Bonus - Extension Relationship Graph (Shared Instructions) ---');
        if (Object.keys(adj).length === 0) {
            console.log('No extensions share instructions.');
        } else {
            console.log('Adjacency List (Normalized Extension A -> [Others]):');
            Object.keys(adj).sort().forEach(u => {
                console.log(`${u.padEnd(15)} -> [${[...adj[u]].sort().join(', ')}]`);
            });

            console.log('\nMermaid Diagram Source:');
            console.log('```mermaid');
            console.log('graph TD');
            const seenEdges = new Set();
            Object.keys(adj).sort().forEach(u => {
                adj[u].forEach(v => {
                    const edge = [u, v].sort().join('--');
                    if (!seenEdges.has(edge)) {
                        console.log(`  ${u} --- ${v}`);
                        seenEdges.add(edge);
                    }
                });
            });
            console.log('```');
        }
    }
    return adj;
}

if (require.main === module) {
    const jsonPath = path.join(__dirname, 'instr_dict.json');
    const manualPath = path.join(__dirname, 'riscv-isa-manual', 'src');

    try {
        if (!fs.existsSync(jsonPath)) throw new Error('instr_dict.json not found.');

        const results1 = parseInstructions(jsonPath);

        if (Object.keys(results1.extensions).length === 0) {
            console.warn('Warning: No extensions found in instr_dict.json.');
            process.exit(0);
        }

        printTier1(results1);

        const jsonExts = Object.keys(results1.extensions);
        let manualExts = new Set();

        if (fs.existsSync(manualPath)) {
            manualExts = scanManual(manualPath, jsonExts);
            printTier2(jsonExts, manualExts);
        } else {
            console.warn('Warning: riscv-isa-manual/src not found. Skipping Tier 2.');
        }

        generateGraph(results1.multiExtInstructions);
    } catch (err) {
        console.error(`Fatal Error: ${err.message}`);
        process.exit(1);
    }
}

module.exports = { parseInstructions, printTier1, scanManual, printTier2, normalize, generateGraph };
