"""Configuration management utility."""
import os
import yaml
from pathlib import Path
from typing import Any, Dict
from dotenv import load_dotenv

# Load environment variables
try:
    load_dotenv()
except Exception:
    pass  # Ignore environment errors (e.g. variable too long on Windows)


class Config:
    """Configuration manager that loads and merges YAML configs."""
    
    def __init__(self, config_dir: str = None):
        if config_dir is None:
            # Default to config/ directory relative to project root
            self.config_dir = Path(__file__).parent.parent.parent / "config"
        else:
            self.config_dir = Path(config_dir)
        
        self._config = self._load_config()
    
    def _load_config(self) -> Dict[str, Any]:
        """Load default config and merge with market configs if needed."""
        # Load default config
        default_path = self.config_dir / "default.yaml"
        with open(default_path, 'r') as f:
            config = yaml.safe_load(f)
        
        # Helper to get env var with fallback for Windows issues
        def get_env_safe(key, default_val=None):
            # Try standard os.getenv first
            val = os.getenv(key)
            if val is not None:
                return val
            
            # Fallback: manual .env parse
            try:
                env_path = self.config_dir.parent / '.env'
                if env_path.exists():
                    with open(env_path, 'r') as f:
                        for line in f:
                            clean_line = line.strip()
                            if clean_line.startswith(f"{key}="):
                                return clean_line.split('=', 1)[1]
            except Exception:
                pass
            return default_val

        # Add environment-based overrides
        config['database']['url'] = get_env_safe('DATABASE_URL')
        config['logging']['level'] = get_env_safe('LOG_LEVEL', config['logging']['level'])
        
        return config
    
    def load_market_config(self, state: str) -> Dict[str, Any]:
        """Load market-specific configuration for a state."""
        market_path = self.config_dir / "markets" / f"{state.lower()}.yaml"
        
        if not market_path.exists():
            raise FileNotFoundError(f"Market config not found for state: {state}")
        
        with open(market_path, 'r') as f:
            return yaml.safe_load(f)
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        Get configuration value using dot notation.
        
        Example:
            config.get('costs.rehab_per_sqft.light')
        """
        keys = key.split('.')
        value = self._config
        
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        
        return value
    
    def get_cost_config(self, state: str = None, county: str = None) -> Dict[str, Any]:
        """
        Get merged cost configuration.

        Merges in this order:
        1. Default costs
        2. State-level cost overrides
        3. County-level cost multipliers
        """
        import copy

        # Start with default costs (deep copy to avoid mutating original)
        costs = copy.deepcopy(self.get('costs', {}))

        if state:
            # Merge state-level overrides
            market_config = self.load_market_config(state)
            if 'costs' in market_config:
                # Deep merge nested dicts like rehab_per_sqft
                for key, value in market_config['costs'].items():
                    if isinstance(value, dict) and key in costs and isinstance(costs[key], dict):
                        # Merge nested dict
                        costs[key].update(value)
                    else:
                        # Replace top-level value
                        costs[key] = value

            if county:
                # Apply county-level multipliers
                county_config = market_config.get('counties', {}).get(county.lower(), {})
                if 'rehab_cost_multiplier' in county_config:
                    multiplier = county_config['rehab_cost_multiplier']
                    for band in ['light', 'medium', 'heavy']:
                        if band in costs.get('rehab_per_sqft', {}):
                            costs['rehab_per_sqft'][band] *= multiplier

        return costs
    
    def __getitem__(self, key: str) -> Any:
        """Allow dict-style access."""
        return self.get(key)
    
    @property
    def all(self) -> Dict[str, Any]:
        """Return entire configuration dict."""
        return self._config


# Global config instance
config = Config()
