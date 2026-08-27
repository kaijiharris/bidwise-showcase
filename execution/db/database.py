"""Database connection and session management."""
from contextlib import contextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from loguru import logger

from .models import Base
from ..utils.config import config


class Database:
    """Database manager for connection pooling and session management."""
    
    def __init__(self):
        self.engine = None
        self.SessionLocal = None
        self._initialize()
    
    def _initialize(self):
        """Initialize database engine and session maker."""
        # Force SQLite to bypass permission issues
        db_url = "sqlite:///real_estate.db"
        
        pool_size = config.get('database.pool_size', 10)
        pool_recycle = config.get('database.pool_recycle', 3600)
        echo = config.get('database.echo', False)
        
        self.engine = create_engine(
            db_url,
            pool_size=pool_size,
            pool_recycle=pool_recycle,
            echo=echo
        )
        
        self.SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=self.engine
        )
        
        logger.info("Database engine initialized")
    
    def create_all_tables(self):
        """Create all tables defined in models."""
        Base.metadata.create_all(bind=self.engine)
        logger.info("All database tables created")
    
    def drop_all_tables(self):
        """Drop all tables (use with caution!)."""
        Base.metadata.drop_all(bind=self.engine)
        logger.warning("All database tables dropped")
    
    @contextmanager
    def get_session(self) -> Session:
        """
        Context manager for database sessions.
        
        Usage:
            with db.get_session() as session:
                session.query(Property).all()
        """
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Database session error: {e}")
            raise
        finally:
            session.close()
    
    def get_raw_session(self) -> Session:
        """
        Get a raw session (caller responsible for closing).
        
        Usage:
            session = db.get_raw_session()
            try:
                # do work
                session.commit()
            finally:
                session.close()
        """
        return self.SessionLocal()


# Global database instance
db = Database()
