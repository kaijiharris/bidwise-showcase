"""CLI entry point for Real Estate Investment System."""
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

import click
from loguru import logger

from orchestrator import DealOrchestrator
from execution.utils import config


@click.group()
def cli():
    """Real Estate Investment System - Find and analyze profitable deals."""
    pass


@cli.command()
@click.option('--state', required=True, help='State code (FL, GA)')
@click.option('--county', required=True, help='County name')
@click.option('--strategy', default='flip', help='Investment strategy (flip, rental)')
@click.option('--budget', type=int, required=True, help='Maximum all-in budget')
@click.option('--min-roi', type=float, default=15.0, help='Minimum ROI percentage')
@click.option('--max-rehab', type=int, help='Maximum rehab cost')
@click.option('--max-risk', type=int, default=50, help='Maximum risk score (0-100)')
@click.option('--output', help='Output filename (optional)')
def find_deals(state, county, strategy, budget, min_roi, max_rehab, max_risk, output):
    """
    Find investment deals based on your criteria.
    
    This command is designed to work with Antigravity agent, who will:
    1. Scrape property data from auction sites, tax lien sales, county portals
    2. Enrich with comps and risk data
    3. Calculate costs and ROI
    4. Generate a ranked spreadsheet
    
    Example:
        python main.py find-deals --state GA --county Fulton --budget 200000 --min-roi 20 --strategy flip
    """
    click.echo(f"\n🔍 Finding {strategy} deals in {county} County, {state}...")
    click.echo(f"📊 Criteria: Budget ${budget:,} | Min ROI {min_roi}% | Max Risk {max_risk}")
    
    # Build user filters
    user_filters = {
        'strategy': strategy,
        'budget': budget,
        'min_roi': min_roi,
        'max_risk': max_risk
    }
    
    if max_rehab:
        user_filters['max_rehab'] = max_rehab
    
    click.echo(f"\n⚠️  NOTE: This command requires Antigravity agent to scrape and enrich property data.")
    click.echo(f"Please use this via the agent workflow, not standalone.\n")
    
    # This would be called by orchestrator with scraped data
    # For now, just show what would happen
    click.echo(f"Agent will:")
    click.echo(f"  1. Search auction platforms and county portals")
    click.echo(f"  2. Scrape property listings for {county} County, {state}")
    click.echo(f"  3. Enrich with comps, crime data, flood zones")
    click.echo(f"  4. Calculate all-in costs and ROI")
    click.echo(f"  5. Generate ranked spreadsheet")
    click.echo(f"\nSee directives/find_deals.md for full workflow.")


@cli.command()
def init_db():
    """Initialize database tables."""
    from init_db import init_database
    
    click.echo("🗄️  Initializing database...")
    success = init_database()
    
    if success:
        click.echo("✅ Database initialized successfully!")
    else:
        click.echo("❌ Database initialization failed. Check logs.")
        sys.exit(1)


@cli.command()
@click.option('--state', required=True, help='State code (FL, GA)')
@click.option('--county', help='County name (optional)')
def show_config(state, county):
    """Show configuration for a state/county."""
    click.echo(f"\n📋 Configuration for {state}" + (f" - {county}" if county else ""))
    click.echo("=" * 60)
    
    # Load market config
    market_config = config.load_market_config(state)
    
    click.echo(f"\nState: {market_config.get('state_name')}")
    click.echo(f"Property Tax Rate: {market_config.get('property_tax_rate', 0) * 100:.2f}%")
    
    if county:
        county_config = market_config.get('counties', {}).get(county.lower(), {})
        if county_config:
            click.echo(f"\nCounty: {county_config.get('name')}")
            click.echo(f"Tax Rate: {county_config.get('property_tax_rate', 0) * 100:.2f}%")
            click.echo(f"Median Home Price: ${county_config.get('median_home_price', 0):,}")
            click.echo(f"Investor Activity: {county_config.get('investor_activity')}")
        else:
            click.echo(f"\n❌ County '{county}' not found in {state} config")
    
    # Show cost config
    cost_config = config.get_cost_config(state, county)
    click.echo(f"\nRehab Costs (per sqft):")
    for category, cost in cost_config.get('rehab_per_sqft', {}).items():
        click.echo(f"  {category.capitalize()}: ${cost}/sqft")


if __name__ == '__main__':
    cli()
