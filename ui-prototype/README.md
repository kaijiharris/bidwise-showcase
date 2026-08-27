# Real Estate Investment Analysis UI Prototype

This is a fully functional web-based prototype of the Real Estate Investment Analysis system UI. It demonstrates the complete user interface design with interactive features and sample data.

## How to View the Prototype

### Option 1: Using Live Server Extension (Recommended)

1. **Install Live Server extension in VS Code** (if not already installed):
   - Open VS Code Extensions (Ctrl+Shift+X)
   - Search for "Live Server"
   - Install the extension by Ritwick Dey

2. **Launch the prototype**:
   - Right-click on `index.html` in VS Code
   - Select "Open with Live Server"
   - Your browser will automatically open to the prototype

3. **Live editing**: Any changes you make to the HTML, CSS, or JavaScript files will automatically refresh in your browser!

### Option 2: Direct Browser Opening

Simply double-click `index.html` to open it in your default browser. (Note: Some features may require a local server, so Live Server is preferred.)

## Features Demonstrated

### 1. **Three Main Views**
   - **Dashboard**: Visual overview with charts showing deal distribution and risk analysis
   - **Properties Grid**: Sortable, filterable table of all properties with key metrics
   - **Best Deals**: Ranked list of top opportunities with customizable ranking weights

### 2. **Interactive Filtering**
   - Min ROI slider
   - Max rehab cost filter
   - Risk level filtering
   - "Top Deals Only" quick filter
   - Real-time quick search

### 3. **Property Detail Panel**
   - Automatic slide-in when you select a property
   - Four tabs: Summary, Financials, Comps, Public Records
   - Editable scenario inputs (UI demonstration)
   - Visual risk score indicator

### 4. **Data Grid Features**
   - Click column headers to sort
   - Frozen first column for easy scrolling
   - Color-coded rows (green for top deals, red for high risk)
   - Selection highlighting

### 5. **Export Functionality**
   - Export modal with multiple options
   - Scope selection (all, filtered, selected)
   - Format options

## Making Edits

### Changing Colors

Edit `styles.css` and modify the CSS variables at the top:

```css
:root {
    --primary-blue: #3498DB;     /* Change primary color */
    --success-green: #27AE60;     /* Change success indicators */
    --danger-red: #E74C3C;        /* Change warning colors */
    /* ... more variables */
}
```

### Modifying Layout

- **Left panel width**: Search for `.left-panel { width: 280px; }` in `styles.css`
- **Right panel width**: Search for `.right-panel { width: 400px; }` in `styles.css`
- **Top bar height**: Search for `.top-bar { height: 60px; }` in `styles.css`

### Adding Sample Data

Edit `script.js` and add more properties to the `sampleProperties` array at the top of the file.

### Changing Functionality

All interactive logic is in `script.js`:
- Filtering logic: `applyFilters()` function
- Sorting logic: `sortTable()` function
- Property selection: `selectProperty()` function
- Chart rendering: `renderCharts()` function

## File Structure

```
ui-prototype/
├── index.html       # Main HTML structure
├── styles.css       # All styles and visual design
├── script.js        # Interactive functionality and sample data
└── README.md        # This file
```

## Sample Data

The prototype includes 5 sample properties with realistic data:
- Mix of low, medium, and high risk properties
- Various ROI levels (24% - 42%)
- Different property types and locations
- Complete financial breakdowns

## Converting to .NET Desktop Application

When you're ready to implement this in Visual Studio:

### WPF Implementation

1. **Main Window**: Use the layout structure from `index.html` as a guide for XAML Grid and Panel structure
2. **DataGrid**: Map the HTML table to WPF `<DataGrid>` with similar columns
3. **Styling**: Convert CSS styles to WPF ResourceDictionary styles
4. **Charts**: Use LiveCharts.Wpf or OxyPlot packages
5. **View Models**: Follow the data structure in `script.js` for your C# ViewModels

### Key Mappings

| HTML/CSS | WPF Equivalent |
|----------|----------------|
| `<div class="card">` | `<Border>` with style |
| `<table class="data-grid">` | `<DataGrid>` |
| `<select>` | `<ComboBox>` |
| `<input type="range">` | `<Slider>` |
| `<button class="btn-primary">` | `<Button>` with style |
| CSS classes | WPF Styles in ResourceDictionary |
| JavaScript functions | ViewModel methods and Commands |

## Browser Compatibility

This prototype works best in modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari

## Notes for Development

- The charts use Chart.js library (loaded from CDN)
- Icons use Font Awesome (loaded from CDN)
- All interactions are client-side only (no backend required)
- Sample data is hardcoded in `script.js`

## Next Steps

1. **Review and test** all interactive features
2. **Customize colors and spacing** to your preference
3. **Add more sample data** if needed to test with larger datasets
4. **Take screenshots** or recordings for reference during .NET implementation
5. **Map components** to WPF/WinForms equivalents using the guide above

---

Enjoy exploring the prototype! Make any changes you like - it's a live, editable preview of your application UI.
