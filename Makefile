.PHONY: help setup api web dev seed ingest links embed expire sources build check

PY := .venv/bin/python
PIP := .venv/bin/pip

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## Create the virtualenv, install Python + web dependencies
	python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements-scrapers.txt
	$(PY) -m playwright install chromium
	cd web && npm install
	@test -f .env || cp .env.example .env
	@test -f web/.env.local || cp web/.env.local.example web/.env.local
	@echo "\nNow add SUPABASE_SERVICE_ROLE_KEY to .env, then run: make seed"

api: ## Run the FastAPI backend on :8000
	$(PY) -m uvicorn api.main:app --reload --port 8000

web: ## Run the Next.js frontend on :3000
	cd web && npm run dev

dev: ## Run API and web together
	@$(MAKE) -j2 api web

seed: ## Load the demo catalogue
	$(PY) -m workers.run seed

ingest: ## Scrape every configured source
	$(PY) -m workers.run ingest

links: ## Audit that every stored ticket link is a live, direct event page
	$(PY) -m workers.run links -n 40

embed: ## Backfill missing embeddings
	$(PY) -m workers.run embed

expire: ## Retire events that already happened
	$(PY) -m workers.run expire

sources: ## Show which sources are configured
	$(PY) -m workers.run sources

build: ## Production build of the frontend
	cd web && npm run build

check: ## Type-check the frontend and import-check the API
	cd web && npm run typecheck
	$(PY) -c "import api.main, workers.pipeline; print('python ok')"
