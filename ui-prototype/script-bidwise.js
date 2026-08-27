// =========================================
// BidWise AI - JavaScript Functionality
// =========================================

// State Management
const state = {
    currentView: 'dashboard',
    selectedCounty: 'Fulton County, GA - February 2026',
    filters: {
        minROI: 20,
        maxStartingBid: null,
        maxRehab: 100000,
        minProfit: null,
        maxRisk: 50,
        propertyTypes: ['SFR', 'Condo'],
        minBedrooms: 0
    },
    deals: [],
    selectedDeal: null
};

// Sample Data
const sampleDeals = [
    {
        id: 1,
        address: '1247 Peachtree St NE',
        parcelId: '14-0089-0032-125',
        county: 'Fulton, GA',
        city: 'Atlanta',
        propertyType: 'SFR',
        bedrooms: 3,
        bathrooms: 2,
        sqft: 1850,
        startingBid: 142500,
        arv: 285000,
        roi: 42.1,
        profit: 89320,
        riskScore: 28,
        dealScore: 94,
        auctionDate: '2026-02-15',
        rehabCost: 45000
    },
    {
        id: 2,
        address: '456 Maple Grove Ave',
        parcelId: '28-0156-0087-042',
        county: 'Wayne, PA',
        city: 'Radnor',
        propertyType: 'SFR',
        bedrooms: 4,
        bathrooms: 3,
        sqft: 2200,
        startingBid: 178000,
        arv: 320000,
        roi: 38.2,
        profit: 67450,
        riskScore: 22,
        dealScore: 91,
        auctionDate: '2026-02-20',
        rehabCost: 52000
    },
    {
        id: 3,
        address: '2890 Riverside Dr',
        parcelId: '14-0234-0091-087',
        county: 'Cobb, GA',
        city: 'Marietta',
        propertyType: 'SFR',
        bedrooms: 3,
        bathrooms: 2,
        sqft: 1650,
        startingBid: 125000,
        arv: 235000,
        roi: 31.8,
        profit: 52100,
        riskScore: 45,
        dealScore: 82,
        auctionDate: '2026-03-01',
        rehabCost: 38000
    },
    {
        id: 4,
        address: '1133 Highland Ave',
        parcelId: '14-0145-0023-056',
        county: 'Fulton, GA',
        city: 'Atlanta',
        propertyType: 'Condo',
        bedrooms: 2,
        bathrooms: 1,
        sqft: 950,
        startingBid: 95000,
        arv: 165000,
        roi: 28.4,
        profit: 41200,
        riskScore: 32,
        dealScore: 78,
        auctionDate: '2026-02-15',
        rehabCost: 22000
    },
    {
        id: 5,
        address: '789 Oak Tree Lane',
        parcelId: '13-0201-0067-091',
        county: 'DeKalb, GA',
        city: 'Decatur',
        propertyType: 'SFR',
        bedrooms: 3,
        bathrooms: 2.5,
        sqft: 1750,
        startingBid: 135000,
        arv: 228000,
        roi: 24.3,
        profit: 38450,
        riskScore: 38,
        dealScore: 73,
        auctionDate: '2026-03-05',
        rehabCost: 42000
    }
];

// =========================================
// Initialization
// =========================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    state.deals = sampleDeals;

    // Setup navigation
    setupNavigation();

    // Setup slider updates
    setupSliders();

    // Render initial view
    renderDashboard();

    // Setup event listeners
    setupEventListeners();
}

// =========================================
// Navigation
// =========================================

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.getAttribute('data-view');
            switchView(view);

            // Update active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function switchView(viewName) {
    state.currentView = viewName;

    // Hide all views
    document.querySelectorAll('.view-container').forEach(view => {
        view.classList.remove('active');
    });

    // Show selected view
    const viewElement = document.getElementById(`${viewName}-view`);
    if (viewElement) {
        viewElement.classList.add('active');

        // Render view-specific content
        switch(viewName) {
            case 'dashboard':
                renderDashboard();
                break;
            case 'deals':
                renderDealsTable();
                break;
            case 'analytics':
                // TODO: Implement analytics view
                break;
            case 'portfolio':
                // TODO: Implement portfolio view
                break;
        }
    }
}

// =========================================
// Dashboard Rendering
// =========================================

function renderDashboard() {
    updateKPIs();
    renderCharts();
}

function updateKPIs() {
    const totalCount = state.deals.length;
    const topDeals = state.deals.filter(d => d.dealScore >= 85).length;
    const avgROI = (state.deals.reduce((sum, d) => sum + d.roi, 0) / totalCount).toFixed(1);
    const avgProfit = (state.deals.reduce((sum, d) => sum + d.profit, 0) / totalCount).toFixed(0);

    document.querySelector('#totalCount').textContent = totalCount;
    document.querySelector('#topDealsCount').textContent = topDeals;
    document.querySelector('#avgROI').textContent = avgROI + '%';
    document.querySelector('#avgProfit').textContent = '$' + formatNumber(avgProfit);
}

function renderCharts() {
    renderROIChart();
    renderRiskChart();
}

function renderROIChart() {
    const ctx = document.getElementById('roiChart');
    if (!ctx) return;

    // Destroy existing chart if any
    if (window.roiChartInstance) {
        window.roiChartInstance.destroy();
    }

    // Group deals by ROI ranges
    const ranges = {
        '0-20%': 0,
        '20-30%': 0,
        '30-40%': 0,
        '40%+': 0
    };

    state.deals.forEach(deal => {
        if (deal.roi < 20) ranges['0-20%']++;
        else if (deal.roi < 30) ranges['20-30%']++;
        else if (deal.roi < 40) ranges['30-40%']++;
        else ranges['40%+']++;
    });

    window.roiChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(ranges),
            datasets: [{
                label: 'Number of Deals',
                data: Object.values(ranges),
                backgroundColor: [
                    '#E5E7EB',
                    '#FEF3C7',
                    '#D1FAE5',
                    '#10B981'
                ],
                borderColor: [
                    '#9CA3AF',
                    '#F59E0B',
                    '#10B981',
                    '#059669'
                ],
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#1F2937',
                    padding: 12,
                    titleFont: { size: 14, weight: '600' },
                    bodyFont: { size: 13 },
                    cornerRadius: 8
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        font: { size: 12 }
                    },
                    grid: {
                        color: '#F3F4F6'
                    }
                },
                x: {
                    ticks: {
                        font: { size: 12 }
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderRiskChart() {
    const ctx = document.getElementById('riskChart');
    if (!ctx) return;

    // Destroy existing chart if any
    if (window.riskChartInstance) {
        window.riskChartInstance.destroy();
    }

    // Group deals by risk levels
    const riskLevels = {
        'Low (0-30)': 0,
        'Medium (31-60)': 0,
        'High (61-100)': 0
    };

    state.deals.forEach(deal => {
        if (deal.riskScore <= 30) riskLevels['Low (0-30)']++;
        else if (deal.riskScore <= 60) riskLevels['Medium (31-60)']++;
        else riskLevels['High (61-100)']++;
    });

    window.riskChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(riskLevels),
            datasets: [{
                data: Object.values(riskLevels),
                backgroundColor: [
                    '#10B981',
                    '#F59E0B',
                    '#EF4444'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 16,
                        font: { size: 12 },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: '#1F2937',
                    padding: 12,
                    titleFont: { size: 14, weight: '600' },
                    bodyFont: { size: 13 },
                    cornerRadius: 8
                }
            },
            cutout: '65%'
        }
    });
}

// =========================================
// Deals Table Rendering
// =========================================

function renderDealsTable() {
    const tbody = document.getElementById('dealsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    state.deals.forEach(deal => {
        const row = createDealRow(deal);
        tbody.appendChild(row);
    });
}

function createDealRow(deal) {
    const tr = document.createElement('tr');

    // Add top-deal class for high-scoring deals
    if (deal.dealScore >= 85) {
        tr.classList.add('top-deal');
    }

    tr.innerHTML = `
        <td><input type="checkbox" data-deal-id="${deal.id}"></td>
        <td class="address-cell">
            <strong>${deal.address}</strong>
            <span class="parcel-id">Parcel: ${deal.parcelId}</span>
        </td>
        <td>${deal.county}</td>
        <td><span class="badge">${deal.propertyType}</span></td>
        <td>${deal.bedrooms} / ${deal.bathrooms}</td>
        <td>$${formatNumber(deal.startingBid)}</td>
        <td>$${formatNumber(deal.arv)}</td>
        <td><span class="metric-pill ${getROIClass(deal.roi)}">${deal.roi.toFixed(1)}%</span></td>
        <td class="positive">$${formatNumber(deal.profit)}</td>
        <td><span class="risk-badge ${getRiskClass(deal.riskScore)}">${deal.riskScore}</span></td>
        <td><span class="score-badge">${deal.dealScore}</span></td>
        <td>
            <button class="btn-icon-sm" title="View details" onclick="viewDealDetails(${deal.id})">
                <i class="fas fa-eye"></i>
            </button>
            <button class="btn-icon-sm" title="Add to portfolio" onclick="addToPortfolio(${deal.id})">
                <i class="fas fa-plus"></i>
            </button>
        </td>
    `;

    return tr;
}

function getROIClass(roi) {
    if (roi >= 35) return 'success';
    if (roi >= 25) return 'warning';
    return 'info';
}

function getRiskClass(risk) {
    if (risk <= 30) return 'low';
    if (risk <= 60) return 'medium';
    return 'high';
}

// =========================================
// Slider Updates
// =========================================

function setupSliders() {
    // Min ROI slider
    const minROISlider = document.getElementById('minROI');
    const minROIValue = document.getElementById('minROIValue');

    if (minROISlider && minROIValue) {
        minROISlider.addEventListener('input', (e) => {
            const value = e.target.value;
            minROIValue.textContent = value + '%';
            state.filters.minROI = parseInt(value);
        });
    }

    // Max Risk slider
    const maxRiskSlider = document.getElementById('maxRisk');
    const maxRiskValue = document.getElementById('maxRiskValue');

    if (maxRiskSlider && maxRiskValue) {
        maxRiskSlider.addEventListener('input', (e) => {
            const value = e.target.value;
            maxRiskValue.textContent = value;
            state.filters.maxRisk = parseInt(value);
        });
    }
}

// =========================================
// Event Listeners
// =========================================

function setupEventListeners() {
    // Deal search
    const searchInput = document.getElementById('dealSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterDeals(e.target.value);
        });
    }

    // County selector
    const countySelector = document.querySelector('.county-selector');
    if (countySelector) {
        countySelector.addEventListener('change', (e) => {
            state.selectedCounty = e.target.value;
            // TODO: Load deals for selected county
            console.log('County changed to:', e.target.value);
        });
    }
}

// =========================================
// Deal Actions
// =========================================

function viewDealDetails(dealId) {
    const deal = state.deals.find(d => d.id === dealId);
    if (!deal) return;

    state.selectedDeal = deal;

    // TODO: Implement property detail modal
    console.log('View deal:', deal);
    alert(`Deal Details:\n\nAddress: ${deal.address}\nROI: ${deal.roi}%\nProfit: $${formatNumber(deal.profit)}`);
}

function addToPortfolio(dealId) {
    const deal = state.deals.find(d => d.id === dealId);
    if (!deal) return;

    // TODO: Implement add to portfolio functionality
    console.log('Add to portfolio:', deal);
    alert(`Added ${deal.address} to portfolio!`);
}

// =========================================
// Utility Functions
// =========================================

function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num);
}

function formatCurrency(num) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
}

function filterDeals(searchTerm) {
    // TODO: Implement deal filtering
    console.log('Filtering deals by:', searchTerm);
}

// =========================================
// Export Functionality
// =========================================

function exportDeals() {
    // TODO: Implement export functionality
    console.log('Exporting deals...');
    alert('Export functionality will be connected to the backend execution scripts.');
}

// =========================================
// Data Loading
// =========================================

async function loadCountyData(county) {
    // TODO: Connect to backend execution scripts
    // This would call the Python scripts in execution/
    console.log('Loading data for:', county);
}

async function runAnalysis(params) {
    // TODO: Connect to orchestrator.py
    // This would trigger the full analysis pipeline
    console.log('Running analysis with params:', params);
}

// =========================================
// Console Message
// =========================================

console.log('%cBidWise AI', 'font-size: 24px; font-weight: bold; color: #0066FF;');
console.log('%cIntelligent Real Estate Investment Platform', 'font-size: 14px; color: #6B7280;');
console.log('%c\nUI loaded successfully!', 'color: #10B981; font-weight: bold;');
console.log('\nTo connect to backend:');
console.log('1. Run Python execution scripts from execution/ folder');
console.log('2. Update loadCountyData() to call your scripts');
console.log('3. Update runAnalysis() to call orchestrator.py');
