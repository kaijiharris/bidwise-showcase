# BidWise AI - Professional UI

**Intelligent Real Estate Investment Analysis Platform**

---

## Overview

BidWise AI is the professional frontend interface for the Real Estate Investment System. It provides an intuitive, data-driven dashboard for analyzing auction properties, tax liens, and OTC deals across multiple counties.

This UI follows the **3-layer architecture** defined in [CLAUDE.md](../CLAUDE.md):
- **Layer 1 (Directives)**: SOPs in `directives/` define what to do
- **Layer 2 (Orchestration)**: Python orchestrator makes decisions
- **Layer 3 (Execution)**: Python scripts in `execution/` do the work

The UI serves as the **presentation layer** that visualizes data from the execution layer.

---

## Features

### 🎯 Dashboard View
- **KPI Cards**: Total properties, top deals, average ROI, average profit
- **Interactive Charts**: Deal distribution by ROI and risk assessment
- **Top Opportunities**: Quick view of highest-scoring deals
- **AI-Powered Insights**: Market trends and recommendations

### 💎 Deals View
- **Advanced Filtering**: Filter by ROI, budget, rehab costs, risk levels
- **Sortable Data Table**: Click column headers to sort
- **Property Details**: Comprehensive information for each property
- **Bulk Actions**: Select multiple properties for export or analysis

### 📊 Analytics View (Coming Soon)
- Market trend analysis
- Historical performance tracking
- Comparative market analysis

### 💼 Portfolio View (Coming Soon)
- Track selected properties
- Monitor bid status
- Post-acquisition tracking

---

## Getting Started

### Quick Launch

1. **Open the UI**
   ```bash
   # Navigate to the UI folder
   cd ui-prototype

   # Open in VS Code with Live Server (recommended)
   # Right-click on index-bidwise.html → "Open with Live Server"

   # Or open directly in browser
   start index-bidwise.html
   ```

2. **Explore the Interface**
   - Navigate between views using the top navigation bar
   - Use the county selector to switch between auction datasets
   - Apply filters in the Deals view to find opportunities
   - Click on properties to view detailed analysis

---

## Architecture Integration

### How It Connects to the 3-Layer System

```
┌─────────────────────────────────────────────────────────┐
│                    BidWise AI UI                        │
│                (Presentation Layer)                      │
│  • Dashboard visualization                               │
│  • Deal filtering and sorting                            │
│  • User input collection                                 │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ API Calls / File Exports
                   │
┌──────────────────▼──────────────────────────────────────┐
│              Layer 2: Orchestration                      │
│                 (orchestrator.py)                        │
│  • Read directives                                       │
│  • Route to execution scripts                            │
│  • Handle errors and decisions                           │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ Function Calls
                   │
┌──────────────────▼──────────────────────────────────────┐
│              Layer 3: Execution                          │
│           (Python scripts in execution/)                 │
│  • Scrape auction sites                                  │
│  • Enrich property data                                  │
│  • Calculate valuations                                  │
│  • Generate Excel exports                                │
└─────────────────────────────────────────────────────────┘
```

### Current Implementation

**Frontend → Backend Integration (To Be Implemented)**

1. **Import Auction Data**
   - UI Button: "Import Auction"
   - Backend: `execution/run_[county]_analysis.py`
   - Directive: `directives/county_analysis_procedure.md`

2. **Run Analysis**
   - UI Button: "New Analysis"
   - Backend: `orchestrator.py` → `DealOrchestrator.process_deals()`
   - Directive: `directives/find_deals.md`

3. **Export Results**
   - UI Button: "Export Results"
   - Backend: `execution/export/spreadsheet_generator.py`
   - Output: `.tmp/[county]_deals_[timestamp].xlsx`

4. **View County Data**
   - UI Dropdown: County Selector
   - Backend: Load from database or cached JSON
   - Source: Results from previous analyses

---

## File Structure

```
ui-prototype/
├── index-bidwise.html      # Main HTML file (BidWise AI branded)
├── styles-bidwise.css      # Professional styling
├── script-bidwise.js       # JavaScript functionality
├── BIDWISE_README.md       # This file
│
├── index.html              # Original prototype
├── styles.css              # Original styles
└── script.js               # Original scripts
```

---

## Customization

### Branding

**Colors** - Edit `styles-bidwise.css`:
```css
:root {
    --primary-brand: #0066FF;      /* Main brand color */
    --accent-purple: #7C3AED;      /* Accent color */
    --success: #10B981;            /* Success indicators */
    --warning: #F59E0B;            /* Warning indicators */
    --danger: #EF4444;             /* Danger/risk indicators */
}
```

**Logo** - Replace in `index-bidwise.html`:
```html
<div class="logo-icon">
    <i class="fas fa-brain"></i>   <!-- Replace with your icon -->
</div>
```

### Data Integration

**Connect to Python Backend** - Edit `script-bidwise.js`:

```javascript
// Load county data from Python execution scripts
async function loadCountyData(county) {
    // Option 1: Call Python script directly (requires backend API)
    const response = await fetch(`/api/counties/${county}/deals`);
    const data = await response.json();
    state.deals = data.deals;

    // Option 2: Load from JSON file generated by Python
    const response = await fetch(`.tmp/${county}_deals.json`);
    const data = await response.json();
    state.deals = data;

    renderDashboard();
}

// Trigger new analysis
async function runAnalysis(params) {
    // Call orchestrator.py via API endpoint
    const response = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify(params)
    });
    const result = await response.json();
    console.log('Analysis complete:', result);
}
```

### Adding New Views

1. **Add HTML container** in `index-bidwise.html`:
```html
<div id="new-view" class="view-container">
    <h2>New View Title</h2>
    <!-- Your content here -->
</div>
```

2. **Add navigation button**:
```html
<button class="nav-item" data-view="new-view">
    <i class="fas fa-icon"></i>
    <span>New View</span>
</button>
```

3. **Add render function** in `script-bidwise.js`:
```javascript
function renderNewView() {
    // Your rendering logic
}
```

---

## Workflow: From UI to Execution

### Example: User Wants to Analyze Fulton County Deals

1. **User Action**: Selects "Fulton County, GA - February 2026" from dropdown

2. **UI Layer** (`index-bidwise.html`):
   - Dropdown change event triggers
   - Calls `loadCountyData('Fulton, GA, February 2026')`

3. **JavaScript** (`script-bidwise.js`):
   - Makes API call or checks for cached data
   - If no data exists, triggers new scrape/analysis
   - Calls backend: `POST /api/analyze`

4. **Orchestrator** (`orchestrator.py`):
   - Reads directive: `directives/find_deals.md`
   - Identifies execution scripts needed:
     - `execution/run_fulton_analysis.py`
   - Calls execution scripts in order
   - Handles errors via self-annealing loop

5. **Execution Scripts** (`execution/`):
   - `run_fulton_analysis.py` scrapes auction data
   - Stores in `.tmp/fulton_scraped_deals.json`
   - Enriches data (ARV, comps, risk scores)
   - Calculates valuation (ROI, profit)
   - Generates Excel: `.tmp/fulton_ga_deals_20260211.xlsx`

6. **Results Back to UI**:
   - JavaScript loads JSON data
   - Updates KPI cards
   - Renders charts
   - Populates deals table
   - User can now filter and analyze

---

## Sample Data

The UI includes 5 sample properties for demonstration:

| Address | County | ROI | Profit | Risk | Score |
|---------|--------|-----|--------|------|-------|
| 1247 Peachtree St NE | Fulton, GA | 42.1% | $89,320 | 28 | 94 |
| 456 Maple Grove Ave | Wayne, PA | 38.2% | $67,450 | 22 | 91 |
| 2890 Riverside Dr | Cobb, GA | 31.8% | $52,100 | 45 | 82 |
| 1133 Highland Ave | Fulton, GA | 28.4% | $41,200 | 32 | 78 |
| 789 Oak Tree Lane | DeKalb, GA | 24.3% | $38,450 | 38 | 73 |

To load real data, connect the UI to your Python backend (see "Data Integration" above).

---

## Next Steps

### Immediate Tasks
- [ ] Add backend API endpoints for data loading
- [ ] Connect "Import Auction" button to Python scraper
- [ ] Connect "New Analysis" button to orchestrator
- [ ] Implement real-time progress updates during analysis
- [ ] Add property detail modal with full information

### Future Enhancements
- [ ] WebSocket connection for live updates
- [ ] User authentication and preferences
- [ ] Saved filter presets
- [ ] Portfolio tracking and management
- [ ] Mobile-responsive design
- [ ] Dark mode toggle
- [ ] Email alerts for new opportunities

---

## Troubleshooting

**Charts not rendering?**
- Check that Chart.js CDN is loading
- Open browser console (F12) for errors
- Verify chart canvas elements exist in HTML

**Sample data not showing?**
- Check browser console for JavaScript errors
- Verify `script-bidwise.js` is loaded after `index-bidwise.html`

**Styles not applying?**
- Clear browser cache (Ctrl+Shift+R)
- Verify `styles-bidwise.css` is linked correctly
- Check for CSS syntax errors

**Python integration not working?**
- Ensure Python scripts are in correct paths
- Verify `.env` configuration
- Check Python execution logs in `logs/`

---

## Technology Stack

**Frontend**
- HTML5
- CSS3 (Custom Variables, Flexbox, Grid)
- Vanilla JavaScript (ES6+)
- Chart.js 4.4.0 (for visualizations)
- Font Awesome 6.4.0 (for icons)

**Backend** (Python)
- Orchestrator: `orchestrator.py`
- Database: SQLite (`real_estate.db`)
- Execution scripts: `execution/` folder
- Directives: `directives/` folder

**Deployment Options**
- Static hosting (GitHub Pages, Netlify, Vercel)
- Electron app for desktop
- Python Flask/FastAPI for full-stack
- Tauri for lightweight desktop app

---

## Support

For questions or issues:
1. Review `CLAUDE.md` for system architecture
2. Check `directives/` for workflow details
3. Review Python execution logs
4. Consult `README.md` for installation help

---

## License

Internal use only. Not for redistribution.

---

**BidWise AI** - Making intelligent real estate investment decisions through data-driven analysis.

*Version 1.0 - February 2026*
