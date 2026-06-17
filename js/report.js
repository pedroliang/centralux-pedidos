/**
 * Report Module - Renders order report table
 */
const Report = (() => {
    let _container = null;
    let _currentFilter = 'all';
    let _searchTerm = '';

    const STATUS_CONFIG = {
        pendente: { label: 'PENDENTE', class: 'status-pendente', icon: 'schedule' },
        separando: { label: 'SEPARANDO', class: 'status-separando', icon: 'inventory_2' },
        concluido: { label: 'CONCLUÍDO', class: 'status-concluido', icon: 'check_circle' }
    };

    const PRIORITY_CONFIG = {
        normal: { label: 'Normal', class: 'priority-normal' },
        urgente: { label: 'Urgente', class: 'priority-urgente' },
        baixa: { label: 'Baixa', class: 'priority-baixa' }
    };

    /**
     * Format date string to BR format
     */
    function formatDate(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${mins}`;
    }

    function formatDateShort(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        const day = String(d.getDate()).padStart(2, '0');
        const months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
        const month = months[d.getMonth()];
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${day} DE ${month}. ${hours}:${mins}`;
    }

    /**
     * Filter orders based on current filter and search
     */
    function filterOrders(orders) {
        let filtered = [...orders];

        // Apply status filter
        if (_currentFilter !== 'all') {
            filtered = filtered.filter(o => o.status === _currentFilter);
        }

        // Apply search
        if (_searchTerm) {
            const term = _searchTerm.toLowerCase();
            filtered = filtered.filter(o =>
                (o.code && o.code.toLowerCase().includes(term)) ||
                (o.client && o.client.toLowerCase().includes(term)) ||
                (o.vendor && o.vendor.toLowerCase().includes(term))
            );
        }

        return filtered;
    }

    /**
     * Render photo indicator
     */
    function renderPhotoCell(order) {
        if (order.photos && order.photos.length > 0) {
            const photo = order.photos[0];
            return `
                <div class="photo-indicators">
                    <button class="photo-btn photo-btn-has" onclick="App.viewPhoto('${photo.url}')" title="Ver foto">
                        <span class="material-symbols-outlined">image</span>
                    </button>
                    <span class="photo-label">FOTO</span>
                </div>
            `;
        }
        return `
            <div class="photo-indicators">
                <button class="photo-btn photo-btn-none" title="Sem foto">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
        `;
    }

    /**
     * Render a single order row
     */
    function renderRow(order) {
        const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pendente;
        const priority = PRIORITY_CONFIG[order.priority] || PRIORITY_CONFIG.normal;

        return `
            <tr class="order-row" data-id="${order.id}">
                <td class="cell-order">
                    <div class="order-code">${order.code || order.id}</div>
                    <div class="order-date">${formatDateShort(order.createdAt)}</div>
                </td>
                <td class="cell-photo">
                    ${renderPhotoCell(order)}
                </td>
                <td class="cell-client">
                    <div class="client-name">${order.client || '—'}</div>
                    <div class="vendor-name">Vend: ${order.vendor || '—'}</div>
                </td>
                <td class="cell-priority">
                    <span class="badge ${priority.class}">${priority.label}</span>
                </td>
                <td class="cell-status">
                    <span class="badge ${status.class}">${status.label}</span>
                </td>
                <td class="cell-actions">
                    <div class="action-buttons">
                        <button class="btn-action btn-edit" onclick="App.editOrder(${order.id})" title="Editar">
                            <span class="material-symbols-outlined">edit</span>
                        </button>
                        <button class="btn-action btn-photo" onclick="App.addPhotoToOrder(${order.id})" title="Adicionar Foto">
                            <span class="material-symbols-outlined">photo_camera</span>
                        </button>
                        <button class="btn-action btn-status" onclick="App.cycleStatus(${order.id})" title="Alterar Status">
                            <span class="material-symbols-outlined">sync</span>
                        </button>
                        <button class="btn-action btn-delete" onclick="App.confirmDelete(${order.id})" title="Excluir">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Render the full report
     */
    function render(container) {
        _container = container || _container;
        if (!_container) return;

        const orders = Storage.getOrders();
        const filtered = filterOrders(orders);
        const stats = Storage.getStats();

        _container.innerHTML = `
            <div class="report-header">
                <div class="report-title">
                    <span class="material-symbols-outlined">description</span>
                    <h2>Relatório de Pedidos</h2>
                </div>
                <div class="report-controls">
                    <div class="search-box">
                        <span class="material-symbols-outlined">search</span>
                        <input type="text" id="report-search" placeholder="Buscar pedido, cliente..." value="${_searchTerm}" />
                    </div>
                    <button class="btn-refresh" onclick="Report.refresh()">
                        <span class="material-symbols-outlined">refresh</span>
                        Atualizar
                    </button>
                </div>
            </div>

            <div class="report-filters">
                <button class="filter-btn ${_currentFilter === 'all' ? 'active' : ''}" data-filter="all">
                    Todos <span class="filter-count">${stats.total}</span>
                </button>
                <button class="filter-btn ${_currentFilter === 'pendente' ? 'active' : ''}" data-filter="pendente">
                    Pendentes <span class="filter-count">${stats.pendente}</span>
                </button>
                <button class="filter-btn ${_currentFilter === 'separando' ? 'active' : ''}" data-filter="separando">
                    Separando <span class="filter-count">${stats.separando}</span>
                </button>
                <button class="filter-btn ${_currentFilter === 'concluido' ? 'active' : ''}" data-filter="concluido">
                    Concluídos <span class="filter-count">${stats.concluido}</span>
                </button>
            </div>

            ${filtered.length === 0 ? `
                <div class="empty-state">
                    <span class="material-symbols-outlined">inbox</span>
                    <p>Nenhum pedido encontrado</p>
                    <small>Cadastre um novo pedido para começar</small>
                </div>
            ` : `
                <div class="table-wrapper">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>PEDIDO / DATA</th>
                                <th>FOTOS</th>
                                <th>CLIENTE / VENDEDOR</th>
                                <th>PRIORIDADE</th>
                                <th>STATUS ATUAL</th>
                                <th>AÇÃO</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.map(renderRow).join('')}
                        </tbody>
                    </table>
                </div>
            `}
        `;

        // Attach event listeners
        attachListeners();
    }

    function attachListeners() {
        // Search
        const searchInput = document.getElementById('report-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                _searchTerm = e.target.value;
                render();
                // Re-focus and set cursor position
                const newInput = document.getElementById('report-search');
                if (newInput) {
                    newInput.focus();
                    newInput.setSelectionRange(newInput.value.length, newInput.value.length);
                }
            });
        }

        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _currentFilter = btn.dataset.filter;
                render();
            });
        });
    }

    function setFilter(filter) {
        _currentFilter = filter;
        render();
    }

    function refresh() {
        render();
    }

    return { render, setFilter, refresh };
})();
