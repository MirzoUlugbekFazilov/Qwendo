.PHONY: help setup api web dev ingest radar build check

PY := .venv/bin/python
PIP := .venv/bin/pip

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## Create the virtualenv, install Python + web dependencies
	python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	cd web && npm ci
	@test -f .env || cp .env.example .env
	@test -f web/.env.local || cp web/.env.local.example web/.env.local
	@echo "Set the development Supabase URL and keys in both environment files, then run make dev."

api: ## Run the FastAPI backend on :8000
	$(PY) -m uvicorn api.main:app --reload --port 8000

web: ## Run the Next.js frontend on :3000
	cd web && npm run dev

dev: ## Run API and web together
	@$(MAKE) -j2 api web

ingest: ## Run the scheduled discovery worker against the configured database
	$(PY) -m workers.discovery_jobs

radar: ## Refresh in-app alerts for subscribed users
	$(PY) -m workers.radar

build: ## Production build of the frontend
	cd web && npm run build

check: ## Run local Python tests, frontend type checking and picks tests
	$(PY) -m unittest discover -s tests -v
	cd web && npm run typecheck
	cd web && node --test src/components/picks-model.test.mjs
