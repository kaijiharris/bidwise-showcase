import pdfplumber
import re
import pandas as pd
import requests
from bs4 import BeautifulSoup
import time
import json
import os
import dotenv
from pathlib import Path
from execution.enrichment.apify_comps import ApifyZillowComps
from execution.analysis.deterministic_analyzer import DeterministicAnalyzer

def extract_parcels_from_pdf(pdf_path: str, pages_to_scan: int = 50) -> list:
    print(f"Scanning first {pages_to_scan} pages of PDF for parcels...")
    parcels = []
    
    with pdfplumber.open(pdf_path) as pdf:
        num_pages = min(pages_to_scan, len(pdf.pages))
        
        current_parcel = None
        current_address = None
        
        for i in range(num_pages):
            page = pdf.pages[i]
            text = page.extract_text(layout=True)
            if not text:
                continue
                
            lines = text.split('\n')
            for line in lines:
                # Look for Parcel ID line
                # Example: "  06 249 01 015 4301 R WINTERS CHAPEL RD     TAX DISTRICT:..."
                parcel_match = re.match(r'^\s*(\d{2}\s\d{3}\s\d{2}\s\d{3})\s+(.*?)(?:TAX DISTRICT:|DUE DATE:|$)', line)
                if parcel_match:
                    current_parcel = parcel_match.group(1).replace(' ', '')
                    current_address = parcel_match.group(2).strip()
                
                # Look for Grand Total Due
                # Example: "                                                    GRAND TOTAL DUE 21,756.13"
                total_match = re.search(r'GRAND TOTAL DUE\s+([\d,]+\.\d{2})', line)
                if total_match and current_parcel:
                    amount = float(total_match.group(1).replace(',', ''))
                    parcels.append({
                        'tax_id': current_parcel,
                        'tax_due': amount,
                        'pdf_address': current_address
                    })
                    current_parcel = None  # Reset after finding the total for that parcel
                    
    print(f"Extracted {len(parcels)} raw parcels from PDF.")
    return parcels

def scrape_qpublic_dekalb(parcel_id: str) -> dict:
    url = f"https://qpublic.schneidercorp.com/Application.aspx?AppID=943&LayerID=17706&PageTypeID=4&PageID=8484&Q={parcel_id}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code != 200:
            return None
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        data = {'source_url': url}
        
        tables = soup.find_all('table', class_='DataletData')
        for table in tables:
            rows = table.find_all('tr')
            for row in rows:
                cells = row.find_all('td')
                if len(cells) >= 2:
                    key = cells[0].get_text(strip=True).lower()
                    val = cells[1].get_text(strip=True)
                    
                    if 'property class' in key:
                        data['property_class'] = val
                    elif 'location address' in key or 'physical address' in key:
                        data['full_address'] = val
                    elif 'market value' in key or 'assessed value' in key:
                        try:
                            # Extract first numeric value after $
                            match = re.search(r'\$?([\d,]+)', val)
                            if match:
                                data['market_value'] = float(match.group(1).replace(',', ''))
                        except: pass
                    elif 'bedrooms' in key or 'beds' in key:
                        try: data['beds'] = int(val) 
                        except: pass
                    elif 'bathrooms' in key or 'baths' in key:
                        try: data['baths'] = float(val)
                        except: pass
                    elif 'square feet' in key or 'living area' in key:
                        try: data['sqft'] = int(val.replace(',', ''))
                        except: pass
                    elif 'year built' in key:
                        try: data['year_built'] = int(val)
                        except: pass
        
        # Determine strict Property Type
        ptype = data.get('property_class', '').lower()
        if 'residential' in ptype or 'res' in ptype:
            data['property_type'] = 'Residential'
        elif 'commercial' in ptype or 'com' in ptype:
            data['property_type'] = 'Commercial'
        else:
            data['property_type'] = 'Unknown/Other'
            
        return data if len(data) > 2 else None
        
    except Exception as e:
        print(f"Error scraping {parcel_id}: {e}")
        return None

def main():
    dotenv.load_dotenv(Path(__file__).parent.parent / '.env')
    
    os.makedirs('DeKalb_Analysis_Results', exist_ok=True)
    pdf_path = '.tmp/dekalb_pdfs/dekalb_tax_list.pdf'
    
    # 1. Parse PDF
    raw_parcels = extract_parcels_from_pdf(pdf_path, pages_to_scan=50)
    
    # 2. Enrich and Filter for 25 complete properties
    complete_properties = []
    print("\nEnriching properties from qPublic (target: 25 complete valid properties)...")
    
    for item in raw_parcels:
        if len(complete_properties) >= 25:
            break
            
        pid = item['tax_id']
        print(f"Checking {pid} ...", end=' ')
        
        qdata = scrape_qpublic_dekalb(pid)
        time.sleep(1) # Be nice
        
        if not qdata:
            print("Failed scrape.")
            continue
            
        # Merge data
        prop = {**item, **qdata}
        
        # Validation checks
        if prop.get('property_type') not in ['Residential', 'Commercial']:
            print(f"Skipping (Type: {prop.get('property_class')})")
            continue
        if not prop.get('full_address'):
            print("Skipping (No address)")
            continue
        if not prop.get('market_value'):
            print("Skipping (No market value)")
            continue
            
        print("✓ VALID COMPLETE PROPERTY")
        complete_properties.append(prop)
        
    print(f"\nFinalized {len(complete_properties)} complete properties.")
    
    # 3. Apify Comps
    apify_key = os.getenv('APIFY_API_KEY')
    comps_list = []
    if apify_key:
        print("\nFetching Comps from Apify...")
        apify = ApifyZillowComps()
        
        # Need to create a dataframe for fetch_comps_for_properties
        # but the function signature in apify_comps.py takes dataframe with 'full_address'
        try:
            from execution.create_dekalb_sample import fetch_comps_for_properties
            temp_df = pd.DataFrame(complete_properties)
            # Add 'source' and 'county' which might be expected
            temp_df['source'] = 'dekalb_qpublic'
            temp_df['county'] = 'DeKalb'
            comps_list = fetch_comps_for_properties(temp_df, apify)
            print(f"Found {len(comps_list)} comps.")
        except Exception as e:
            print(f"Error fetching comps: {e}")
            
    # 4. Analyze with Gemini
    gemini_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
    # Analysis now deterministic, key not strictly required for this part anymore but kept for backward compatibility if apify needs it
    print("\nAnalyzing properties deterministically...")
    analyzer = DeterministicAnalyzer()
    
    for idx, prop in enumerate(complete_properties):
            print(f"[{idx+1}/25] Analyzing {prop['tax_id']}...")
            try:
                analysis = analyzer.analyze_property({
                    'county': 'DeKalb',
                    'tax_id': prop['tax_id'],
                    'tax_due': prop['tax_due'],
                    'street_name': prop['full_address'],
                    'property_type': prop['property_type']
                })
                # Merge analysis
                prop.update(analysis.model_dump())
            except Exception as e:
                print(f"Analysis error for {prop['tax_id']}: {e}")
                prop['analysis_notes'] = f"Error: {e}"
                
    # 5. Format to Faribault output
    print("\nFormatting to final output schema...")
    output_rows = []
    for prop in complete_properties:
        row = {
            'Parcel ID': prop.get('tax_id', ''),
            'Address': prop.get('full_address', ''),
            'City': 'Dekalb County', # Approximation, qPublic doesn't reliably split city
            'State': 'GA',
            'Property Type': prop.get('property_type', ''),
            'Beds': prop.get('beds'),
            'Baths': prop.get('baths'),
            'SqFt': prop.get('sqft'),
            'Year Built': prop.get('year_built'),
            'Tax Due': prop.get('tax_due', 0),
            'Min Bid': prop.get('tax_due', 0),
            'Max Bid': prop.get('recommended_max_bid'),
            'Market Value': prop.get('market_value'),
            'ARV': prop.get('arv'),
            'Repair Cost': prop.get('repair_cost'),
            'Risk Score': 'High' if prop.get('risk_flags') else 'Low',
            'Risk Flags': str(prop.get('risk_flags', [])),
            'Strategy Notes': prop.get('strategy_notes', ''),
            'Analysis Notes': prop.get('analysis_notes', '')
        }
        output_rows.append(row)
        
    df_final = pd.DataFrame(output_rows)
    df_comps = pd.DataFrame(comps_list)
    
    out_file = 'DeKalb_Analysis_Results/DeKalb_25_COMPLETE_Properties.xlsx'
    
    with pd.ExcelWriter(out_file) as writer:
        df_final.to_excel(writer, sheet_name='Properties', index=False)
        if not df_comps.empty:
            df_comps.to_excel(writer, sheet_name='Comparable Sales', index=False)
            
    print(f"\nSaved complete pipeline results to {out_file}")

if __name__ == '__main__':
    main()
