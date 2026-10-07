// ─── FileForge Web ───────────────────────────────────────────────

class FileForgeWeb {
    constructor() {
        this.files = [];
        this.ffmpeg = null;
        this.ffmpegLoaded = false;
        this.ffmpegLoading = false;
        this.useMultithread = false;

        // DOM
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('fileInput');
        this.fileListContainer = document.getElementById('fileListContainer');
        this.fileCount = document.getElementById('fileCount');
        this.formatSelect = document.getElementById('formatSelect');
        this.qualityRange = document.getElementById('qualityRange');
        this.qualityValue = document.getElementById('qualityValue');
        this.convertBtn = document.getElementById('convertBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.resultsSection = document.getElementById('resultsSection');
        this.resultsContainer = document.getElementById('resultsContainer');
        this.resultTitle = document.getElementById('resultTitle');
        this.progressSection = document.getElementById('progressSection');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');

        this.init();
    }

    init() {
        // Drag & drop
        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadArea.classList.add('dragover');
        });

        this.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('dragover');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('dragover');
            this.addFiles(Array.from(e.dataTransfer.files));
        });

        this.uploadArea.addEventListener('click', (e) => {
            // Evita duplo clique quando o botão interno é clicado
            if (e.target.tagName !== 'BUTTON') {
                this.fileInput.click();
            }
        });

        this.fileInput.addEventListener('change', () => {
            this.addFiles(Array.from(this.fileInput.files));
            this.fileInput.value = '';
        });

        this.qualityRange.addEventListener('input', () => {
            this.qualityValue.textContent = this.qualityRange.value + '%';
        });

        this.convertBtn.addEventListener('click', () => this.convertFiles());
        this.clearBtn.addEventListener('click', () => this.clearAll());
    }

    // ─── FFMPEG LAZY LOAD ─────────────────────────────────────────
    async loadFFmpeg() {
        if (this.ffmpegLoaded) return;
        if (this.ffmpegLoading) {
            // Aguarda carregamento em andamento
            while (this.ffmpegLoading) {
                await new Promise(r => setTimeout(r, 100));
            }
            return;
        }

        this.ffmpegLoading = true;
        this.updateProgress(0, 'baixando ffmpeg (~30MB)...');

        const { FFmpeg } = FFmpegWASM;
        const { toBlobURL } = FFmpegUtil;

        this.ffmpeg = new FFmpeg();

        // Logs úteis no console
        this.ffmpeg.on('log', ({ message }) => {
            console.log('[ffmpeg]', message);
        });

        this.ffmpeg.on('progress', ({ progress, time }) => {
            const pct = Math.min(Math.max(progress * 100, 0), 100);
            this.updateProgress(pct, `convertendo... ${pct.toFixed(0)}%`);
        });

        // Tenta multithread primeiro (se SharedArrayBuffer estiver disponível)
        const canUseMT = typeof SharedArrayBuffer !== 'undefined'
                      && crossOriginIsolated === true;

        try {
            if (canUseMT) {
                const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd';
                await this.ffmpeg.load({
                    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                    workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
                });
                this.useMultithread = true;
                console.log('✅ FFmpeg multithread carregado');
            } else {
                throw new Error('SharedArrayBuffer indisponível, usando single-thread');
            }
        } catch (err) {
            console.warn('⚠️ Multithread falhou, usando single-thread:', err.message);
            const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
            await this.ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            this.useMultithread = false;
        }

        this.ffmpegLoaded = true;
        this.ffmpegLoading = false;
        this.updateProgress(100, 'ffmpeg pronto!');
    }

    // ─── PROGRESS ─────────────────────────────────────────────────
    updateProgress(percent, text) {
        this.progressSection.hidden = false;
        this.progressFill.style.width = `${percent}%`;
        this.progressText.textContent = text;
    }

    hideProgress() {
        this.progressSection.hidden = true;
        this.progressFill.style.width = '0%';
        this.progressText.textContent = '';
    }

    // ─── FILE MANAGEMENT ──────────────────────────────────────────
    addFiles(newFiles) {
        for (const file of newFiles) {
            if (!this.files.some(f => f.name === file.name && f.size === file.size)) {
                this.files.push(file);
            }
        }
        this.render();
    }

    removeFile(index) {
        this.files.splice(index, 1);
        this.render();
    }

    clearAll() {
        this.files = [];
        this.resultsSection.hidden = true;
        this.resultsContainer.innerHTML = '';
        this.hideProgress();
        this.render();
    }

    render() {
        this.fileCount.textContent = this.files.length;
        this.convertBtn.disabled = this.files.length === 0;

        if (this.files.length === 0) {
            this.fileListContainer.innerHTML = '<p class="empty-message">nenhum arquivo selecionado</p>';
            return;
        }

        let html = '';
        for (let i = 0; i < this.files.length; i++) {
            const f = this.files[i];
            const icon = this.getIcon(f);
            const size = this.formatSize(f.size);
            const type = f.type.split('/')[1] || f.name.split('.').pop() || '?';

            html += `
                <div class="file-item">
                    <div class="file-info">
                        <span class="icon">${icon}</span>
                        <span class="name">${this.escape(f.name)}</span>
                        <span class="size">${size}</span>
                        <span class="type">${this.escape(type)}</span>
                    </div>
                    <button class="remove-btn" data-index="${i}">✕</button>
                </div>
            `;
        }

        this.fileListContainer.innerHTML = html;

        this.fileListContainer.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.removeFile(parseInt(e.target.dataset.index));
            });
        });
    }

    getIcon(file) {
        if (file.type.startsWith('image/')) return '🖼️';
        if (file.type.startsWith('video/')) return '🎬';
        if (file.type === 'text/plain') return '📄';
        if (file.type === 'application/pdf') return '📕';
        return '📎';
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    escape(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    // ─── CONVERSÃO ────────────────────────────────────────────────

    async convertFiles() {
        if (this.files.length === 0) return;

        this.convertBtn.disabled = true;
        this.clearBtn.disabled = true;
        this.convertBtn.textContent = '⏳ convertendo...';
        this.resultsSection.hidden = true;
        this.resultsContainer.innerHTML = '';

        const format = this.formatSelect.value;
        const quality = parseInt(this.qualityRange.value) / 100;
        const results = [];

        // Pré-carrega FFmpeg apenas se houver vídeos
        const hasVideo = this.files.some(f => f.type.startsWith('video/'));
        if (hasVideo) {
            try {
                await this.loadFFmpeg();
            } catch (err) {
                alert('Erro ao carregar FFmpeg: ' + err.message);
                this.convertBtn.textContent = '⚡ converter';
                this.convertBtn.disabled = false;
                this.clearBtn.disabled = false;
                this.hideProgress();
                return;
            }
        }

        // Processa arquivos sequencialmente
        for (let i = 0; i < this.files.length; i++) {
            const file = this.files[i];
            this.updateProgress(
                (i / this.files.length) * 100,
                `convertendo ${i + 1}/${this.files.length}: ${file.name}`
            );

            try {
                const result = await this.convert(file, format, quality);
                results.push(result);
            } catch (err) {
                console.error(err);
                results.push({ name: file.name, success: false, error: err.message });
            }
        }

        this.updateProgress(100, 'concluído!');
        this.showResults(results);

        this.convertBtn.textContent = '⚡ converter';
        this.convertBtn.disabled = false;
        this.clearBtn.disabled = false;

        setTimeout(() => this.hideProgress(), 1500);
    }

    async convert(file, format, quality) {
        if (file.type.startsWith('image/')) {
            return this.convertImage(file, format, quality);
        }
        if (file.type.startsWith('video/')) {
            return this.convertVideo(file, format, quality);
        }
        if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
            return this.convertText(file, format);
        }
        return { name: file.name, success: false, error: 'formato não suportado' };
    }

    convertImage(file, format, quality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');

                    // Fundo branco para JPG (evita preto em PNGs transparentes)
                    if (format === 'jpg' || format === 'jpeg') {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }

                    ctx.drawImage(img, 0, 0);

                    const mime = `image/${format === 'jpg' ? 'jpeg' : format}`;
                    const dataUrl = canvas.toDataURL(mime, quality);
                    const baseName = file.name.replace(/\.[^.]+$/, '');
                    const outName = `${baseName}.${format}`;

                    resolve({
                        name: outName,
                        success: true,
                        dataUrl: dataUrl,
                        format: format,
                        isImage: true
                    });
                };
                img.onerror = () => reject(new Error('erro ao carregar imagem'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('erro ao ler arquivo'));
            reader.readAsDataURL(file);
        });
    }

    // ─── CONVERSÃO DE VÍDEO COM FFMPEG.WASM ──────────────────────
    async convertVideo(file, format, quality) {
        if (!this.ffmpegLoaded) {
            throw new Error('FFmpeg não carregado');
        }

        const inputExt = (file.name.split('.').pop() || 'mp4').toLowerCase();
        const inputName = `input_${Date.now()}.${inputExt}`;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const outputName = `output_${Date.now()}.${format}`;

        // Escreve arquivo na memória virtual do FFmpeg
        const fileData = new Uint8Array(await file.arrayBuffer());
        await this.ffmpeg.writeFile(inputName, fileData);

        // Constrói comando
        const args = this.buildFFmpegArgs(inputName, outputName, format, quality);

        try {
            await this.ffmpeg.exec(args);
        } catch (err) {
            // Limpeza em caso de erro
            try { await this.ffmpeg.deleteFile(inputName); } catch (_) {}
            throw new Error('falha na conversão: ' + err.message);
        }

        // Lê resultado
        const data = await this.ffmpeg.readFile(outputName);
        const mime = this.getMimeForFormat(format);
        const blob = new Blob([data.buffer], { type: mime });
        const dataUrl = URL.createObjectURL(blob);

        // Limpeza da memória virtual
        try { await this.ffmpeg.deleteFile(inputName); } catch (_) {}
        try { await this.ffmpeg.deleteFile(outputName); } catch (_) {}

        return {
            name: `${baseName}.${format}`,
            success: true,
            dataUrl: dataUrl,
            format: format,
            isImage: format === 'gif',
            isVideo: format === 'mp4' || format === 'webm'
        };
    }

    buildFFmpegArgs(input, output, format, quality) {
        // CRF: 18 (alta qualidade) → 40 (baixa qualidade)
        const crf = Math.round(40 - quality * 22);

        if (format === 'mp4') {
            return [
                '-i', input,
                '-c:v', 'libx264',
                '-crf', String(crf),
                '-preset', 'ultrafast',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                '-an',
                output
            ];
        }

        if (format === 'webm') {
            return [
                '-i', input,
                '-c:v', 'libvpx',
                '-crf', String(crf),
                '-b:v', '1M',
                '-deadline', 'realtime',
                '-cpu-used', '8',
                '-an',
                output
            ];
        }

        if (format === 'gif') {
            return [
                '-i', input,
                '-vf', 'fps=12,scale=480:-1:flags=lanczos',
                '-loop', '0',
                output
            ];
        }

        throw new Error(`formato de vídeo não suportado: ${format}`);
    }

    getMimeForFormat(format) {
        const map = {
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'gif': 'image/gif'
        };
        return map[format] || 'application/octet-stream';
    }

    convertText(file, format) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                let text = e.target.result;
                const baseName = file.name.replace(/\.[^.]+$/, '');
                const outName = `${baseName}.${format}`;

                if (format === 'md' && !text.trim().startsWith('#')) {
                    text = `# ${baseName}\n\n${text}`;
                }

                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const dataUrl = URL.createObjectURL(blob);

                resolve({
                    name: outName,
                    success: true,
                    dataUrl: dataUrl,
                    format: format,
                    isImage: false
                });
            };
            reader.onerror = () => reject(new Error('erro ao ler arquivo'));
            reader.readAsText(file);
        });
    }

    showResults(results) {
        this.resultsSection.hidden = false;
        let html = '';
        let ok = 0;

        for (const r of results) {
            if (r.success) {
                ok++;
                let preview = '';
                if (r.isImage && r.format !== 'gif') {
                    preview = `<img src="${r.dataUrl}" alt="${this.escape(r.name)}" class="preview">`;
                } else if (r.isVideo) {
                    preview = `<video src="${r.dataUrl}" class="preview" controls muted></video>`;
                } else if (r.format === 'gif') {
                    preview = `<img src="${r.dataUrl}" alt="${this.escape(r.name)}" class="preview">`;
                }
                html += `
                    <div class="result-item">
                        ${preview}
                        <strong>${this.escape(r.name)}</strong>
                        <a href="${r.dataUrl}" download="${this.escape(r.name)}" class="btn btn-primary">📥 baixar</a>
                    </div>
                `;
            } else {
                html += `
                    <div class="result-item" style="border-color:#e06b7a;">
                        <strong>❌ ${this.escape(r.name)}</strong>
                        <p style="color:#e06b7a;font-size:0.8rem;">${this.escape(r.error)}</p>
                    </div>
                `;
            }
        }

        this.resultTitle.textContent = `✅ ${ok} de ${results.length} arquivo(s) convertido(s)`;
        this.resultsContainer.innerHTML = html;
    }
}

document.addEventListener('DOMContentLoaded', () => new FileForgeWeb());