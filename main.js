const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const https  = require('https');
const http   = require('http');
const { spawn, execSync } = require('child_process');

const MINECRAFT_DIR = path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft');
const VERSIONS_DIR  = path.join(MINECRAFT_DIR, 'versions');
const MODS_DIR      = path.join(MINECRAFT_DIR, 'mods');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width:  1050,
        height: 650,
        minWidth:  900,
        minHeight: 560,
        frame:      false,
        transparent: false,
        backgroundColor: '#0f1117',
        webPreferences: {
            preload:          path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration:  false,
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        show: false,
    });
    mainWindow.loadFile('renderer/index.html');
    mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC ──────────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => app.quit());

ipcMain.handle('get-versions', () => {
    try {
        return fs.readdirSync(VERSIONS_DIR).filter(v => {
            const d = path.join(VERSIONS_DIR, v);
            return fs.statSync(d).isDirectory() &&
                   fs.existsSync(path.join(d, `${v}.json`));
        });
    } catch { return []; }
});

// ── Java ──────────────────────────────────────────────────────────────

function findJava(customPath) {
    if (customPath?.trim() && fs.existsSync(customPath.trim())) return customPath.trim();
    if (process.env.JAVA_HOME) {
        const j = path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe');
        if (fs.existsSync(j)) return j;
    }
    const candidates = [
        // JDK 8 (best for 1.8.9)
        'C:\\Program Files\\Eclipse Adoptium\\jdk-8.0.502.7-hotspot\\bin\\javaw.exe',
        'C:\\Program Files\\Java\\jre1.8.0_421\\bin\\javaw.exe',
        'C:\\Program Files\\Java\\jdk1.8.0_421\\bin\\javaw.exe',
        'C:\\Program Files\\Java\\jre-1.8\\bin\\javaw.exe',
        // Mojang bundled JREs
        path.join(MINECRAFT_DIR, 'runtime', 'jre-legacy', 'windows-x64', 'jre-legacy', 'bin', 'javaw.exe'),
        path.join(MINECRAFT_DIR, 'runtime', 'java-runtime-alpha', 'windows-x64', 'java-runtime-alpha', 'bin', 'javaw.exe'),
        path.join(MINECRAFT_DIR, 'runtime', 'java-runtime-beta',  'windows-x64', 'java-runtime-beta',  'bin', 'javaw.exe'),
        path.join(MINECRAFT_DIR, 'runtime', 'java-runtime-gamma', 'windows-x64', 'java-runtime-gamma', 'bin', 'javaw.exe'),
        // JDK 21 fallback
        path.join(os.homedir(), 'AppData', 'Local', 'jdk21', 'jdk-21.0.12.1+1', 'bin', 'javaw.exe'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    try { return execSync('where javaw 2>nul', { stdio: 'pipe' }).toString().trim().split('\n')[0].trim(); } catch {}
    return null;
}

// ── Download helper ───────────────────────────────────────────────────

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp  = dest + '.tmp';
        const file = fs.createWriteStream(tmp);
        const mod  = url.startsWith('https') ? https : http;
        const req  = mod.get(url, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                fs.unlink(tmp, () => {});
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(tmp, () => {});
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            res.pipe(file);
            file.on('finish', () => { file.close(() => { fs.renameSync(tmp, dest); resolve(); }); });
        });
        req.on('error', err => { fs.unlink(tmp, () => {}); reject(err); });
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

// ── Library helpers ───────────────────────────────────────────────────

function mavenToPath(name) {
    const parts = name.split(':');
    const [group, artifact, version, classifier] = parts;
    const fn = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`;
    return path.join(group.replace(/\./g, '/'), artifact, version, fn);
}

function evalRules(rules) {
    if (!rules?.length) return true;
    let inc = false;
    for (const r of rules) {
        if (!r.os || r.os.name === 'windows') inc = (r.action === 'allow');
    }
    return inc;
}

async function ensureLibraries(meta, onProgress) {
    const libDir = path.join(MINECRAFT_DIR, 'libraries');
    for (const lib of (meta.libraries || [])) {
        if (!evalRules(lib.rules)) continue;
        const art = lib.downloads?.artifact;
        if (!art?.url) continue;
        const dest = path.join(libDir, art.path);
        if (!fs.existsSync(dest)) {
            onProgress?.(`Scarico ${path.basename(art.path)}...`);
            try { await downloadFile(art.url, dest); } catch (e) {
                console.error('lib download failed', art.url, e.message);
            }
        }
    }
}

async function ensureNatives(meta, nativesDir) {
    if (fs.existsSync(nativesDir) && fs.readdirSync(nativesDir).some(f => f.endsWith('.dll'))) return;
    fs.mkdirSync(nativesDir, { recursive: true });
    const libDir = path.join(MINECRAFT_DIR, 'libraries');

    for (const lib of (meta.libraries || [])) {
        if (!evalRules(lib.rules)) continue;
        if (!lib.natives?.windows) continue;
        const key = lib.natives.windows.replace('${arch}', '64');
        const cls = lib.downloads?.classifiers?.[key];
        if (!cls) continue;
        const dest = path.join(libDir, cls.path);
        if (!fs.existsSync(dest)) {
            try { await downloadFile(cls.url, dest); } catch { continue; }
        }
        // Extract using PowerShell (JAR = ZIP)
        try {
            execSync(
                `powershell -Command "Add-Type -Assembly System.IO.Compression.FileSystem; ` +
                `$z=[System.IO.Compression.ZipFile]::OpenRead('${dest.replace(/\\/g,'/')}'); ` +
                `foreach($e in $z.Entries){ if($e.Name -match '\\.dll$' -or $e.Name -match '\\.so$'){ ` +
                `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,'${nativesDir.replace(/\\/g,'/')}/' + $e.Name,$true) } }; ` +
                `$z.Dispose()"`,
                { stdio: 'pipe' }
            );
        } catch (e) { console.error('natives extract failed', e.message); }
    }
}

function buildClasspath(meta, versionDir, clientJar) {
    const libDir = path.join(MINECRAFT_DIR, 'libraries');
    const cp = [];
    for (const lib of (meta.libraries || [])) {
        if (!evalRules(lib.rules)) continue;
        if (lib.downloads?.artifact?.path) {
            const p = path.join(libDir, lib.downloads.artifact.path);
            if (fs.existsSync(p)) { cp.push(p); continue; }
        }
        if (lib.name) {
            const p = path.join(libDir, mavenToPath(lib.name));
            if (fs.existsSync(p)) cp.push(p);
        }
    }
    cp.push(clientJar);
    return cp;
}

function resolveArg(a, vars) {
    return a.replace(/\$\{([^}]+)\}/g, (_, k) => vars[k] ?? '');
}

function buildGameArgs(meta, vars) {
    if (meta.arguments?.game) {
        return meta.arguments.game.filter(a => typeof a === 'string').map(a => resolveArg(a, vars));
    }
    if (meta.minecraftArguments) {
        return meta.minecraftArguments.split(' ').map(a => resolveArg(a, vars));
    }
    return [];
}

// ── Launch ────────────────────────────────────────────────────────────

ipcMain.handle('launch', async (_, { version, username, ram, extraJvmArgs, javaPath }) => {
    const versionDir = path.join(VERSIONS_DIR, version);
    const jsonPath   = path.join(versionDir, `${version}.json`);
    const clientJar  = path.join(versionDir, `${version}.jar`);

    if (!fs.existsSync(jsonPath))  return { ok: false, error: `JSON non trovato:\n${jsonPath}` };
    if (!fs.existsSync(clientJar)) return { ok: false, error: `JAR non trovato:\n${clientJar}` };

    const java = findJava(javaPath);
    if (!java) return { ok: false, error: 'Java non trovato. Vai in Impostazioni > Java Path.' };

    let meta;
    try { meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
    catch (e) { return { ok: false, error: `JSON non valido: ${e.message}` }; }

    const nativesDir = path.join(versionDir, `${version}-natives`);
    const assetsDir  = path.join(MINECRAFT_DIR, 'assets');
    const assetIndex = meta.assetIndex?.id || meta.assets || 'legacy';
    const mainClass  = meta.mainClass || 'net.minecraft.client.main.Main';

    // Send progress to renderer
    const sendStatus = msg => {
        try { mainWindow.webContents.send('launch-status', msg); } catch {}
    };

    sendStatus('Scarico librerie mancanti...');
    await ensureLibraries(meta, sendStatus);

    sendStatus('Estraggo natives...');
    await ensureNatives(meta, nativesDir);

    const cp = buildClasspath(meta, versionDir, clientJar);

    const vars = {
        auth_player_name:   username || 'Player',
        version_name:       version,
        game_directory:     MINECRAFT_DIR,
        assets_root:        assetsDir,
        assets_index_name:  assetIndex,
        auth_uuid:          '00000000-0000-0000-0000-000000000000',
        auth_access_token:  '0',
        user_type:          'legacy',
        user_properties:    '{}',
        version_type:       meta.type || 'release',
        classpath:          cp.join(';'),
        natives_directory:  nativesDir,
        launcher_name:      'BavaLauncher',
        launcher_version:   '1.0.0',
    };

    const jvmArgs = [
        `-Xmx${ram}M`,
        `-Xms${Math.min(512, ram)}M`,
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+DisableExplicitGC',
        '-XX:G1NewSizePercent=30',
        '-XX:G1MaxNewSizePercent=40',
        '-XX:G1HeapRegionSize=8M',
        '-XX:G1ReservePercent=20',
        '-XX:G1HeapWastePercent=5',
        '-XX:G1MixedGCCountTarget=4',
        '-XX:InitiatingHeapOccupancyPercent=15',
        '-XX:G1MixedGCLiveThresholdPercent=90',
        '-XX:G1RSetUpdatingPauseTimePercent=5',
        '-XX:SurvivorRatio=32',
        '-XX:+PerfDisableSharedMem',
        '-XX:MaxTenuringThreshold=1',
        `-Djava.library.path=${nativesDir}`,
        `-Dminecraft.launcher.brand=BavaLauncher`,
        `-Dminecraft.launcher.version=1.0.0`,
        ...(extraJvmArgs || []).filter(Boolean),
    ];

    const gameArgs = buildGameArgs(meta, vars);
    const allArgs  = [...jvmArgs, '-cp', cp.join(';'), mainClass, ...gameArgs];

    sendStatus(`Avvio con ${path.basename(java)}...`);

    return new Promise(resolve => {
        let done = false;
        let stderr = '';

        const proc = spawn(java, allArgs, {
            detached: false,
            cwd: MINECRAFT_DIR,
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        proc.stderr.on('data', d => { stderr += d.toString(); });

        // After 10s with no crash, assume success
        const timer = setTimeout(() => {
            if (!done) { done = true; proc.unref(); resolve({ ok: true }); }
        }, 10000);

        proc.on('error', err => {
            if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: err.message }); }
        });

        proc.on('exit', (code) => {
            if (!done) {
                done = true; clearTimeout(timer);
                const last = stderr.trim().split('\n').slice(-10).join('\n') || `exit code ${code}`;
                resolve({ ok: false, error: last });
            }
        });
    });
});

// Open folders
ipcMain.on('open-mods',   () => { fs.mkdirSync(MODS_DIR, { recursive: true }); shell.openPath(MODS_DIR); });
ipcMain.on('open-mc-dir', () => shell.openPath(MINECRAFT_DIR));
