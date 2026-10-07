// ── Navigation ─────────────────────────────────────────────────
document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
        if (btn.dataset.page === 'versions') loadVersionsList();
    });
});

// ── Load versions into select ──────────────────────────────────
async function loadVersions() {
    const sel = document.getElementById('version-select');
    const versions = await window.launcher.getVersions();
    sel.innerHTML = '';
    if (!versions.length) {
        sel.innerHTML = '<option value="">Nessuna versione trovata</option>';
        return;
    }
    // Prefer 1.8.9 fabric/legacy first
    const sorted = versions.sort((a, b) => {
        const score = v => v.includes('fabric') || v.includes('Fabric') ? -2
            : v.includes('1.8.9') ? -1 : 0;
        return score(a) - score(b);
    });
    sorted.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        sel.appendChild(opt);
    });
    // Restore saved
    const saved = localStorage.getItem('lastVersion');
    if (saved && sorted.includes(saved)) sel.value = saved;
}
loadVersions();

// ── Versions page ──────────────────────────────────────────────
async function loadVersionsList() {
    const list = document.getElementById('versions-list');
    list.innerHTML = '<div class="vl-loading">Caricamento...</div>';
    const versions = await window.launcher.getVersions();
    if (!versions.length) {
        list.innerHTML = '<div class="vl-loading">Nessuna versione installata trovata in .minecraft/versions</div>';
        return;
    }
    list.innerHTML = versions.map(v => `
        <div class="version-item">
            <div class="vi-icon">
                <svg viewBox="0 0 24 24"><path d="M20 6h-2.18c.07-.44.18-.88.18-1.34A4.66 4.66 0 0 0 13.34 0a4.66 4.66 0 0 0-3.3 1.36L12 3.32l1.96-1.96A2.67 2.67 0 0 1 13.34 1.33 3.34 3.34 0 0 1 16.67 4.66c0 .5-.13.97-.33 1.34H7.66c-.2-.37-.33-.84-.33-1.34A3.34 3.34 0 0 1 10.66 1.33c.46 0 .88.11 1.22.28L10 3.32 7.96 1.36A4.66 4.66 0 0 0 4.66 4.66C4.66 5.12 4.77 5.56 4.84 6H2v2h18zM3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2H3zM3 10v6h18v-6z"/></svg>
            </div>
            <div class="vi-info">
                <strong>${v}</strong>
                <span>${v.toLowerCase().includes('fabric') ? 'Legacy Fabric' : v.toLowerCase().includes('forge') ? 'Forge' : 'Vanilla'}</span>
            </div>
            <button class="vi-btn" onclick="selectAndGoHome('${v}')">Seleziona</button>
        </div>
    `).join('');
}

function selectAndGoHome(version) {
    document.getElementById('version-select').value = version;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('.nav-btn[data-page="home"]').classList.add('active');
    document.getElementById('page-home').classList.add('active');
    setStatus(`Versione ${version} selezionata`, 'ok');
}

// ── Live status from main process ─────────────────────────────
window.launcher.onStatus(msg => setStatus(msg));

// ── RAM slider ─────────────────────────────────────────────────
const ramSlider = document.getElementById('ram-slider');
const ramLabel  = document.getElementById('ram-label');

function updateSlider() {
    const v   = ramSlider.value;
    const min = ramSlider.min, max = ramSlider.max;
    const pct = ((v - min) / (max - min) * 100).toFixed(1) + '%';
    ramSlider.style.setProperty('--pct', pct);
    ramLabel.textContent = v;
    localStorage.setItem('ram', v);
}
ramSlider.value = localStorage.getItem('ram') || 2048;
ramSlider.addEventListener('input', updateSlider);
updateSlider();

// ── Username persistence ───────────────────────────────────────
const usernameInput = document.getElementById('username');
usernameInput.value = localStorage.getItem('username') || '';
usernameInput.addEventListener('input', () => localStorage.setItem('username', usernameInput.value));

// ── Launch ─────────────────────────────────────────────────────
const launchBtn  = document.getElementById('launch-btn');
const launchText = document.getElementById('launch-text');
const launchSpinner = document.getElementById('launch-spinner');

function setStatus(msg, type = '') {
    const el = document.getElementById('launch-status');
    el.textContent = msg;
    el.className = 'launch-status ' + type;
}

launchBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const version  = document.getElementById('version-select').value;
    const ram      = parseInt(ramSlider.value, 10);

    if (!username) { setStatus('Inserisci un username.', 'err'); return; }
    if (!version)  { setStatus('Seleziona una versione.', 'err'); return; }

    // Get extra JVM args from settings
    const extraRaw    = (document.getElementById('extra-jvm')?.value || '').split('\n');
    const extraJvmArgs = extraRaw.map(a => a.trim()).filter(Boolean);

    // Save last version
    localStorage.setItem('lastVersion', version);

    // UI: loading state
    launchBtn.disabled = true;
    launchText.textContent = 'AVVIO...';
    launchSpinner.classList.remove('hidden');
    setStatus(`Avvio Minecraft ${version}...`);

    const javaPath = localStorage.getItem('javaPath') || '';
    const result = await window.launcher.launch({ version, username, ram, extraJvmArgs, javaPath });

    launchBtn.disabled = false;
    launchText.textContent = 'GIOCA';
    launchSpinner.classList.add('hidden');

    if (result.ok) {
        setStatus(`Minecraft ${version} avviato come ${username}!`, 'ok');
        // Optionally minimize
        if (document.getElementById('close-on-launch')?.checked) {
            setTimeout(() => window.launcher.minimize(), 1500);
        }
    } else {
        setStatus(`Errore: ${result.error}`, 'err');
    }
});

// ── Settings save ──────────────────────────────────────────────
function saveSettings() {
    const extraJvm = document.getElementById('extra-jvm')?.value || '';
    const javaPath = document.getElementById('java-path')?.value || '';
    localStorage.setItem('extraJvm', extraJvm);
    localStorage.setItem('javaPath', javaPath);
    setStatus('Impostazioni salvate.', 'ok');
}

// Restore settings
document.addEventListener('DOMContentLoaded', () => {
    const extraJvm = document.getElementById('extra-jvm');
    if (extraJvm) extraJvm.value = localStorage.getItem('extraJvm') || '';
    const javaPath = document.getElementById('java-path');
    if (javaPath) javaPath.value = localStorage.getItem('javaPath') || '';
});
