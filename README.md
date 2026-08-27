# Real Estate Investment System

A production-ready MVP system for discovering and analyzing discounted real-estate properties from auctions, tax liens, and over-the-counter (OTC) sources.

## Overview

This system automates the discovery, enrichment, valuation, and filtering of investment opportunities to surface the best deals as downloadable spreadsheets.

**Target Markets (MVP):**
- **Florida**: Orange County, Pinellas County
- **Georgia**: Fulton County, Gwinnett County, Cobb County

**Data Sources:**
- Live auctions (foreclosure, tax deed)
- Tax liens
- Over-the-counter (OTC) properties

**Output:**
- Excel spreadsheets with 100+ candidate properties
- Enriched with comps, risk scores, ARV, all-in costs
- Filtered by user criteria (budget, ROI, strategy, risk)
- Includes "exceptional ROI" deals outside filters

---

## Architecture

The system follows a **3-layer architecture** for maintainability:

```
┌────────────────────────────────────────┐
│   Layer 1: Directives (SOPs in MD)    │
├────────────────────────────────────────┤
│   Layer 2: Orchestration (CLI/API)    │
├────────────────────────────────────────┤
│   Layer 3: Execution (Python scripts) │
│   • Connectors  • Enrichment           │
│   • Valuation   • Export               │
│   Database: PostgreSQL                 │
└────────────────────────────────────────┘
```

**Key Components:**
- **Connectors**: Ingest data from auctions, tax liens, county portals
- **Enrichment**: Add comps, risk scores (crime, flood, fire), lien data
- **Valuation**: Calculate all-in costs, ROI, IRR for flip/rental strategies
- **Scoring**: Composite deal scores combining ROI, risk, and filter match
- **Export**: Generate formatted Excel spreadsheets

---

## Prerequisites

- **Python**: 3.11 or higher
- **PostgreSQL**: 14 or higher
- **Operating System**: Windows, macOS, or Linux

---

## Installation

### 1. Clone or Navigate to Project

```powershell
cd <repo-root>
```

### 2. Create Virtual Environment

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 3. Install Dependencies

```powershell
pip install -r requirements.txt
```

### 4. Install Playwright Browsers (for web scraping)

```powershell
playwright install chromium
```

### 5. Set Up Database

Create a PostgreSQL database:

```sql
CREATE DATABASE real_estate_investment;
CREATE USER rei_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE real_estate_investment TO rei_user;
```

### 6. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://rei_user:your_password@localhost:5432/real_estate_investment
ENVIRONMENT=development
LOG_LEVEL=INFO
```

### 7. Initialize Database Tables

```powershell
python -c "from execution.db import db; db.create_all_tables()"
```

---

## Quick Start

### Run a Property Search

```powershell
python main.py query \
  --state FL \
  --county Orange \
  --strategy flip \
  --budget 150000 \
  --min-roi 20 \
  --max-rehab 50000 \
  --max-risk 50 \
  --output deals.xlsx
```

**Parameters:**
- `--state`: State code (FL, GA)
- `--county`: County name (Orange, Pinellas, Fulton, Gwinnett, Cobb) - can specify multiple
- `--strategy`: Investment strategy (`flip`, `rental`, `wholesale`)
- `--budget`: Maximum all-in budget
- `--min-roi`: Minimum ROI percentage
- `--max-rehab`: Maximum rehab cost tolerance
- `--max-risk`: Maximum risk score (0-100, lower is better)
- `--output`: Output filename (defaults to timestamped file)

### Ingest Data (Manual)

```powershell
# Ingest auction data
python main.py ingest --source auction --state FL --county Orange

# Ingest tax lien data
python main.py ingest --source tax_lien --state GA --county Fulton
```

**Note**: For MVP, ingestion connectors need to be completed (see Development Roadmap below).

---

## Configuration

### Adjusting Cost Assumptions

Edit `config/markets/florida.yaml` or `config/markets/georgia.yaml`:

```yaml
costs:
  rehab_per_sqft:
    light: 15    # Cosmetic rehab
    medium: 40   # Moderate rehab
    heavy: 75    # Extensive rehab
  
  buyers_premium_pct: 10
  closing_costs_pct: 3
  # ... etc
```

### Adjusting Scoring Weights

Edit `config/default.yaml`:

```yaml
scoring:
  weights:
    roi: 0.50         # 50% weight on ROI
    risk: 0.30        # 30% weight on risk
    filter_match: 0.20  # 20% weight on filter match
```

### Adding New Markets

1. Create `config/markets/new_state.yaml`
2. Follow the structure of existing state configs
3. Add county-specific data sources and cost adjustments

---

## Project Structure

```
real-estate-system/
├── directives/              # SOPs for each workflow
├── execution/               # Python scripts
│   ├── connectors/         # Data ingestion
│   ├── enrichment/         # Comps, risk scoring
│   ├── valuation/          # Cost & ROI calculations
│   ├── export/             # Spreadsheet generation
│   ├── db/                 # Database models
│   └── utils/              # Config, logging
├── config/                  # Configuration files
│   ├── default.yaml        # System-wide defaults
│   └── markets/            # Market-specific configs
├── tests/                   # Unit and integration tests
├── logs/                    # Application logs
├── .tmp/                    # Temporary files (gitignored)
├── main.py                  # CLI entry point
├── orchestrator.py          # Workflow coordination
├── requirements.txt         # Python dependencies
├── .env                     # Environment variables (create from .env.example)
├── README.md                # This file
└── OPERATOR_GUIDE.md        # Detailed usage guide
```

---

## Development Roadmap

**Phase 1: Foundation** ✅
- [x] Project structure
- [x] Database models
- [x] Configuration system
- [x] Valuation engine (cost calculator, ROI calculator, deal scorer)
- [x] Spreadsheet export

**Phase 2: Data Ingestion** (In Progress)
- [ ] Auction connector (Bid4Assets, county portals)
- [ ] Tax lien connector (county CSV downloads)
- [ ] OTC connector (county REO lists)
- [ ] Property data enrichment (free county sources)

**Phase 3: Enrichment** (Planned)
- [ ] Comps engine (nearby sales)
- [ ] Risk scoring (crime, flood, fire data)
- [ ] Lien analysis

**Phase 4: Orchestration** (Planned)
- [ ] CLI implementation
- [ ] Query filtering logic
- [ ] Exceptional deal detection

**Phase 5: Testing & Polish** (Planned)
- [ ] Unit tests for valuation
- [ ] Integration tests
- [ ] Real-world validation
- [ ] Documentation

---

## Testing

```powershell
# Run unit tests
pytest tests/unit/ -v

# Run integration tests
pytest tests/integration/ -v

# Run with coverage
pytest --cov=execution tests/
```

---

## Logging

Logs are written to:
- **Console**: Colored, human-readable
- **File**: `logs/rei_system.log` (rotated at 10MB, 30-day retention)

Log level can be adjusted in `.env`:

```env
LOG_LEVEL=DEBUG  # DEBUG, INFO, WARNING, ERROR
```

---

## Legal & Disclaimers

⚠️ **This system is for decision support only and does NOT constitute financial, legal, or investment advice.**

- All estimates are based on available data and may be incomplete
- Independent due diligence is REQUIRED before any investment
- Conduct professional title search, property inspection, environmental assessment
- Verify zoning, permits, liens, and redemption rights
- Ensure compliance with all applicable laws

---

## Support & Contribution

This is a solo-developer project for a solo-founder business.

**For questions or issues:**
- Check `OPERATOR_GUIDE.md` for detailed instructions
- Review logs in `logs/rei_system.log`
- Consult the configuration files for customization

**Extending the system:**
- New data sources: Create new connector in `execution/connectors/`
- New risk factors: Add to `execution/enrichment/`
- New metrics: Extend `execution/valuation/`

---

## License

Internal use only. Not for redistribution.

---

**Version**: 1.0.0-mvp  
**Last Updated**: 2025-12-16  
**Author**: Antigravity Agent + Solo Founder
