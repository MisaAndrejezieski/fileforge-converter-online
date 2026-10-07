// ─── FileForge Web ───────────────────────────────────────────────

import { FFmpeg } from './ffmpeg/ffmpeg.mjs';

class FileForgeWeb {
    constructor() {
        this.files = [];
        this.ffmpeg = null;
        this.ffmpegLoaded = false;
        this.ffmpegLoading = false;
        this.ffmpegLoadPromise = null;
        this.isConverting = false;
        this.resultUrls = new Set();

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
        this.formatSelect.addEventListener('change', () => this.updateQualityAvailability());
        this.updateFormatOptions();
    }

    // ─── FFMPEG LAZY LOAD (self-hosted, multithread) ─────────────
    async loadFFmpeg() {
        if (this.ffmpegLoaded) return;
        if (this.ffmpegLoadPromise) return this.ffmpegLoadPromise;

        this.ffmpegLoading = true;
        this.updateProgress(0, 'carregando ffmpeg (~30MB)... aguarde');

        this.ffmpegLoadPromise = (async () => {
            try {
                if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
                    throw new Error(
                        'Este site precisa dos headers COOP/COEP para rodar o FFmpeg. ' +
                        'Use a Vercel ou um servidor com Cross-Origin-Opener-Policy: same-origin e ' +
                        'Cross-Origin-Embedder-Policy: require-corp.'
                    );
                }

                this.ffmpeg = new FFmpeg();

                this.ffmpeg.on('log', ({ message }) => console.log('[ffmpeg]', message));

                this.ffmpeg.on('progress', ({ progress }) => {
                    const pct = Math.min(Math.max(progress * 100, 0), 100);
                    this.updateProgress(pct, `convertendo... ${pct.toFixed(0)}%`);
                });

                const base = new URL('ffmpeg/', window.location.href).href;

                await this.ffmpeg.load({
                    coreURL: `${base}ffmpeg-core.js`,
                    wasmURL: `${base}ffmpeg-core.wasm`,
                    workerURL: `${base}ffmpeg-core.worker.js`,
                });

                this.ffmpegLoaded = true;
                console.log('✅ FFmpeg carregado (self-hosted, multithread)');
            } catch (err) {
                console.error('❌ Falha ao carregar FFmpeg:', err);
                throw new Error('falha ao carregar ffmpeg: ' + err.message);
            } finally {
                this.ffmpegLoading = false;
                this.ffmpegLoadPromise = null;
            }
        })();

        return this.ffmpegLoadPromise;
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
        if (this.isConverting) return;

        const unsupported = newFiles.filter(file => !this.getCategory(file));
        if (unsupported.length) {
            alert(`Formato não suportado: ${unsupported.map(f => f.name).join(', ')}`);
        }

        const supportedFiles = newFiles.filter(file => this.getCategory(file));
        const categories = new Set(supportedFiles.map(file => this.getCategory(file)));

        if (categories.size > 1 ||
            (categories.size === 1 && this.files.length &&
             !this.files.every(file => this.getCategory(file) === [...categories][0]))) {
            alert('Adicione arquivos de apenas um tipo por vez (imagens, vídeos ou textos).');
            return;
        }

        for (const file of supportedFiles) {
            if (!this.files.some(f => f.name === file.name && f.size === file.size)) {
                this.files.push(file);
            }
        }

        this.updateFormatOptions();
        this.render();
    }

    removeFile(index) {
        if (this.isConverting) return;
        this.files.splice(index, 1);
        this.updateFormatOptions();
        this.render();
    }

    clearAll() {
        if (this.isConverting) return;
        this.files = [];
        this.releaseResultUrls();
        this.resultsSection.hidden = true;
        this.resultsContainer.innerHTML = '';
        this.hideProgress();
        this.updateFormatOptions();
        this.render();
    }

    getCategory(file) {
        const name = file.name.toLowerCase();
        if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|avif)$/.test(name)) return 'image';
        if (file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|mpeg|mpg)$/.test(name)) return 'video';
        if (file.type === 'text/plain' || /\.(txt|md)$/.test(name)) return 'text';
        return null;
    }

    updateFormatOptions() {
        const category = this.files.length ? this.getCategory(this.files[0]) : null;
        const groups = [...this.formatSelect.querySelectorAll('optgroup[data-category]')];

        for (const group of groups) {
            group.disabled = Boolean(category && group.dataset.category !== category);
        }

        const selectedGroup = groups.find(group => group.dataset.category === category);
        if (selectedGroup && !selectedGroup.querySelector(`option[value="${this.formatSelect.value}"]`)) {
            this.formatSelect.value = selectedGroup.querySelector('option').value;
        } else if (!category && !groups.find(group => group.querySelector(`option[value="${this.formatSelect.value}"]`))) {
            this.formatSelect.value = 'png';
        }

        this.updateQualityAvailability();
    }

    updateQualityAvailability() {
        const isText = this.formatSelect.value === 'txt' || this.formatSelect.value === 'md';
        this.qualityRange.disabled = isText || this.isConverting;
    }

    releaseResultUrls() {
        for (const url of this.resultUrls) URL.revokeObjectURL(url);
        this.resultUrls.clear();
    }

    render() {
        this.fileCount.textContent = this.files.length;
        this.convertBtn.disabled = this.files.length === 0 || this.isConverting;
        this.clearBtn.disabled = this.isConverting;

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
                    <button class="remove-btn" data-index="${i}" ${this.isConverting ? 'disabled' : ''} aria-label="Remover ${this.escape(f.name)}">✕</button>
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
        return '📎';
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    escape(text) {
        return String(text).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    // ─── CONVERSÃO ────────────────────────────────────────────────

    async convertFiles() {
        if (this.files.length === 0 || this.isConverting) return;

        this.isConverting = true;
        const filesToConvert = [...this.files];
        this.fileInput.disabled = true;
        this.formatSelect.disabled = true;
        this.updateQualityAvailability();
        this.render();
        this.convertBtn.textContent = '⏳ convertendo...';
        this.releaseResultUrls();
        this.resultsSection.hidden = true;
        this.resultsContainer.innerHTML = '';

        const format = this.formatSelect.value;
        const quality = parseInt(this.qualityRange.value) / 100;
        const results = [];

        // Pré-carrega FFmpeg apenas se houver vídeos
        const hasVideo = filesToConvert.some(f => this.getCategory(f) === 'video');
        if (hasVideo) {
            try {
                await this.loadFFmpeg();
            } catch (err) {
                alert('Erro ao carregar FFmpeg: ' + err.message);
                this.convertBtn.textContent = '⚡ converter';
                this.isConverting = false;
                this.fileInput.disabled = false;
                this.formatSelect.disabled = false;
                this.updateQualityAvailability();
                this.render();
                this.hideProgress();
                return;
            }
        }

        // Processa arquivos sequencialmente
        for (let i = 0; i < filesToConvert.length; i++) {
            const file = filesToConvert[i];
            this.updateProgress(
                (i / filesToConvert.length) * 100,
                `convertendo ${i + 1}/${filesToConvert.length}: ${file.name}`
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
        this.isConverting = false;
        this.fileInput.disabled = false;
        this.formatSelect.disabled = false;
        this.updateQualityAvailability();
        this.render();

        setTimeout(() => this.hideProgress(), 1500);
    }

    async convert(file, format, quality) {
        const category = this.getCategory(file);

        if (category === 'image') {
            if (!['png', 'jpg', 'webp'].includes(format)) {
                return { name: file.name, success: false, error: 'formato incompatível com imagem' };
            }
            return this.convertImage(file, format, quality);
        }

        if (category === 'video') {
            if (!['mp4', 'webm', 'gif'].includes(format)) {
                return { name: file.name, success: false, error: 'formato incompatível com vídeo' };
            }
            return this.convertVideo(file, format, quality);
        }

        if (category === 'text') {
            if (!['txt', 'md'].includes(format)) {
                return { name: file.name, success: false, error: 'formato incompatível com texto' };
            }
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
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) throw new Error('não foi possível processar esta imagem');

                        if (format === 'jpg' || format === 'jpeg') {
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }

                        ctx.drawImage(img, 0, 0);

                        const mime = `image/${format === 'jpg' ? 'jpeg' : format}`;
                        const baseName = file.name.replace(/\.[^.]+$/, '');
                        const outName = `${baseName}.${format}`;

                        canvas.toBlob((blob) => {
                            if (!blob || blob.type !== mime) {
                                reject(new Error(`seu navegador não consegue gerar ${format.toUpperCase()}`));
                                return;
                            }
                            const dataUrl = URL.createObjectURL(blob);
                            this.resultUrls.add(dataUrl);
                            resolve({
                                name: outName,
                                success: true,
                                dataUrl,
                                format,
                                isImage: true
                            });
                        }, mime, quality);
                    } catch (err) {
                        reject(new Error(`falha ao processar imagem: ${err.message}`));
                    }
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
        const stamp = Date.now();
        const inputName = `input_${stamp}.${inputExt}`;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const outputName = `output_${stamp}.${format}`;

        let dataUrl;
        try {
            const fileData = new Uint8Array(await file.arrayBuffer());
            await this.ffmpeg.writeFile(inputName, fileData);

            const args = this.buildFFmpegArgs(inputName, outputName, format, quality);
            await this.ffmpeg.exec(args);

            const data = await this.ffmpeg.readFile(outputName);
            const mime = this.getMimeForFormat(format);
            const blob = new Blob([data.buffer], { type: mime });
            dataUrl = URL.createObjectURL(blob);
            this.resultUrls.add(dataUrl);
        } catch (err) {
            throw new Error('falha na conversão: ' + err.message);
        } finally {
            try { await this.ffmpeg.deleteFile(inputName); } catch (_) {}
            try { await this.ffmpeg.deleteFile(outputName); } catch (_) {}
        }

        return {
            name: `${baseName}.${format}`,
            success: true,
            dataUrl,
            format,
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
                '-c:a', 'aac',
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
                '-c:a', 'libvorbis',
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
                this.resultUrls.add(dataUrl);

                resolve({
                    name: outName,
                    success: true,
                    dataUrl,
                    format,
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
                if (r.format === 'gif' || (r.isImage && r.format !== 'gif')) {
                    preview = `<img src="${r.dataUrl}" alt="${this.escape(r.name)}" class="preview">`;
                } else if (r.isVideo) {
                    preview = `<video src="${r.dataUrl}" class="preview" controls muted></video>`;
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