// Sample Property Data
const sampleProperties = [
    {
        id: 1,
        address: "1245 Peachtree St NE",
        city: "Atlanta",
        state: "GA",
        zip: "30309",
        beds: 3,
        baths: 2,
        sqft: 1450,
        yearBuilt: 1995,
        startingBid: 85000,
        arv: 245000,
        estimatedRehab: 45000,
        holdingCosts: 8000,
        sellingCosts: 18000,
        roi: 0.42,
        dealScore: 87,
        riskLevel: "low",
        recommendation: "buy",
        propertyType: "Single Family",
        auctionDate: "2026-01-15",
        parcelID: "14-0089-0001-095-3",
        ownerName: "Smith Trust",
        taxAssessedValue: 125000,
        annualTaxes: 2500,
        specialConditions: "Cash only, as-is sale",
        comps: [
            { address: "1250 Peachtree St NE", distance: 0.1, beds: 3, baths: 2, sqft: 1500, soldPrice: 255000, soldDate: "2025-11-15", pricePerSqft: 170 },
            { address: "1230 Peachtree St NE", distance: 0.2, beds: 3, baths: 2, sqft: 1425, soldPrice: 240000, soldDate: "2025-10-20", pricePerSqft: 168 },
            { address: "1260 Juniper St NE", distance: 0.3, beds: 3, baths: 2, sqft: 1480, soldPrice: 248000, soldDate: "2025-12-01", pricePerSqft: 167 }
        ]
    },
    {
        id: 2,
        address: "3421 Martin Luther King Jr Dr",
        city: "Atlanta",
        state: "GA",
        zip: "30331",
        beds: 4,
        baths: 2.5,
        sqft: 2100,
        yearBuilt: 1978,
        startingBid: 125000,
        arv: 285000,
        estimatedRehab: 65000,
        holdingCosts: 10000,
        sellingCosts: 21000,
        roi: 0.31,
        dealScore: 72,
        riskLevel: "medium",
        recommendation: "monitor",
        propertyType: "Single Family",
        auctionDate: "2026-01-15",
        parcelID: "14-0089-0012-034-1",
        ownerName: "Johnson LLC",
        taxAssessedValue: 165000,
        annualTaxes: 3200,
        specialConditions: "Potential foundation issues",
        comps: []
    },
    {
        id: 3,
        address: "892 Oak Ridge Dr",
        city: "Decatur",
        state: "GA",
        zip: "30030",
        beds: 3,
        baths: 2,
        sqft: 1650,
        yearBuilt: 2005,
        startingBid: 175000,
        arv: 315000,
        estimatedRehab: 35000,
        holdingCosts: 9000,
        sellingCosts: 23000,
        roi: 0.34,
        dealScore: 78,
        riskLevel: "low",
        recommendation: "buy",
        propertyType: "Single Family",
        auctionDate: "2026-01-15",
        parcelID: "14-0089-0045-120-7",
        ownerName: "Williams Estate",
        taxAssessedValue: 195000,
        annualTaxes: 3800,
        specialConditions: "None",
        comps: []
    },
    {
        id: 4,
        address: "5612 Boulder Park Dr SW",
        city: "Atlanta",
        state: "GA",
        zip: "30331",
        beds: 2,
        baths: 1,
        sqft: 950,
        yearBuilt: 1968,
        startingBid: 45000,
        arv: 145000,
        estimatedRehab: 55000,
        holdingCosts: 6000,
        sellingCosts: 11000,
        roi: 0.24,
        dealScore: 58,
        riskLevel: "high",
        recommendation: "pass",
        propertyType: "Single Family",
        auctionDate: "2026-01-15",
        parcelID: "14-0089-0078-045-2",
        ownerName: "Davis Properties",
        taxAssessedValue: 85000,
        annualTaxes: 1500,
        specialConditions: "Severe water damage reported",
        comps: []
    },
    {
        id: 5,
        address: "1876 Piedmont Ave NE",
        city: "Atlanta",
        state: "GA",
        zip: "30324",
        beds: 3,
        baths: 2.5,
        sqft: 1800,
        yearBuilt: 2000,
        startingBid: 195000,
        arv: 380000,
        estimatedRehab: 48000,
        holdingCosts: 11000,
        sellingCosts: 28000,
        roi: 0.39,
        dealScore: 82,
        riskLevel: "low",
        recommendation: "buy",
        propertyType: "Townhouse",
        auctionDate: "2026-01-15",
        parcelID: "14-0089-0092-087-5",
        ownerName: "Miller Trust",
        taxAssessedValue: 245000,
        annualTaxes: 4500,
        specialConditions: "HOA dues: $250/month",
        comps: []
    }
];

// Global State
let currentProperties = [...sampleProperties];
let selectedProperty = null;
let sortColumn = null;
let sortDirection = 'asc';

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    renderPropertiesGrid();
    renderDashboard();
    renderBestDeals();
    setupEventListeners();
    updateStats();
}

// Event Listeners
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // Detail tab navigation
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('detail-tab-btn')) {
            switchDetailTab(e.target.getAttribute('data-detail-tab'));
        }
    });

    // Filter controls
    document.getElementById('minROI').addEventListener('input', function() {
        document.getElementById('minROIValue').textContent = this.value + '%';
    });

    document.getElementById('applyFilters').addEventListener('click', applyFilters);
    document.getElementById('clearFilters').addEventListener('click', clearFilters);

    // Quick filter
    document.getElementById('quickFilter').addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        filterProperties(searchTerm);
    });

    document.getElementById('clearQuickFilter').addEventListener('click', function() {
        document.getElementById('quickFilter').value = '';
        filterProperties('');
    });

    // Export modal
    document.getElementById('exportBtn').addEventListener('click', openExportModal);
    document.getElementById('closeExportModal').addEventListener('click', closeExportModal);
    document.getElementById('cancelExport').addEventListener('click', closeExportModal);
    document.getElementById('confirmExport').addEventListener('click', performExport);

    // Detail panel
    document.getElementById('closeDetailPanel').addEventListener('click', closeDetailPanel);

    // Ranking controls
    document.getElementById('roiWeight').addEventListener('input', function() {
        document.getElementById('roiWeightValue').textContent = this.value + '%';
    });
    document.getElementById('discountWeight').addEventListener('input', function() {
        document.getElementById('discountWeightValue').textContent = this.value + '%';
    });
    document.getElementById('riskWeight').addEventListener('input', function() {
        document.getElementById('riskWeightValue').textContent = this.value + '%';
    });
    document.getElementById('recalculateRanks').addEventListener('click', renderBestDeals);

    // Table sorting
    document.querySelectorAll('.data-grid th.sortable').forEach(th => {
        th.addEventListener('click', function() {
            const column = this.textContent.trim().replace(' ', '').toLowerCase();
            sortTable(column);
        });
    });
}

// Tab Switching
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
}

function switchDetailTab(tabName) {
    document.querySelectorAll('.detail-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.detail-tab-content').forEach(content => content.style.display = 'none');

    document.querySelector(`[data-detail-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`detail-${tabName}`).style.display = 'block';
}

// Render Properties Grid
function renderPropertiesGrid() {
    const tbody = document.getElementById('propertiesTableBody');
    tbody.innerHTML = '';

    currentProperties.forEach(property => {
        const row = createPropertyRow(property);
        tbody.appendChild(row);
    });
}

function createPropertyRow(property) {
    const row = document.createElement('tr');
    row.dataset.propertyId = property.id;

    const projectedProfit = property.arv - (property.startingBid + property.estimatedRehab + property.holdingCosts + property.sellingCosts);
    const totalCost = property.startingBid + property.estimatedRehab + property.holdingCosts;

    // Apply row classes
    if (property.dealScore >= 80) row.classList.add('top-deal');
    if (property.riskLevel === 'high') row.classList.add('high-risk');

    row.innerHTML = `
        <td class="frozen">${property.address}</td>
        <td>${property.city}</td>
        <td>${property.beds}</td>
        <td>${property.baths}</td>
        <td>${property.sqft.toLocaleString()}</td>
        <td>$${property.startingBid.toLocaleString()}</td>
        <td>$${property.arv.toLocaleString()}</td>
        <td>$${property.estimatedRehab.toLocaleString()}</td>
        <td>$${projectedProfit.toLocaleString()}</td>
        <td>${(property.roi * 100).toFixed(1)}%</td>
        <td><span class="badge ${getBadgeClass(property.dealScore)}">${property.dealScore}</span></td>
        <td>
            <div class="risk-indicator">
                <span class="risk-dot ${property.riskLevel}"></span>
                <span>${property.riskLevel.charAt(0).toUpperCase() + property.riskLevel.slice(1)}</span>
            </div>
        </td>
        <td><span class="recommendation ${property.recommendation}">${property.recommendation.toUpperCase()}</span></td>
    `;

    row.addEventListener('click', function() {
        selectProperty(property);
    });

    return row;
}

function getBadgeClass(score) {
    if (score >= 80) return 'badge-success';
    if (score >= 60) return 'badge-warning';
    return 'badge-danger';
}

// Property Selection
function selectProperty(property) {
    selectedProperty = property;

    // Update row selection
    document.querySelectorAll('.data-grid tbody tr').forEach(row => {
        row.classList.remove('selected');
    });
    document.querySelector(`tr[data-property-id="${property.id}"]`).classList.add('selected');

    // Show detail panel
    showDetailPanel(property);

    // Update status bar
    document.getElementById('statusSelected').textContent = `Selected: ${property.address}`;
}

function showDetailPanel(property) {
    const panel = document.getElementById('detailPanel');
    const content = document.getElementById('detailContent');

    const projectedProfit = property.arv - (property.startingBid + property.estimatedRehab + property.holdingCosts + property.sellingCosts);
    const totalCost = property.startingBid + property.estimatedRehab + property.holdingCosts;
    const discount = ((property.arv - property.startingBid) / property.arv * 100).toFixed(1);

    content.innerHTML = `
        <div class="property-header">
            <div class="property-image" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 48px;">
                <i class="fas fa-home"></i>
            </div>
            <h2 class="property-title">${property.address}</h2>
            <p class="property-subtitle">${property.city}, ${property.state} ${property.zip}</p>
        </div>

        <div class="detail-tabs">
            <button class="detail-tab-btn active" data-detail-tab="summary">Summary</button>
            <button class="detail-tab-btn" data-detail-tab="financials">Financials</button>
            <button class="detail-tab-btn" data-detail-tab="comps">Comps</button>
            <button class="detail-tab-btn" data-detail-tab="records">Public Records</button>
        </div>

        <div id="detail-summary" class="detail-tab-content" style="display: block;">
            <div class="detail-section">
                <h4>Property Details</h4>
                <div class="key-value-grid">
                    <span class="key">Property Type:</span>
                    <span class="value">${property.propertyType}</span>

                    <span class="key">Bedrooms:</span>
                    <span class="value">${property.beds}</span>

                    <span class="key">Bathrooms:</span>
                    <span class="value">${property.baths}</span>

                    <span class="key">Square Feet:</span>
                    <span class="value">${property.sqft.toLocaleString()}</span>

                    <span class="key">Year Built:</span>
                    <span class="value">${property.yearBuilt}</span>
                </div>
            </div>

            <div class="detail-section">
                <h4>Auction Details</h4>
                <div class="key-value-grid">
                    <span class="key">Auction Date:</span>
                    <span class="value">${new Date(property.auctionDate).toLocaleDateString()}</span>

                    <span class="key">Starting Bid:</span>
                    <span class="value">$${property.startingBid.toLocaleString()}</span>

                    <span class="key">Discount to ARV:</span>
                    <span class="value">${discount}%</span>
                </div>
                <p style="margin-top: 12px; font-style: italic; color: var(--text-secondary);">${property.specialConditions}</p>
            </div>
        </div>

        <div id="detail-financials" class="detail-tab-content" style="display: none;">
            <div class="editable-section">
                <h5>Scenario Inputs (Editable)</h5>
                <div class="key-value-grid">
                    <span class="key">Purchase Price:</span>
                    <input type="text" class="input" value="$${property.startingBid.toLocaleString()}" />

                    <span class="key">Rehab Cost:</span>
                    <input type="text" class="input" value="$${property.estimatedRehab.toLocaleString()}" />

                    <span class="key">ARV Override:</span>
                    <input type="text" class="input" value="$${property.arv.toLocaleString()}" />
                </div>
                <p class="note">Changes update metrics in real-time</p>
            </div>

            <div class="detail-section">
                <h4>Cost Breakdown</h4>
                <div class="key-value-grid">
                    <span class="key">Purchase Price:</span>
                    <span class="value">$${property.startingBid.toLocaleString()}</span>

                    <span class="key">Rehab Costs:</span>
                    <span class="value">$${property.estimatedRehab.toLocaleString()}</span>

                    <span class="key">Holding Costs:</span>
                    <span class="value">$${property.holdingCosts.toLocaleString()}</span>

                    <span class="key">Selling Costs:</span>
                    <span class="value">$${property.sellingCosts.toLocaleString()}</span>

                    <span class="key">Total Cost:</span>
                    <span class="value" style="font-size: 16px;">$${totalCost.toLocaleString()}</span>
                </div>
            </div>

            <div class="metrics-highlight">
                <div class="metric-row">
                    <span class="metric-label">After Repair Value (ARV):</span>
                    <span class="metric-value" style="color: var(--primary-blue);">$${property.arv.toLocaleString()}</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Projected Profit:</span>
                    <span class="metric-value" style="color: var(--success-green);">$${projectedProfit.toLocaleString()}</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Return on Investment (ROI):</span>
                    <span class="metric-value" style="color: var(--success-green);">${(property.roi * 100).toFixed(1)}%</span>
                </div>
            </div>

            <div class="detail-section">
                <h4>Risk Score</h4>
                <div class="risk-score-bar">
                    <div class="risk-score-fill ${property.riskLevel}" style="width: ${property.dealScore}%"></div>
                </div>
                <p style="margin-top: 8px; color: var(--text-secondary);">
                    ${getRiskExplanation(property)}
                </p>
            </div>
        </div>

        <div id="detail-comps" class="detail-tab-content" style="display: none;">
            <div class="detail-section">
                <h4>Comparable Properties</h4>
                ${property.comps.length > 0 ? renderComps(property.comps) : '<p style="color: var(--text-secondary);">No comparable properties data available.</p>'}
            </div>
        </div>

        <div id="detail-records" class="detail-tab-content" style="display: none;">
            <div class="detail-section">
                <h4>Tax & Ownership Data</h4>
                <div class="key-value-grid">
                    <span class="key">Owner Name:</span>
                    <span class="value">${property.ownerName}</span>

                    <span class="key">Parcel ID:</span>
                    <span class="value">${property.parcelID}</span>

                    <span class="key">Tax Assessed Value:</span>
                    <span class="value">$${property.taxAssessedValue.toLocaleString()}</span>

                    <span class="key">Annual Taxes:</span>
                    <span class="value">$${property.annualTaxes.toLocaleString()}</span>
                </div>
            </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 24px; justify-content: flex-end;">
            <button class="btn btn-secondary">
                <i class="fas fa-star"></i> Add to Favorites
            </button>
            <button class="btn btn-secondary">
                <i class="fas fa-sticky-note"></i> Add Note
            </button>
            <button class="btn btn-primary">
                <i class="fas fa-file-export"></i> Export Property
            </button>
        </div>
    `;

    panel.classList.remove('closed');

    // Re-attach event listeners for detail tabs
    content.querySelectorAll('.detail-tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            switchDetailTab(this.getAttribute('data-detail-tab'));
        });
    });
}

function renderComps(comps) {
    let html = '<table style="width: 100%; font-size: 13px; border-collapse: collapse;">';
    html += '<thead><tr style="border-bottom: 2px solid var(--border-color);">';
    html += '<th style="padding: 8px; text-align: left;">Address</th>';
    html += '<th style="padding: 8px; text-align: left;">Distance</th>';
    html += '<th style="padding: 8px; text-align: left;">Beds/Baths</th>';
    html += '<th style="padding: 8px; text-align: left;">Sq Ft</th>';
    html += '<th style="padding: 8px; text-align: left;">Sold Price</th>';
    html += '<th style="padding: 8px; text-align: left;">$/Sq Ft</th>';
    html += '<th style="padding: 8px; text-align: left;">Sold Date</th>';
    html += '<th style="padding: 8px; text-align: left;">Action</th>';
    html += '</tr></thead><tbody>';

    comps.forEach(comp => {
        html += '<tr style="border-bottom: 1px solid var(--border-color);">';
        html += `<td style="padding: 8px;">${comp.address}</td>`;
        html += `<td style="padding: 8px;">${comp.distance} mi</td>`;
        html += `<td style="padding: 8px;">${comp.beds}/${comp.baths}</td>`;
        html += `<td style="padding: 8px;">${comp.sqft.toLocaleString()}</td>`;
        html += `<td style="padding: 8px;">$${comp.soldPrice.toLocaleString()}</td>`;
        html += `<td style="padding: 8px;">$${comp.pricePerSqft}</td>`;
        html += `<td style="padding: 8px;">${new Date(comp.soldDate).toLocaleDateString()}</td>`;
        html += `<td style="padding: 8px;"><button class="btn btn-link" style="padding: 4px 8px;"><i class="fas fa-external-link-alt"></i> View on Zillow</button></td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';
    html += '<p style="font-size: 11px; margin-top: 12px; color: var(--text-secondary);">* Comps filtered by: within 1 mile, sold in last 6 months, similar bed/bath</p>';
    return html;
}

function getRiskExplanation(property) {
    if (property.riskLevel === 'low') {
        return 'Low risk property with solid fundamentals, clean title, and strong comparable sales.';
    } else if (property.riskLevel === 'medium') {
        return 'Moderate risk with some concerns to investigate. Review property condition and market conditions carefully.';
    } else {
        return 'High risk property. Significant issues identified including potential structural problems or market concerns.';
    }
}

function closeDetailPanel() {
    document.getElementById('detailPanel').classList.add('closed');
    document.querySelectorAll('.data-grid tbody tr').forEach(row => {
        row.classList.remove('selected');
    });
    selectedProperty = null;
    document.getElementById('statusSelected').textContent = 'Selected: None';
}

// Filtering
function applyFilters() {
    const minROI = parseFloat(document.getElementById('minROI').value) / 100;
    const maxRehab = parseFloat(document.getElementById('maxRehab').value.replace(/[$,]/g, ''));
    const riskLevel = document.getElementById('riskLevel').value;
    const topDealsOnly = document.getElementById('topDealsOnly').checked;

    currentProperties = sampleProperties.filter(property => {
        if (property.roi < minROI) return false;
        if (!isNaN(maxRehab) && property.estimatedRehab > maxRehab) return false;
        if (riskLevel !== 'all') {
            if (riskLevel === 'low' && property.riskLevel !== 'low') return false;
            if (riskLevel === 'medium' && property.riskLevel === 'high') return false;
        }
        if (topDealsOnly && property.dealScore < 80) return false;
        return true;
    });

    renderPropertiesGrid();
    updateStats();
}

function clearFilters() {
    document.getElementById('minROI').value = 0;
    document.getElementById('minROIValue').textContent = '0%';
    document.getElementById('maxRehab').value = '';
    document.getElementById('riskLevel').value = 'all';
    document.getElementById('topDealsOnly').checked = false;

    currentProperties = [...sampleProperties];
    renderPropertiesGrid();
    updateStats();
}

function filterProperties(searchTerm) {
    if (!searchTerm) {
        currentProperties = [...sampleProperties];
    } else {
        currentProperties = sampleProperties.filter(property => {
            return property.address.toLowerCase().includes(searchTerm) ||
                   property.city.toLowerCase().includes(searchTerm) ||
                   property.zip.includes(searchTerm);
        });
    }

    renderPropertiesGrid();
    updateStats();
}

// Sorting
function sortTable(column) {
    const columnMap = {
        'address': 'address',
        'city': 'city',
        'beds': 'beds',
        'baths': 'baths',
        'sqft': 'sqft',
        'startingbid': 'startingBid',
        'arv': 'arv',
        'est.rehab': 'estimatedRehab',
        'proj.profit': 'roi', // Using ROI as proxy for profit
        'roi': 'roi',
        'dealscore': 'dealScore'
    };

    const propertyKey = columnMap[column];
    if (!propertyKey) return;

    if (sortColumn === propertyKey) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = propertyKey;
        sortDirection = 'asc';
    }

    currentProperties.sort((a, b) => {
        let valA = a[propertyKey];
        let valB = b[propertyKey];

        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (sortDirection === 'asc') {
            return valA > valB ? 1 : -1;
        } else {
            return valA < valB ? 1 : -1;
        }
    });

    renderPropertiesGrid();
}

// Dashboard
function renderDashboard() {
    renderTopDealsGrid();
    renderCharts();
}

function renderTopDealsGrid() {
    const topDeals = [...sampleProperties]
        .sort((a, b) => b.dealScore - a.dealScore)
        .slice(0, 5);

    const container = document.getElementById('topDealsGrid');

    let html = '<table><thead><tr>';
    html += '<th>Address</th><th>ROI</th><th>Profit</th><th>Risk</th><th>Action</th>';
    html += '</tr></thead><tbody>';

    topDeals.forEach(property => {
        const profit = property.arv - (property.startingBid + property.estimatedRehab + property.holdingCosts + property.sellingCosts);
        html += '<tr>';
        html += `<td>${property.address}</td>`;
        html += `<td>${(property.roi * 100).toFixed(1)}%</td>`;
        html += `<td>$${profit.toLocaleString()}</td>`;
        html += `<td><span class="risk-dot ${property.riskLevel}"></span> ${property.riskLevel}</td>`;
        html += `<td><button class="btn btn-link" onclick="selectPropertyById(${property.id})">View</button></td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function selectPropertyById(id) {
    const property = sampleProperties.find(p => p.id === id);
    if (property) {
        switchTab('properties');
        setTimeout(() => selectProperty(property), 100);
    }
}

function renderCharts() {
    // Deal Distribution Pie Chart
    const dealCtx = document.getElementById('dealChart');
    if (dealCtx) {
        new Chart(dealCtx, {
            type: 'pie',
            data: {
                labels: ['Top Deals', 'Good Deals', 'Monitor', 'Pass'],
                datasets: [{
                    data: [
                        sampleProperties.filter(p => p.dealScore >= 80).length,
                        sampleProperties.filter(p => p.dealScore >= 60 && p.dealScore < 80).length,
                        sampleProperties.filter(p => p.dealScore >= 40 && p.dealScore < 60).length,
                        sampleProperties.filter(p => p.dealScore < 40).length
                    ],
                    backgroundColor: ['#27AE60', '#52BE80', '#F1C40F', '#E74C3C']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    // Risk Distribution Bar Chart
    const riskCtx = document.getElementById('riskChart');
    if (riskCtx) {
        new Chart(riskCtx, {
            type: 'bar',
            data: {
                labels: ['Low Risk', 'Medium Risk', 'High Risk'],
                datasets: [{
                    label: 'Number of Properties',
                    data: [
                        sampleProperties.filter(p => p.riskLevel === 'low').length,
                        sampleProperties.filter(p => p.riskLevel === 'medium').length,
                        sampleProperties.filter(p => p.riskLevel === 'high').length
                    ],
                    backgroundColor: ['#27AE60', '#F1C40F', '#E74C3C']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }
}

// Best Deals
function renderBestDeals() {
    const roiWeight = parseFloat(document.getElementById('roiWeight').value) / 100;
    const discountWeight = parseFloat(document.getElementById('discountWeight').value) / 100;
    const riskWeight = parseFloat(document.getElementById('riskWeight').value) / 100;

    const rankedDeals = sampleProperties.map(property => {
        const discount = (property.arv - property.startingBid) / property.arv;
        const riskScore = property.riskLevel === 'low' ? 1 : property.riskLevel === 'medium' ? 0.5 : 0;

        const compositeScore = (property.roi * roiWeight) + (discount * discountWeight) + (riskScore * riskWeight);

        return {
            ...property,
            compositeScore
        };
    }).sort((a, b) => b.compositeScore - a.compositeScore);

    const container = document.getElementById('rankedDealsList');
    container.innerHTML = '';

    rankedDeals.forEach((deal, index) => {
        const profit = deal.arv - (deal.startingBid + deal.estimatedRehab + deal.holdingCosts + deal.sellingCosts);
        const whyRanked = getWhyRanked(deal);

        const card = document.createElement('div');
        card.className = 'ranked-deal-card';
        card.innerHTML = `
            <div class="rank-badge">${index + 1}</div>
            <div class="deal-info">
                <h4>${deal.address}</h4>
                <p class="property-summary">${deal.city}, ${deal.state} • ${deal.beds} bed / ${deal.baths} bath • ${deal.sqft.toLocaleString()} sq ft</p>
                <p class="why-ranked">${whyRanked}</p>
            </div>
            <div class="deal-metrics">
                <div class="roi">${(deal.roi * 100).toFixed(0)}% ROI</div>
                <div class="profit">Profit: $${profit.toLocaleString()}</div>
                <div class="score">Score: ${deal.dealScore}/100</div>
                <button class="btn btn-primary" onclick="selectPropertyById(${deal.id})" style="margin-top: 8px;">View Details</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function getWhyRanked(property) {
    const reasons = [];
    if (property.roi > 0.35) reasons.push('High ROI');
    if (property.estimatedRehab < 50000) reasons.push('low rehab cost');
    if (property.riskLevel === 'low') reasons.push('low risk');
    if (property.dealScore >= 80) reasons.push('excellent deal score');

    return reasons.length > 0 ? reasons.join(', ') : 'Good overall metrics';
}

// Stats Update
function updateStats() {
    const totalCount = currentProperties.length;
    const topDealsCount = currentProperties.filter(p => p.dealScore >= 80).length;
    const avgROI = currentProperties.reduce((sum, p) => sum + p.roi, 0) / totalCount;
    const avgProfit = currentProperties.reduce((sum, p) => {
        return sum + (p.arv - p.startingBid - p.estimatedRehab - p.holdingCosts - p.sellingCosts);
    }, 0) / totalCount;

    document.getElementById('totalCount').textContent = totalCount;
    document.getElementById('topDealsCount').textContent = topDealsCount;
    document.getElementById('avgROI').textContent = (avgROI * 100).toFixed(1) + '%';
    document.getElementById('avgProfit').textContent = '$' + Math.round(avgProfit).toLocaleString();

    document.getElementById('statusProperties').textContent = `Properties: ${sampleProperties.length}`;
    document.getElementById('statusFiltered').textContent = `Filtered: ${totalCount}`;
}

// Export Modal
function openExportModal() {
    document.getElementById('exportModal').classList.add('active');
}

function closeExportModal() {
    document.getElementById('exportModal').classList.remove('active');
}

function performExport() {
    // Simulate export
    showToast('Export Started', 'Generating your export file...', 'success');
    setTimeout(() => {
        showToast('Export Complete', 'Your file is ready for download', 'success');
        closeExportModal();
    }, 2000);
}

// ========================================
// NEW FEATURES
// ========================================

// Toast Notification System
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconMap = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    toast.innerHTML = `
        <i class="fas ${iconMap[type]} toast-icon"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close"><i class="fas fa-times"></i></button>
    `;

    container.appendChild(toast);

    // Close button
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.remove();
    });

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

// County Lookup Functionality
function openCountyLookupModal() {
    document.getElementById('countyLookupModal').classList.add('active');
}

function closeCountyLookupModal() {
    document.getElementById('countyLookupModal').classList.remove('active');
    resetCountyLookupForm();
}

function resetCountyLookupForm() {
    document.getElementById('countyName').value = '';
    document.getElementById('stateName').value = '';
    document.getElementById('strategyType').value = 'flip';
    document.getElementById('budget').value = '$200,000';
    document.getElementById('minROIInput').value = '20';
    document.getElementById('maxRiskInput').value = '50';
    document.getElementById('maxProperties').value = '';
    document.getElementById('lookupStatus').style.display = 'none';
    document.getElementById('lookupResult').style.display = 'none';
    document.getElementById('lookupProgress').style.width = '0%';
}

function startCountyLookup() {
    const county = document.getElementById('countyName').value.trim();
    const state = document.getElementById('stateName').value;
    const strategy = document.getElementById('strategyType').value;
    const budget = document.getElementById('budget').value.replace(/[$,]/g, '');
    const minROI = document.getElementById('minROIInput').value;
    const maxRisk = document.getElementById('maxRiskInput').value;
    const maxProperties = document.getElementById('maxProperties').value;

    // Validation
    if (!county || !state) {
        showToast('Missing Information', 'Please enter both county name and state', 'error');
        return;
    }

    // Show loading state
    document.getElementById('lookupStatus').style.display = 'block';
    document.getElementById('lookupResult').style.display = 'none';
    document.getElementById('startCountyLookup').classList.add('loading');
    document.getElementById('startCountyLookup').disabled = true;

    // Simulate backend call with progress
    simulateCountyLookup(county, state, strategy, budget, minROI, maxRisk, maxProperties);
}

function simulateCountyLookup(county, state, strategy, budget, minROI, maxRisk, maxProperties) {
    const steps = [
        { text: 'Fetching properties from county sources...', progress: 20, delay: 1000 },
        { text: 'Enriching properties with comparable sales...', progress: 40, delay: 2000 },
        { text: 'Calculating risk scores...', progress: 60, delay: 1500 },
        { text: 'Analyzing deals and computing ROI...', progress: 80, delay: 1500 },
        { text: 'Generating spreadsheet...', progress: 95, delay: 1000 },
        { text: 'Complete!', progress: 100, delay: 500 }
    ];

    let currentStep = 0;

    function runStep() {
        if (currentStep >= steps.length) {
            showCompletionResult(county, state);
            return;
        }

        const step = steps[currentStep];
        document.getElementById('lookupStatusText').textContent = step.text;
        document.getElementById('lookupProgress').style.width = step.progress + '%';

        currentStep++;
        setTimeout(runStep, step.delay);
    }

    runStep();
}

function showCompletionResult(county, state) {
    document.getElementById('lookupStatus').style.display = 'none';
    document.getElementById('startCountyLookup').classList.remove('loading');
    document.getElementById('startCountyLookup').disabled = false;

    const resultDiv = document.getElementById('lookupResult');
    resultDiv.style.display = 'block';

    // Check if county is supported
    const supportedCounties = ['Fulton', 'Wayne', 'Faribault'];
    const isSupported = supportedCounties.some(c => c.toLowerCase() === county.toLowerCase());

    if (isSupported) {
        resultDiv.className = 'lookup-result success';
        resultDiv.innerHTML = `
            <h4><i class="fas fa-check-circle"></i> Analysis Complete!</h4>
            <p>Successfully analyzed ${county} County, ${state}</p>
            <ul>
                <li>Found 247 properties</li>
                <li>Identified 18 top deals (80+ score)</li>
                <li>Average ROI: 24.3%</li>
                <li>Results added to dashboard</li>
            </ul>
            <button class="btn btn-primary" onclick="loadCountyResults('${county}', '${state}')">
                <i class="fas fa-chart-line"></i> View Results
            </button>
        `;
        showToast('County Analyzed', `${county} County data loaded successfully`, 'success');
    } else {
        resultDiv.className = 'lookup-result error';
        resultDiv.innerHTML = `
            <h4><i class="fas fa-exclamation-triangle"></i> County Not Yet Supported</h4>
            <p>${county} County, ${state} connector not implemented yet.</p>
            <p style="margin-top: 12px;">To add support:</p>
            <ul>
                <li>Create connector: <code>execution/connectors/${county.toLowerCase()}_county_connector.py</code></li>
                <li>Follow SOP in: <code>SOP_ADD_NEW_COUNTY.md</code></li>
                <li>Currently supported: Fulton (GA), Wayne (PA), Faribault (MN)</li>
            </ul>
        `;
        showToast('County Not Supported', 'This county does not have a data connector yet', 'warning');
    }
}

function loadCountyResults(county, state) {
    closeCountyLookupModal();
    showLoadingOverlay('Loading county data...');

    // Add to auction selector
    const selector = document.getElementById('auctionSelector');
    const option = document.createElement('option');
    option.textContent = `${county} County, ${state} - ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    option.selected = true;
    selector.appendChild(option);

    // Simulate data load
    setTimeout(() => {
        hideLoadingOverlay();
        renderPropertiesGrid();
        renderDashboard();
        switchTab('dashboard');
        showToast('Data Loaded', `Viewing ${county} County, ${state}`, 'success');
    }, 1500);
}

// Loading Overlay
function showLoadingOverlay(text = 'Loading...') {
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingText').textContent = text;
}

function hideLoadingOverlay() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl + F - Focus quick filter
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        document.getElementById('quickFilter').focus();
    }

    // Ctrl + E - Export
    if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        openExportModal();
    }

    // Ctrl + N - New county lookup
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        openCountyLookupModal();
    }

    // Ctrl + R - Refresh
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        showToast('Refreshing', 'Reloading data...', 'info');
        setTimeout(() => {
            renderPropertiesGrid();
            updateStats();
            showToast('Refreshed', 'Data reloaded successfully', 'success');
        }, 1000);
    }

    // Escape - Close modals and panels
    if (e.key === 'Escape') {
        closeExportModal();
        closeCountyLookupModal();
        closeShortcutsModal();
        closeDetailPanel();
    }

    // ? - Show shortcuts
    if (e.key === '?' && !e.ctrlKey && !e.shiftKey) {
        openShortcutsModal();
    }

    // Arrow keys - Navigate grid (when grid is focused)
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const grid = document.getElementById('propertiesGrid');
        const selectedRow = grid.querySelector('tr.selected');
        if (selectedRow) {
            e.preventDefault();
            const allRows = Array.from(grid.querySelectorAll('tbody tr'));
            const currentIndex = allRows.indexOf(selectedRow);
            let nextIndex;

            if (e.key === 'ArrowDown') {
                nextIndex = Math.min(currentIndex + 1, allRows.length - 1);
            } else {
                nextIndex = Math.max(currentIndex - 1, 0);
            }

            const nextRow = allRows[nextIndex];
            const propertyId = nextRow.dataset.propertyId;
            const property = currentProperties.find(p => p.id == propertyId);
            if (property) {
                selectProperty(property);
                nextRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    // Enter - Open detail view
    if (e.key === 'Enter' && selectedProperty) {
        // Could open in full-screen modal or just ensure detail panel is visible
        const panel = document.getElementById('detailPanel');
        if (panel.classList.contains('closed')) {
            panel.classList.remove('closed');
        }
    }
});

function openShortcutsModal() {
    document.getElementById('shortcutsModal').classList.add('active');
}

function closeShortcutsModal() {
    document.getElementById('shortcutsModal').classList.remove('active');
}

// Enhanced Filter Functionality
function initializeEnhancedFilters() {
    // Min Deal Score slider
    document.getElementById('minDealScore').addEventListener('input', function() {
        document.getElementById('minDealScoreValue').textContent = this.value;
    });

    // Reset filters button
    document.getElementById('resetFiltersBtn').addEventListener('click', clearFilters);

    // Update active filter count
    updateActiveFilterCount();
}

function updateActiveFilterCount() {
    const filters = [
        document.getElementById('minROI').value !== '0',
        document.getElementById('maxStartingBid').value !== '',
        document.getElementById('maxRehab').value !== '',
        document.getElementById('minProfit').value !== '',
        document.getElementById('propertyType').value !== 'all',
        document.getElementById('minBeds').value !== '',
        document.getElementById('minBaths').value !== '',
        document.getElementById('minSqFt').value !== '',
        document.getElementById('riskLevel').value !== 'all',
        document.getElementById('minDealScore').value !== '0',
        document.getElementById('topDealsOnly').checked
    ];

    const activeCount = filters.filter(Boolean).length;
    const countDiv = document.getElementById('activeFiltersCount');
    const countText = document.getElementById('filterCountText');

    if (activeCount > 0) {
        countDiv.style.display = 'flex';
        countText.textContent = `${activeCount} filter${activeCount > 1 ? 's' : ''} active`;
    } else {
        countDiv.style.display = 'none';
    }
}

// Update the existing applyFilters function to use new filters
const originalApplyFilters = applyFilters;
applyFilters = function() {
    const minROI = parseFloat(document.getElementById('minROI').value) / 100;
    const maxStartingBid = parseFloat(document.getElementById('maxStartingBid').value.replace(/[$,]/g, ''));
    const maxRehab = parseFloat(document.getElementById('maxRehab').value.replace(/[$,]/g, ''));
    const minProfit = parseFloat(document.getElementById('minProfit').value.replace(/[$,]/g, ''));
    const propertyType = document.getElementById('propertyType').value;
    const minBeds = document.getElementById('minBeds').value;
    const minBaths = document.getElementById('minBaths').value;
    const minSqFt = parseInt(document.getElementById('minSqFt').value);
    const riskLevel = document.getElementById('riskLevel').value;
    const minDealScore = parseFloat(document.getElementById('minDealScore').value);
    const topDealsOnly = document.getElementById('topDealsOnly').checked;

    currentProperties = sampleProperties.filter(property => {
        // ROI filter
        if (property.roi < minROI) return false;

        // Starting bid filter
        if (!isNaN(maxStartingBid) && property.startingBid > maxStartingBid) return false;

        // Rehab filter
        if (!isNaN(maxRehab) && property.estimatedRehab > maxRehab) return false;

        // Profit filter
        const profit = property.arv - (property.startingBid + property.estimatedRehab + property.holdingCosts + property.sellingCosts);
        if (!isNaN(minProfit) && profit < minProfit) return false;

        // Property type filter
        if (propertyType !== 'all') {
            const typeMap = {
                'single-family': 'Single Family',
                'townhouse': 'Townhouse',
                'condo': 'Condo',
                'multi-family': 'Multi-Family'
            };
            if (property.propertyType !== typeMap[propertyType]) return false;
        }

        // Beds filter
        if (minBeds && property.beds < parseInt(minBeds)) return false;

        // Baths filter
        if (minBaths && property.baths < parseFloat(minBaths)) return false;

        // Square feet filter
        if (!isNaN(minSqFt) && property.sqft < minSqFt) return false;

        // Risk filter
        if (riskLevel !== 'all') {
            if (riskLevel === 'low' && property.riskLevel !== 'low') return false;
            if (riskLevel === 'medium' && property.riskLevel === 'high') return false;
        }

        // Deal score filter
        if (property.dealScore < minDealScore) return false;

        // Top deals filter
        if (topDealsOnly && property.dealScore < 80) return false;

        return true;
    });

    renderPropertiesGrid();
    updateStats();
    updateActiveFilterCount();

    showToast('Filters Applied', `Found ${currentProperties.length} properties`, 'success');
};

// Update clearFilters
const originalClearFilters = clearFilters;
clearFilters = function() {
    document.getElementById('minROI').value = 0;
    document.getElementById('minROIValue').textContent = '0%';
    document.getElementById('maxStartingBid').value = '';
    document.getElementById('maxRehab').value = '';
    document.getElementById('minProfit').value = '';
    document.getElementById('propertyType').value = 'all';
    document.getElementById('minBeds').value = '';
    document.getElementById('minBaths').value = '';
    document.getElementById('minSqFt').value = '';
    document.getElementById('riskLevel').value = 'all';
    document.getElementById('minDealScore').value = 0;
    document.getElementById('minDealScoreValue').textContent = '0';
    document.getElementById('topDealsOnly').checked = false;

    currentProperties = [...sampleProperties];
    renderPropertiesGrid();
    updateStats();
    updateActiveFilterCount();

    showToast('Filters Cleared', 'All filters have been reset', 'info');
};

// Update setupEventListeners to include new features
const originalSetupEventListeners = setupEventListeners;
setupEventListeners = function() {
    originalSetupEventListeners();

    // County lookup modal
    document.getElementById('lookupCountyBtn').addEventListener('click', openCountyLookupModal);
    document.getElementById('closeCountyLookupModal').addEventListener('click', closeCountyLookupModal);
    document.getElementById('cancelCountyLookup').addEventListener('click', closeCountyLookupModal);
    document.getElementById('startCountyLookup').addEventListener('click', startCountyLookup);

    // Shortcuts modal
    document.getElementById('closeShortcutsModal').addEventListener('click', closeShortcutsModal);

    // Initialize enhanced filters
    initializeEnhancedFilters();

    // Show welcome toast
    setTimeout(() => {
        showToast('Welcome!', 'Press ? to view keyboard shortcuts', 'info');
    }, 1000);
};
