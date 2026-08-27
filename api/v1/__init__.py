from flask import Blueprint

v1_blueprint = Blueprint('v1', __name__)

from api.v1 import properties  # noqa: F401, E402
