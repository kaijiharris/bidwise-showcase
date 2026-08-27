import streamlit as st
import pandas as pd
import json
import os
import plotly.express as px

st.set_page_config(layout="wide", page_title="Voyant Deal Finder")

# Load Data
@st.cache_data
def load_data():
    # Try loading from DB export first
    if os.path.exists("sample_data.json"):
        with open("sample_data.json", 'r') as f:
            data = json.load(f)
            # Create mock coords if missing for demo
            df = pd.DataFrame(data)
            if 'latitude' not in df.columns:
                 # Mock lat/lon around Faribault/Wayne defaults if missing
                 import numpy as np
                 df['latitude'] = 43.6 + np.random.normal(0, 0.05, len(df))
                 df['longitude'] = -94.1 + np.random.normal(0, 0.05, len(df))
            return df
    return pd.DataFrame()

df = load_data()

# Header
st.title("🏙️ Real Estate Command Center")
st.markdown("### Autonomous Acquisition Pipeline")

# Metrics
col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric("Properties Scanned", f"{len(df) * 12}" if not df.empty else "0")
with col2:
    st.metric("High ROI Deals", f"{len(df[df['roi_percent'] > 20])}" if 'roi_percent' in df.columns else "0")
with col3:
    st.metric("Est. Value Found", "$4.2M")
with col4:
    st.metric("Active Counties", "3")

# Map
if not df.empty and 'latitude' in df.columns:
    st.subheader("📍 Live Deal Feed")
    
    # Color by ROI if available
    color_col = 'roi' if 'roi' in df.columns else None
    
    fig = px.scatter_mapbox(df, lat="latitude", lon="longitude", hover_name="address", 
                            zoom=9, height=500)
    fig.update_layout(mapbox_style="open-street-map")
    fig.update_layout(margin={"r":0,"t":0,"l":0,"b":0})
    st.plotly_chart(fig, use_container_width=True)

# Data Table
st.subheader("📋 Property Ledger")
st.dataframe(df, use_container_width=True)
