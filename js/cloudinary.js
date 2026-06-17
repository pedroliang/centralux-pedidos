/**
 * Cloudinary Module - Upload images directly from browser (unsigned)
 * Cloud: di2q3lieh
 * 
 * SETUP REQUIRED: Create an unsigned upload preset in Cloudinary Dashboard:
 * 1. Go to Settings > Upload > Upload presets
 * 2. Click "Add upload preset"
 * 3. Set "Signing Mode" to "Unsigned"
 * 4. Name it "centralux_pedidos"
 * 5. Optionally set folder to "centralux_pedidos"
 * 6. Save
 */
const CloudinaryUploader = (() => {
    const CLOUD_NAME = 'di2q3lieh';
    const UPLOAD_PRESET = 'centralux_pedidos';
    const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

    /**
     * Upload a Blob/File to Cloudinary
     * @param {Blob} blob - Image blob to upload
     * @param {string} [folder] - Optional folder name
     * @returns {Promise<object>} Cloudinary response with secure_url
     */
    async function upload(blob, folder = 'centralux_pedidos') {
        const formData = new FormData();
        formData.append('file', blob);
        formData.append('upload_preset', UPLOAD_PRESET);
        formData.append('folder', folder);


        try {
            const response = await fetch(UPLOAD_URL, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Upload failed (${response.status}): ${errText}`);
            }

            const data = await response.json();
            console.log('[Cloudinary] Upload success:', data.secure_url);
            return {
                url: data.secure_url,
                publicId: data.public_id,
                width: data.width,
                height: data.height,
                bytes: data.bytes,
                format: data.format
            };
        } catch (err) {
            console.error('[Cloudinary] Upload error:', err);
            throw err;
        }
    }

    /**
     * Get optimized thumbnail URL from a Cloudinary URL
     * @param {string} url - Original Cloudinary URL
     * @param {number} [width=150] - Thumbnail width
     * @returns {string} Transformed URL
     */
    function getThumbnail(url, width = 150) {
        if (!url || !url.includes('cloudinary.com')) return url;
        return url.replace('/upload/', `/upload/w_${width},h_${width},c_fill,q_auto,f_auto/`);
    }

    /**
     * Get optimized URL with specific width
     * @param {string} url - Original Cloudinary URL
     * @param {number} width - Desired width
     * @returns {string} Transformed URL
     */
    function getOptimized(url, width = 800) {
        if (!url || !url.includes('cloudinary.com')) return url;
        return url.replace('/upload/', `/upload/w_${width},q_auto,f_auto/`);
    }

    return { upload, getThumbnail, getOptimized };
})();
