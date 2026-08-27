"""Logging configuration utility."""
import sys
from pathlib import Path
from loguru import logger

from .config import config


def setup_logging():
    """Configure loguru logger based on config settings."""
    
    # Remove default handler
    logger.remove()
    
    # Get logging config
    log_config = config.get('logging', {})
    level = log_config.get('level', 'INFO')
    log_format = log_config.get('format')
    log_file = log_config.get('file', 'logs/rei_system.log')
    rotation = log_config.get('rotation', '10 MB')
    retention = log_config.get('retention', '30 days')
    
    # Add console handler
    logger.add(
        sys.stderr,
        format=log_format,
        level=level,
        colorize=True
    )
    
    # Add file handler
    log_path = Path(__file__).parent.parent.parent / log_file
    log_path.parent.mkdir(parents=True, exist_ok=True)
    
    logger.add(
        str(log_path),
        format=log_format,
        level=level,
        rotation=rotation,
        retention=retention,
        compression="zip"
    )
    
    logger.info(f"Logging initialized at {level} level")
    return logger


# Initialize logging when module is imported
setup_logging()
