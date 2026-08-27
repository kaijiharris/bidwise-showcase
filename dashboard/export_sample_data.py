import sqlite3
import json
import os

DB_PATH = "../real_estate.db"
OUTPUT_PATH = "sample_data.json"

def export_data():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Try to find tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    print("Tables found:", [t['name'] for t in tables])

    # Try to get enriched properties
    try:
        query = """
        SELECT * FROM v2_properties 
        WHERE latitude IS NOT NULL 
        LIMIT 50
        """
        cursor.execute(query)
        rows = cursor.fetchall()
        
        data = [dict(row) for row in rows]
        
        if not data:
            print("No enriched data found (lat/lon null). Fetching any data.")
            cursor.execute("SELECT * FROM v2_properties LIMIT 50")
            rows = cursor.fetchall()
            data = [dict(row) for row in rows]

        with open(OUTPUT_PATH, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        
        print(f"Exported {len(data)} rows to {OUTPUT_PATH}")
            
    except Exception as e:
        print(f"Error querying database: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    export_data()
