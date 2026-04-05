const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://pkcalc.anastarawneh.com';
const SRC_IMG = path.join(__dirname, 'src', 'img');

// Parse data files to get IDs
function getIDs(file, indent) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const ids = [];
    const re = new RegExp(`^\\s{${indent}}(\\w+):\\s*\\{$`, 'gm');
    let m;
    while ((m = re.exec(src))) ids.push(m[1]);
    return ids;
}

const speciesIDs = getIDs('src/js/data/dex/species.js', 4);
const itemIDs = getIDs('src/js/data/dex/items.js', 4);
const typeIDs = getIDs('src/js/data/dex/types.js', 4);
const categoryIDs = ['physical', 'special', 'status'];

// Build download list: [relPath, url]
const downloads = [];

for (const id of speciesIDs) {
    downloads.push([`dex/large/species/${id}.png`, `${BASE_URL}/img/dex/large/species/${id}.png`]);
    // icon/species may already exist, but download if missing
    const iconPath = path.join(SRC_IMG, `dex/icon/species/${id}.png`);
    if (!fs.existsSync(iconPath)) {
        downloads.push([`dex/icon/species/${id}.png`, `${BASE_URL}/img/dex/icon/species/${id}.png`]);
    }
}

for (const id of typeIDs) {
    downloads.push([`dex/large/types/${id}.png`, `${BASE_URL}/img/dex/large/types/${id}.png`]);
    downloads.push([`dex/icon/types/${id}.png`, `${BASE_URL}/img/dex/icon/types/${id}.png`]);
}

for (const id of categoryIDs) {
    downloads.push([`dex/large/other/${id}.png`, `${BASE_URL}/img/dex/large/other/${id}.png`]);
}

for (const id of itemIDs) {
    downloads.push([`dex/icon/items/${id}.png`, `${BASE_URL}/img/dex/icon/items/${id}.png`]);
}

// Map images
downloads.push([`map/map.png`, `${BASE_URL}/img/map/map.png`]);
downloads.push([`map/cross.png`, `${BASE_URL}/img/map/cross.png`]);
downloads.push([`map/cursor.png`, `${BASE_URL}/img/map/cursor.png`]);

// Filter out already existing files
const needed = downloads.filter(([rel]) => !fs.existsSync(path.join(SRC_IMG, rel)));

console.log(`Total images in manifest: ${downloads.length}`);
console.log(`Already exist: ${downloads.length - needed.length}`);
console.log(`Need to download: ${needed.length}`);

if (needed.length === 0) {
    console.log('All images already present!');
    process.exit(0);
}

// Download with concurrency limit
const CONCURRENCY = 10;
let idx = 0;
let done = 0;
let failed = 0;
const failures = [];

function downloadFile(relPath, url) {
    return new Promise((resolve) => {
        const dest = path.join(SRC_IMG, relPath);
        const dir = path.dirname(dest);
        fs.mkdirSync(dir, { recursive: true });

        const get = url.startsWith('https') ? https.get : http.get;
        get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                // Follow redirect
                get(res.headers.location, (res2) => {
                    if (res2.statusCode !== 200) {
                        failures.push(`${relPath} (HTTP ${res2.statusCode})`);
                        failed++;
                        resolve();
                        return;
                    }
                    const ws = fs.createWriteStream(dest);
                    res2.pipe(ws);
                    ws.on('finish', () => { ws.close(); resolve(); });
                }).on('error', () => { failed++; failures.push(relPath); resolve(); });
                return;
            }
            if (res.statusCode !== 200) {
                failures.push(`${relPath} (HTTP ${res.statusCode})`);
                failed++;
                resolve();
                return;
            }
            const ws = fs.createWriteStream(dest);
            res.pipe(ws);
            ws.on('finish', () => { ws.close(); resolve(); });
        }).on('error', (err) => {
            failures.push(`${relPath} (${err.message})`);
            failed++;
            resolve();
        });
    });
}

async function worker() {
    while (idx < needed.length) {
        const i = idx++;
        const [rel, url] = needed[i];
        await downloadFile(rel, url);
        done++;
        if (done % 50 === 0 || done === needed.length) {
            console.log(`Progress: ${done}/${needed.length} (${failed} failed)`);
        }
    }
}

async function main() {
    console.log('Starting downloads...');
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);
    console.log(`\nDone! Downloaded: ${done - failed}, Failed: ${failed}`);
    if (failures.length > 0) {
        console.log('Failed files:');
        failures.forEach(f => console.log(`  - ${f}`));
    }
}

main();
