# BidWise AI - Quick Launch Guide

## 🚀 Launch the UI in 3 Steps

### Method 1: VS Code Live Server (Recommended)

1. **Install Live Server Extension**
   - Open VS Code Extensions (Ctrl+Shift+X or Cmd+Shift+X)
   - Search for "Live Server" by Ritwick Dey
   - Click "Install"

2. **Launch BidWise AI**
   - Open `ui-prototype/index-bidwise.html` in VS Code
   - Right-click anywhere in the file
   - Select "Open with Live Server"
   - Your browser will open automatically at `http://127.0.0.1:5500/ui-prototype/index-bidwise.html`

3. **Start Exploring**
   - Dashboard loads by default with sample data
   - Click "Deals" in the navigation to see the property table
   - Adjust filters to refine results
   - Click on properties to view details

### Method 2: Direct Browser Opening

1. **Navigate to the folder**
   ```bash
   cd <repo-root>\ui-prototype
   ```

2. **Open in browser**
   ```bash
   # Windows
   start index-bidwise.html

   # Mac
   open index-bidwise.html

   # Linux
   xdg-open index-bidwise.html
   ```

---

## 🎨 What You'll See

### Dashboard View (Default)
- **4 KPI Cards** showing:
  - Total Properties (247)
  - Top Deals (18 with ROI > 30%)
  - Average Projected Profit ($45.2K)
  - Average ROI (28.4%)

- **2 Interactive Charts**:
  - Deal Distribution by ROI (bar chart)
  - Risk Assessment Overview (doughnut chart)

- **Top 5 Opportunities** with:
  - Property address
  - County and property details
  - ROI and profit metrics
  - Color-coded icons (green = excellent, yellow = good, blue = solid)

- **AI-Powered Insights** section with:
  - Market opportunity alerts
  - Risk warnings
  - Trend analysis

### Deals View
- **Left Sidebar Filters**:
  - Min ROI slider (currently set to 20%)
  - Max Starting Bid
  - Max Rehab Cost ($100,000)
  - Min Profit
  - Property Type checkboxes
  - Bedrooms dropdown
  - Max Risk Score slider (currently set to 50)

- **Main Content**:
  - Search box for quick filtering
  - Sortable data table with columns:
    - Checkbox for selection
    - Address (with parcel ID)
    - County
    - Property Type
    - Bed/Bath
    - Starting Bid
    - ARV (After Repair Value)
    - ROI % (color-coded)
    - Projected Profit
    - Risk Score (color-coded: green = low, yellow = medium, red = high)
    - Deal Score (0-100 scale)
    - Action buttons (view details, add to portfolio)
  - Pagination controls
  - Results per page selector

### Navigation
- **Dashboard** - Visual overview and KPIs
- **Deals** - Detailed property table with filters
- **Analytics** - Coming soon
- **Portfolio** - Coming soon

---

## 🔧 Connecting to Your Python Backend

The UI currently shows sample data. To connect it to your real execution scripts:

### Step 1: Expose Python Scripts as API

Create a simple Flask API wrapper (`api_server.py`):

```python
from flask import Flask, jsonify, request
from flask_cors import CORS
import json
from orchestrator import DealOrchestrator

app = Flask(__name__)
CORS(app)

@app.route('/api/counties/<county>/deals', methods=['GET'])
def get_county_deals(county):
    """Load deals for a specific county"""
    try:
        # Load from cached JSON
        with open(f'.tmp/{county}_deals.json', 'r') as f:
            deals = json.load(f)
        return jsonify({'success': True, 'deals': deals})
    except FileNotFoundError:
        return jsonify({'success': False, 'error': 'No data found'}), 404

@app.route('/api/analyze', methods=['POST'])
def run_analysis():
    """Trigger new analysis"""
    params = request.json

    orchestrator = DealOrchestrator()
    result = orchestrator.process_deals(
        state=params['state'],
        county=params['county'],
        user_filters=params.get('filters', {})
    )

    return jsonify({
        'success': True,
        'spreadsheet': result,
        'message': 'Analysis complete'
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)
```

### Step 2: Update JavaScript to Call API

Edit `script-bidwise.js`:

```javascript
// Replace the loadCountyData function
async function loadCountyData(county) {
    try {
        const response = await fetch(`http://localhost:5000/api/counties/${county}/deals`);
        const data = await response.json();

        if (data.success) {
            state.deals = data.deals;
            renderDashboard();
            renderDealsTable();
        }
    } catch (error) {
        console.error('Failed to load county data:', error);
        // Fall back to sample data
    }
}

// Replace the runAnalysis function
async function runAnalysis(params) {
    try {
        const response = await fetch('http://localhost:5000/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        const result = await response.json();

        if (result.success) {
            alert(`Analysis complete! Spreadsheet: ${result.spreadsheet}`);
            // Reload data
            await loadCountyData(params.county);
        }
    } catch (error) {
        console.error('Analysis failed:', error);
    }
}
```

### Step 3: Run the API Server

```bash
# Install Flask if needed
pip install flask flask-cors

# Start the API server
python api_server.py
```

### Step 4: Launch the UI

Now when you open the UI, it will communicate with your Python backend!

---

## 🎯 Using the UI

### Finding Good Deals

1. **Start with Dashboard**
   - Review the KPI cards to understand the dataset
   - Check the ROI distribution chart - look for deals in the 30-40% and 40%+ ranges
   - Review the risk chart - ideally you want more deals in "Low" risk

2. **Switch to Deals View**
   - Click "Deals" in the top navigation
   - Set your minimum ROI (e.g., 30%)
   - Set your max risk tolerance (e.g., 50 or lower)
   - Apply filters

3. **Sort and Review**
   - Click the "ROI" column header to sort by highest ROI
   - Click the "Score" column header to sort by deal score
   - Top deals (green rows) are your best opportunities

4. **Deep Dive**
   - Click the eye icon to view property details
   - Click the plus icon to add to your shortlist

5. **Export**
   - Select properties using checkboxes
   - Click "Export" button
   - Choose format and scope
   - Download your shortlist

### Understanding the Metrics

- **ROI (Return on Investment)**: Net profit / Total investment cost
  - 🟢 Excellent: 35%+
  - 🟡 Good: 25-35%
  - 🔵 Solid: 20-25%
  - ⚪ Fair: Below 20%

- **Risk Score**: 0-100 scale (lower is better)
  - 🟢 Low: 0-30 (safe neighborhoods, no flood risk)
  - 🟡 Medium: 31-60 (moderate risk factors)
  - 🔴 High: 61-100 (significant risk factors)

- **Deal Score**: 0-100 composite score
  - Calculated from: 50% ROI + 30% Risk + 20% Filter Match
  - Top Deals: 85+ score
  - Good Deals: 70-84 score
  - Fair Deals: Below 70

---

## 📱 Keyboard Shortcuts (Coming Soon)

- `Ctrl+K` - Quick search
- `Ctrl+F` - Advanced filters
- `Ctrl+E` - Export deals
- `Esc` - Close modals/panels

---

## 🐛 Known Limitations

1. **Sample Data Only**: Currently shows 5 sample properties
   - Solution: Connect to Python backend (see above)

2. **No Property Details Modal**: Clicking "View Details" shows alert
   - Solution: Implement full property detail modal

3. **No Real-time Updates**: Data doesn't auto-refresh
   - Solution: Add WebSocket connection or polling

4. **Export Not Functional**: Export button needs backend connection
   - Solution: Connect to `execution/export/spreadsheet_generator.py`

---

## 🎨 Customization Tips

### Change the Primary Color

Edit `styles-bidwise.css`, line 8:
```css
--primary-brand: #0066FF;  /* Change to your brand color */
```

All buttons, badges, and accents will update automatically!

### Add Your Logo

Replace the brain icon in `index-bidwise.html`, line 16:
```html
<i class="fas fa-brain"></i>  <!-- Replace with your icon or <img> tag -->
```

### Modify KPI Cards

Edit `script-bidwise.js`, `updateKPIs()` function to show different metrics.

---

## 📞 Need Help?

1. **UI Issues**: Check browser console (F12) for JavaScript errors
2. **Styling Issues**: Verify CSS file is loaded, clear cache (Ctrl+Shift+R)
3. **Data Issues**: Check Python execution logs in `logs/` folder
4. **Integration Issues**: Review `BIDWISE_README.md` for architecture details

---

## ✅ Checklist: Is It Working?

- [ ] UI opens in browser without errors
- [ ] Dashboard shows KPI cards with numbers
- [ ] Charts render (ROI bar chart, Risk doughnut chart)
- [ ] Top 5 deals list is visible
- [ ] Clicking "Deals" switches to the deals table
- [ ] Table shows 5 sample properties
- [ ] Filters can be adjusted (sliders move)
- [ ] County selector dropdown works
- [ ] Navigation buttons highlight when clicked

If all checked ✅, you're ready to connect the backend!

---

**Happy Deal Hunting! 🏠💰**

*BidWise AI - Where data meets opportunity*
