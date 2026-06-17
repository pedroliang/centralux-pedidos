/**
 * Camera Module - Webcam capture with compression
 * Optimized for signature photos: lightweight but sharp
 */
const Camera = (() => {
    let _stream = null;
    let _videoEl = null;

    /**
     * Open webcam and attach to video element
     * @param {HTMLVideoElement} videoElement
     * @returns {Promise<MediaStream>}
     */
    async function open(videoElement) {
        try {
            // Prefer rear camera on mobile, any camera on desktop
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };

            _stream = await navigator.mediaDevices.getUserMedia(constraints);
            _videoEl = videoElement;
            videoElement.srcObject = _stream;
            await videoElement.play();
            console.log('[Camera] Opened successfully');
            return _stream;
        } catch (err) {
            console.error('[Camera] Failed to open:', err);
            throw new Error('Não foi possível acessar a câmera. Verifique as permissões.');
        }
    }

    /**
     * Capture photo from video stream and compress
     * @param {HTMLVideoElement} videoElement
     * @param {object} [options]
     * @param {number} [options.maxWidth=1024] - Max width in pixels
     * @param {number} [options.quality=0.65] - JPEG quality (0-1)
     * @returns {Promise<{blob: Blob, dataUrl: string}>}
     */
    async function capture(videoElement, options = {}) {
        const { maxWidth = 1024, quality = 0.65 } = options;
        const vw = videoElement.videoWidth;
        const vh = videoElement.videoHeight;

        if (!vw || !vh) throw new Error('Vídeo não está pronto');

        // Calculate dimensions maintaining aspect ratio
        let w = vw, h = vh;
        if (w > maxWidth) {
            h = Math.round(h * (maxWidth / w));
            w = maxWidth;
        }

        // Draw to canvas
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // Apply sharpening by drawing at original size then scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(videoElement, 0, 0, w, h);

        // Convert to JPEG blob with compression
        return new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => {
                    if (!blob) return reject(new Error('Falha ao capturar imagem'));
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    console.log(`[Camera] Captured: ${w}x${h}, ${(blob.size / 1024).toFixed(1)}KB`);
                    resolve({ blob, dataUrl });
                },
                'image/jpeg',
                quality
            );
        });
    }

    /**
     * Compress an existing image file/blob
     * @param {File|Blob} file
     * @param {object} [options]
     * @returns {Promise<{blob: Blob, dataUrl: string}>}
     */
    async function compressImage(file, options = {}) {
        const { maxWidth = 1024, quality = 0.65 } = options;

        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxWidth) {
                    h = Math.round(h * (maxWidth / w));
                    w = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);

                canvas.toBlob(
                    (blob) => {
                        URL.revokeObjectURL(url);
                        if (!blob) return reject(new Error('Falha ao comprimir'));
                        const dataUrl = canvas.toDataURL('image/jpeg', quality);
                        console.log(`[Camera] Compressed: ${w}x${h}, ${(blob.size / 1024).toFixed(1)}KB`);
                        resolve({ blob, dataUrl });
                    },
                    'image/jpeg',
                    quality
                );
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Falha ao carregar imagem'));
            };

            img.src = url;
        });
    }

    /**
     * Close webcam stream
     */
    function close() {
        if (_stream) {
            _stream.getTracks().forEach(track => track.stop());
            _stream = null;
        }
        if (_videoEl) {
            _videoEl.srcObject = null;
            _videoEl = null;
        }
        console.log('[Camera] Closed');
    }

    /**
     * Check if camera is available
     */
    function isAvailable() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    return { open, capture, compressImage, close, isAvailable };
})();
