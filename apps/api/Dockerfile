# Development/CI image for the Openvoice API. Python 3.12 is the single
# supported interpreter (ADR-0002). Dev extras are installed because this image
# also runs the test suite; a slimmed production image arrives with Milestone 4.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY . .

# constraints.txt pins exact resolved versions (regenerate with
# `pip freeze` after intentional upgrades).
RUN PIP_CONSTRAINT=constraints.txt pip install -e ".[dev]"

RUN useradd --create-home app
USER app

EXPOSE 8000
CMD ["uvicorn", "openvoice_api.asgi:app", "--host", "0.0.0.0", "--port", "8000"]
