"""ASGI entry point: `uvicorn openvoice_api.asgi:app`.

Kept separate from main.py so importing the factory never requires a
configured environment (tests and schema export construct Settings
explicitly).
"""

from .main import create_app

app = create_app()
