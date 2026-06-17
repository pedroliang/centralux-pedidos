/**
 * App Module - Main application logic
 * Ties together all modules: Storage, Sheets, Camera, CloudinaryUploader, Report
 */
const App = (() => {
    let _editingOrderId = null;
    let _capturedPhoto = null; // { blob, dataUrl }
    let _currentPhotoOrderId = null; // for adding photo to existing order

    // ─── Initialize ────────────────────────────────────
    function init() {
        Sheets.init(); // pre-load spreadsheet data
        renderStats();
        Report.render(document.getElementById('report-container'));
        bindEvents();
        console.log('[App] Initialized');
    }

    // ─── Stats ─────────────────────────────────────────
    function renderStats() {
        const stats = Storage.getStats();
        document.getElementById('stat-total').textContent = stats.total;
        document.getElementById('stat-pendente').textContent = stats.pendente;
        document.getElementById('stat-separando').textContent = stats.separando;
        document.getElementById('stat-concluido').textContent = stats.concluido;
    }

    // ─── Event Bindings ────────────────────────────────
    function bindEvents() {
        // Sidebar toggle
        document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
            document.querySelector('.sidebar').classList.toggle('collapsed');
        });

        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            });
        });

        // New Order button
        document.getElementById('btn-new-order').addEventListener('click', openNewOrderModal);

        // Close modal
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', closeAllModals);
        });

        // Click outside modal to close
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeAllModals();
            });
        });

        // Order form submission
        document.getElementById('order-form').addEventListener('submit', handleOrderSubmit);

        // Code input auto-complete
        const codeInput = document.getElementById('order-code');
        let debounceTimer;
        codeInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleCodeInput(e.target.value), 300);
        });

        // Click event on autocomplete dropdown (event delegation)
        const dropdown = document.getElementById('code-autocomplete');
        dropdown.addEventListener('click', (e) => {
            const item = e.target.closest('.autocomplete-item');
            if (item) {
                const code = item.dataset.code;
                const desc = item.dataset.desc;
                selectCodeItem(code, desc);
            }
        });

        // On blur, do exact lookup on column A and auto-fill client, but delay closing the dropdown
        codeInput.addEventListener('blur', async () => {
            const code = codeInput.value.trim();
            setTimeout(() => {
                document.getElementById('code-autocomplete').classList.remove('show');
            }, 200);

            if (!code) return;
            const match = await Sheets.findByCode(code);
            if (match) {
                document.getElementById('order-client').value = match.description;
                // Auto-suggest vendor if client is known
                const vendor = Storage.getVendorForClient(match.description);
                if (vendor) {
                    const vendorSelect = document.getElementById('order-vendor');
                    const option = Array.from(vendorSelect.options).find(o => o.value === vendor);
                    if (option) vendorSelect.value = vendor;
                }
            }
        });

        codeInput.addEventListener('keydown', (e) => {
            handleAutocompleteNav(e, 'code-autocomplete');
        });

        // Client input - auto-suggest vendor
        document.getElementById('order-client').addEventListener('change', handleClientChange);
        document.getElementById('order-client').addEventListener('blur', handleClientChange);

        // Camera button
        document.getElementById('btn-camera').addEventListener('click', openCamera);

        // File upload
        document.getElementById('photo-file').addEventListener('change', handleFileUpload);

        // Add vendor
        document.getElementById('btn-add-vendor').addEventListener('click', handleAddVendor);

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllModals();
            if (e.key === 'n' && e.ctrlKey) {
                e.preventDefault();
                openNewOrderModal();
            }
        });
    }

    // Helper to escape HTML to prevent syntax errors and XSS
    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ─── Order Code Auto-Complete (ONLY column A - Cod.) ──────
    async function handleCodeInput(value) {
        const dropdown = document.getElementById('code-autocomplete');
        if (!value || value.length < 1) {
            dropdown.classList.remove('show');
            return;
        }

        // Check for exact match first → auto-fill immediately
        const exactMatch = await Sheets.findByCode(value.trim());
        if (exactMatch) {
            document.getElementById('order-client').value = exactMatch.description;
            dropdown.classList.remove('show');
            // Auto-suggest vendor if client is known
            const vendor = Storage.getVendorForClient(exactMatch.description);
            if (vendor) {
                const vendorSelect = document.getElementById('order-vendor');
                const option = Array.from(vendorSelect.options).find(o => o.value === vendor);
                if (option) {
                    vendorSelect.value = vendor;
                    showToast(`Vendedor "${vendor}" selecionado automaticamente`, 'info');
                }
            }
            return;
        }

        // Partial match: search only by code prefix (column A)
        const results = await Sheets.searchByCode(value);
        if (results.length === 0) {
            dropdown.classList.remove('show');
            return;
        }

        dropdown.innerHTML = results.map((item, i) => `
            <div class="autocomplete-item ${i === 0 ? 'highlighted' : ''}"
                 data-code="${escapeHtml(item.code)}" data-desc="${escapeHtml(item.description)}"> 
                <span class="ac-code">${escapeHtml(item.code)}</span>
                <span class="ac-desc">${escapeHtml(item.description)}</span>
            </div>
        `).join('');
        dropdown.classList.add('show');
    }

    function selectCodeItem(code, description) {
        document.getElementById('order-code').value = code;
        document.getElementById('order-client').value = description;
        document.getElementById('code-autocomplete').classList.remove('show');

        // Check if client has a mapped vendor
        const vendor = Storage.getVendorForClient(description);
        if (vendor) {
            const vendorSelect = document.getElementById('order-vendor');
            // Check if vendor exists in select options
            const option = Array.from(vendorSelect.options).find(o => o.value === vendor);
            if (option) {
                vendorSelect.value = vendor;
                showToast(`Vendedor "${vendor}" selecionado automaticamente`, 'info');
            }
        }
    }

    function handleAutocompleteNav(e, dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown.classList.contains('show')) return;

        const items = dropdown.querySelectorAll('.autocomplete-item');
        const highlighted = dropdown.querySelector('.autocomplete-item.highlighted');
        let idx = Array.from(items).indexOf(highlighted);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            idx = Math.min(idx + 1, items.length - 1);
            items.forEach(i => i.classList.remove('highlighted'));
            items[idx].classList.add('highlighted');
            items[idx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            idx = Math.max(idx - 1, 0);
            items.forEach(i => i.classList.remove('highlighted'));
            items[idx].classList.add('highlighted');
            items[idx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && highlighted) {
            e.preventDefault();
            highlighted.click();
        }
    }

    // ─── Client → Vendor Auto-Suggest ──────────────────
    function handleClientChange(e) {
        const client = e.target.value;
        if (!client) return;

        const vendor = Storage.getVendorForClient(client);
        if (vendor) {
            const vendorSelect = document.getElementById('order-vendor');
            const option = Array.from(vendorSelect.options).find(o => o.value === vendor);
            if (option) {
                vendorSelect.value = vendor;
            }
        }
    }

    // ─── Modal Management ──────────────────────────────
    function openNewOrderModal() {
        _editingOrderId = null;
        _capturedPhoto = null;
        resetOrderForm();
        populateVendorSelect();

        document.getElementById('modal-title').textContent = 'Novo Pedido';
        document.getElementById('btn-submit-text').textContent = 'Salvar Pedido';
        document.getElementById('order-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('modal-order').classList.add('active');
        document.getElementById('order-code').focus();
    }

    function openEditOrderModal(order) {
        _editingOrderId = order.id;
        _capturedPhoto = null;
        populateVendorSelect();

        document.getElementById('modal-title').textContent = 'Editar Pedido';
        document.getElementById('btn-submit-text').textContent = 'Atualizar Pedido';
        document.getElementById('order-code').value = order.code || '';
        document.getElementById('order-client').value = order.client || '';
        document.getElementById('order-vendor').value = order.vendor || '';
        document.getElementById('order-priority').value = order.priority || 'normal';
        document.getElementById('order-delivery').checked = order.isDelivery || false;
        document.getElementById('order-date').value = order.orderDate || '';

        // Show existing photo if any
        if (order.photos && order.photos.length > 0) {
            showPhotoPreview(order.photos[0].url);
        }

        document.getElementById('modal-order').classList.add('active');
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        Camera.close();
        _capturedPhoto = null;
        document.getElementById('code-autocomplete').classList.remove('show');
    }

    function resetOrderForm() {
        document.getElementById('order-form').reset();
        document.getElementById('photo-preview-container').innerHTML = '';
        document.getElementById('code-autocomplete').classList.remove('show');
    }

    // ─── Vendor Management ─────────────────────────────
    function populateVendorSelect() {
        const select = document.getElementById('order-vendor');
        const vendors = Storage.getVendors();
        const currentValue = select.value;

        // Clear and re-populate
        select.innerHTML = '<option value="">Selecione o vendedor</option>';
        vendors.sort((a, b) => a.localeCompare(b, 'pt-BR'));
        vendors.forEach(v => {
            select.innerHTML += `<option value="${v}">${v}</option>`;
        });

        if (currentValue) select.value = currentValue;
    }

    function handleAddVendor() {
        const input = document.getElementById('new-vendor-name');
        const name = input.value.trim();
        if (!name) {
            input.focus();
            return;
        }

        if (Storage.addVendor(name)) {
            populateVendorSelect();
            document.getElementById('order-vendor').value = name;
            input.value = '';
            showToast(`Vendedor "${name}" adicionado!`, 'success');
        } else {
            showToast('Vendedor já existe', 'error');
        }
    }

    // ─── Order Submit ──────────────────────────────────
    async function handleOrderSubmit(e) {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-submit-order');
        submitBtn.disabled = true;

        const orderData = {
            code: document.getElementById('order-code').value.trim(),
            client: document.getElementById('order-client').value.trim(),
            vendor: document.getElementById('order-vendor').value,
            priority: document.getElementById('order-priority').value,
            isDelivery: document.getElementById('order-delivery').checked,
            orderDate: document.getElementById('order-date').value,
            status: 'pendente',
            photos: []
        };

        // Upload photo if captured
        if (_capturedPhoto) {
            try {
                showToast('Enviando foto...', 'info');
                const result = await CloudinaryUploader.upload(_capturedPhoto.blob);
                orderData.photos = [{ url: result.url, publicId: result.publicId, uploadedAt: new Date().toISOString() }];
            } catch (err) {
                showToast('Erro ao enviar foto: ' + err.message, 'error');
                submitBtn.disabled = false;
                return;
            }
        }

        try {
            if (_editingOrderId) {
                // Keep existing photos if no new one captured
                const existing = Storage.getOrderById(_editingOrderId);
                if (!_capturedPhoto && existing && existing.photos) {
                    orderData.photos = existing.photos;
                }
                orderData.status = existing ? existing.status : 'pendente';
                Storage.updateOrder(_editingOrderId, orderData);
                showToast('Pedido atualizado!', 'success');
            } else {
                Storage.saveOrder(orderData);
                showToast('Pedido cadastrado!', 'success');
            }

            closeAllModals();
            renderStats();
            Report.render(document.getElementById('report-container'));
        } catch (err) {
            showToast('Erro ao salvar: ' + err.message, 'error');
        }

        submitBtn.disabled = false;
    }

    // ─── Camera ────────────────────────────────────────
    async function openCamera() {
        if (!Camera.isAvailable()) {
            showToast('Câmera não disponível neste dispositivo', 'error');
            return;
        }

        const cameraModal = document.getElementById('modal-camera');
        cameraModal.classList.add('active');

        const video = document.getElementById('camera-video');
        const btnCapture = document.getElementById('btn-capture');
        const btnRetake = document.getElementById('btn-retake');
        const btnConfirm = document.getElementById('btn-confirm-photo');
        const preview = document.getElementById('camera-captured');

        preview.style.display = 'none';
        video.style.display = 'block';
        btnCapture.style.display = 'flex';
        btnRetake.style.display = 'none';
        btnConfirm.style.display = 'none';

        try {
            await Camera.open(video);
        } catch (err) {
            showToast(err.message, 'error');
            cameraModal.classList.remove('active');
        }

        // Capture
        btnCapture.onclick = async () => {
            try {
                const result = await Camera.capture(video, { maxWidth: 1024, quality: 0.65 });
                _capturedPhoto = result;
                preview.src = result.dataUrl;
                preview.style.display = 'block';
                video.style.display = 'none';
                btnCapture.style.display = 'none';
                btnRetake.style.display = 'flex';
                btnConfirm.style.display = 'flex';
                Camera.close();
            } catch (err) {
                showToast('Erro ao capturar: ' + err.message, 'error');
            }
        };

        // Retake
        btnRetake.onclick = async () => {
            _capturedPhoto = null;
            preview.style.display = 'none';
            video.style.display = 'block';
            btnCapture.style.display = 'flex';
            btnRetake.style.display = 'none';
            btnConfirm.style.display = 'none';
            try {
                await Camera.open(video);
            } catch (err) {
                showToast(err.message, 'error');
            }
        };

        // Confirm photo
        btnConfirm.onclick = () => {
            cameraModal.classList.remove('active');
            Camera.close();

            // If adding photo to existing order
            if (_currentPhotoOrderId) {
                uploadAndAttachPhoto(_currentPhotoOrderId);
                return;
            }

            // Show preview in order form
            if (_capturedPhoto) {
                showPhotoPreview(_capturedPhoto.dataUrl);
            }
        };
    }

    function showPhotoPreview(src) {
        const container = document.getElementById('photo-preview-container');
        container.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
                <img src="${src}" class="photo-preview-thumb" alt="Preview" />
                <span style="color:var(--accent);font-size:0.8rem;font-weight:600;">Foto capturada ✓</span>
            </div>
        `;
    }

    // ─── File Upload Handler ───────────────────────────
    async function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const result = await Camera.compressImage(file, { maxWidth: 1024, quality: 0.65 });
            _capturedPhoto = result;
            showPhotoPreview(result.dataUrl);
            showToast('Foto carregada!', 'info');
        } catch (err) {
            showToast('Erro ao carregar foto: ' + err.message, 'error');
        }
    }

    // ─── Order Actions ─────────────────────────────────
    function editOrder(id) {
        const order = Storage.getOrderById(id);
        if (!order) return;
        openEditOrderModal(order);
    }

    function cycleStatus(id) {
        const order = Storage.getOrderById(id);
        if (!order) return;

        const statusCycle = ['pendente', 'separando', 'concluido'];
        const currentIdx = statusCycle.indexOf(order.status);
        const nextStatus = statusCycle[(currentIdx + 1) % statusCycle.length];

        Storage.updateOrder(id, { status: nextStatus });
        renderStats();
        Report.render(document.getElementById('report-container'));
        showToast(`Status alterado para: ${nextStatus.toUpperCase()}`, 'info');
    }

    function addPhotoToOrder(id) {
        _currentPhotoOrderId = id;
        openCamera();
    }

    async function uploadAndAttachPhoto(orderId) {
        if (!_capturedPhoto) return;

        try {
            showToast('Enviando foto...', 'info');
            const result = await CloudinaryUploader.upload(_capturedPhoto.blob);
            const order = Storage.getOrderById(orderId);
            const photos = order.photos || [];
            photos.push({ url: result.url, publicId: result.publicId, uploadedAt: new Date().toISOString() });
            Storage.updateOrder(orderId, { photos });
            showToast('Foto adicionada ao pedido!', 'success');
            Report.render(document.getElementById('report-container'));
        } catch (err) {
            showToast('Erro ao enviar foto: ' + err.message, 'error');
        }

        _currentPhotoOrderId = null;
        _capturedPhoto = null;
    }

    function viewPhoto(url) {
        const modal = document.getElementById('modal-photo');
        const optimizedUrl = typeof CloudinaryUploader !== 'undefined' ? CloudinaryUploader.getOptimized(url, 800) : url;
        document.getElementById('photo-viewer-img').src = optimizedUrl;
        modal.classList.add('active');
    }

    function confirmDelete(id) {
        const modal = document.getElementById('modal-confirm');
        modal.classList.add('active');

        document.getElementById('btn-confirm-yes').onclick = () => {
            Storage.deleteOrder(id);
            modal.classList.remove('active');
            renderStats();
            Report.render(document.getElementById('report-container'));
            showToast('Pedido excluído', 'success');
        };

        document.getElementById('btn-confirm-no').onclick = () => {
            modal.classList.remove('active');
        };
    }

    // ─── Toast Notifications ───────────────────────────
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const icons = { success: 'check_circle', error: 'error', info: 'info' };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="material-symbols-outlined">${icons[type] || 'info'}</span>
            <span>${message}</span>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Public API
    return {
        init, editOrder, cycleStatus, addPhotoToOrder, viewPhoto,
        confirmDelete, selectCodeItem, showToast
    };
})();

// ─── Bootstrap ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', App.init);
