"""Database models using SQLAlchemy ORM."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Column, Integer, String, Text, DECIMAL, Boolean, TIMESTAMP,
    ForeignKey, Index, JSON
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

Base = declarative_base()


class Property(Base):
    """Canonical property record."""
    __tablename__ = 'v2_properties'
    
    id = Column(Integer, primary_key=True)
    parcel_id = Column(String(100), unique=True, nullable=False, index=True)
    address = Column(Text, nullable=False)
    city = Column(String(100), index=True)
    state = Column(String(2), index=True)
    county = Column(String(100), index=True)
    zip_code = Column(String(10))
    latitude = Column(DECIMAL(10, 8))
    longitude = Column(DECIMAL(11, 8))
    
    # Property attributes
    property_type = Column(String(50))  # SFR, Condo, Multi-family, etc.
    bedrooms = Column(Integer)
    bathrooms = Column(DECIMAL(3, 1))
    sqft = Column(Integer)
    lot_size = Column(Integer)
    year_built = Column(Integer)
    
    # Source tracking
    source = Column(String(50))  # 'auction', 'tax_lien', 'otc'
    source_id = Column(String(200))
    source_url = Column(Text)
    listing_status = Column(String(50), index=True, default='active')
    
    # Timestamps
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    data_freshness = Column(TIMESTAMP)
    
    # Relationships
    auction_details = relationship("AuctionDetail", back_populates="property", uselist=False, cascade="all, delete-orphan")
    tax_lien_details = relationship("TaxLienDetail", back_populates="property", uselist=False, cascade="all, delete-orphan")
    otc_details = relationship("OTCDetail", back_populates="property", uselist=False, cascade="all, delete-orphan")
    enrichment = relationship("EnrichmentData", back_populates="property", uselist=False, cascade="all, delete-orphan")
    valuation = relationship("ValuationMetrics", back_populates="property", uselist=False, cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('idx_location', 'state', 'county', 'city'),
        Index('idx_status', 'listing_status'),
    )


class AuctionDetail(Base):
    """Auction-specific property details."""
    __tablename__ = 'v2_auction_details'
    
    id = Column(Integer, primary_key=True)
    property_id = Column(Integer, ForeignKey('v2_properties.id', ondelete='CASCADE'), unique=True)
    
    auction_platform = Column(String(100))
    auction_date = Column(TIMESTAMP)
    auction_type = Column(String(50))  # 'foreclosure', 'tax_deed', etc.
    minimum_bid = Column(DECIMAL(12, 2))
    current_bid = Column(DECIMAL(12, 2))
    buyers_premium_pct = Column(DECIMAL(5, 2))
    deposit_required = Column(DECIMAL(12, 2))
    redemption_period_days = Column(Integer)
    
    created_at = Column(TIMESTAMP, server_default=func.now())
    
    # Relationship
    property = relationship("Property", back_populates="auction_details")


class TaxLienDetail(Base):
    """Tax lien-specific property details."""
    __tablename__ = 'v2_tax_lien_details'
    
    id = Column(Integer, primary_key=True)
    property_id = Column(Integer, ForeignKey('v2_properties.id', ondelete='CASCADE'), unique=True)
    
    lien_amount = Column(DECIMAL(12, 2))
    interest_rate = Column(DECIMAL(5, 2))
    certificate_number = Column(String(100))
    sale_date = Column(TIMESTAMP)
    redemption_deadline = Column(TIMESTAMP)
    
    created_at = Column(TIMESTAMP, server_default=func.now())
    
    # Relationship
    property = relationship("Property", back_populates="tax_lien_details")


class OTCDetail(Base):
    """Over-the-counter (OTC) property details."""
    __tablename__ = 'v2_otc_details'
    
    id = Column(Integer, primary_key=True)
    property_id = Column(Integer, ForeignKey('v2_properties.id', ondelete='CASCADE'), unique=True)
    
    asking_price = Column(DECIMAL(12, 2))
    listing_date = Column(TIMESTAMP)
    contact_info = Column(Text)
    
    created_at = Column(TIMESTAMP, server_default=func.now())
    
    # Relationship
    property = relationship("Property", back_populates="otc_details")


class EnrichmentData(Base):
    """Property enrichment data (comps, risk, liens, rent estimates)."""
    __tablename__ = 'v2_enrichment_data'
    
    id = Column(Integer, primary_key=True)
    property_id = Column(Integer, ForeignKey('v2_properties.id', ondelete='CASCADE'), unique=True)
    
    # Valuation
    avm_value = Column(DECIMAL(12, 2))
    avm_confidence = Column(String(20))  # 'high', 'medium', 'low'
    arv_estimate = Column(DECIMAL(12, 2))
    
    # Comps
    comp_count = Column(Integer)
    avg_price_per_sqft = Column(DECIMAL(10, 2))
    median_sale_price = Column(DECIMAL(12, 2))
    days_on_market_avg = Column(Integer)
    
    # Risk scores (0-100, higher = more risky)
    crime_score = Column(Integer)
    flood_zone = Column(String(10))  # 'A', 'AE', 'X', etc.
    flood_risk_score = Column(Integer)
    fire_risk_score = Column(Integer)
    composite_risk_score = Column(Integer)
    
    # Liens & title
    known_liens_count = Column(Integer)
    total_lien_amount = Column(DECIMAL(12, 2))
    title_flags = Column(JSON)
    
    # Rent estimates
    estimated_rent_monthly = Column(DECIMAL(10, 2))
    rent_data_source = Column(String(50))
    
    # Metadata
    enrichment_date = Column(TIMESTAMP, server_default=func.now())
    data_quality_score = Column(Integer)  # 0-100
    
    # Relationship
    property = relationship("Property", back_populates="enrichment")


class ValuationMetrics(Base):
    """Valuation and ROI metrics for each property."""
    __tablename__ = 'v2_valuation_metrics'
    
    id = Column(Integer, primary_key=True)
    property_id = Column(Integer, ForeignKey('v2_properties.id', ondelete='CASCADE'), unique=True)
    
    # Purchase costs
    purchase_price = Column(DECIMAL(12, 2))
    buyers_premium = Column(DECIMAL(12, 2))
    
    # Rehab costs
    rehab_category = Column(String(20))  # 'light', 'medium', 'heavy'
    rehab_cost = Column(DECIMAL(12, 2))
    
    # Transaction costs
    closing_costs = Column(DECIMAL(12, 2))
    transfer_tax = Column(DECIMAL(12, 2))
    recording_fees = Column(DECIMAL(10, 2))
    
    # Carrying costs (annualized)
    property_tax_annual = Column(DECIMAL(10, 2))
    insurance_annual = Column(DECIMAL(10, 2))
    utilities_monthly = Column(DECIMAL(10, 2))
    
    # Financing (if applicable)
    financing_cost = Column(DECIMAL(12, 2))
    
    # Total
    all_in_cost = Column(DECIMAL(12, 2))
    
    # Flip metrics
    projected_sale_price = Column(DECIMAL(12, 2))  # ARV
    gross_profit = Column(DECIMAL(12, 2))
    net_profit = Column(DECIMAL(12, 2))
    roi_pct = Column(DECIMAL(10, 2))
    estimated_irr_pct = Column(DECIMAL(10, 2))
    
    # Rental metrics
    monthly_rent_estimate = Column(DECIMAL(10, 2))
    cash_on_cash_return_pct = Column(DECIMAL(10, 2))
    dscr = Column(DECIMAL(5, 2))  # Debt Service Coverage Ratio
    five_year_irr_pct = Column(DECIMAL(10, 2))
    
    # Scoring
    deal_score = Column(Integer)  # 0-100
    
    # Config snapshot (for reproducibility)
    config_version = Column(String(50))
    market_config = Column(Text)
    
    calculated_at = Column(TIMESTAMP, server_default=func.now())
    
    # Relationship
    property = relationship("Property", back_populates="valuation")


class IngestionLog(Base):
    """Log of data ingestion runs."""
    __tablename__ = 'v2_ingestion_logs'
    
    id = Column(Integer, primary_key=True)
    source = Column(String(100), nullable=False)
    status = Column(String(20))  # 'success', 'partial', 'failed'
    records_attempted = Column(Integer)
    records_succeeded = Column(Integer)
    records_failed = Column(Integer)
    error_message = Column(Text)
    started_at = Column(TIMESTAMP)
    completed_at = Column(TIMESTAMP)
