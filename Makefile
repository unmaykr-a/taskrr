# Taskrr developer tasks.
.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: frontend
frontend: ## Install deps and build the frontend into the embed dir
	cd web && npm install && npm run build

.PHONY: backend
backend: ## Build the Go binary (embeds whatever is in internal/web/dist)
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/taskrr ./cmd/taskrr

.PHONY: build
build: frontend backend ## Build frontend + backend into bin/taskrr

.PHONY: run
run: build ## Build everything and run the server (on :8787)
	./bin/taskrr

.PHONY: dev-backend
dev-backend: ## Run the backend with live logs (no frontend build) on :8787
	go run ./cmd/taskrr

.PHONY: dev-frontend
dev-frontend: ## Run the Vite dev server (proxies /api to :8787)
	cd web && npm run dev

.PHONY: test
test: test-go test-web ## Run all tests (Go + frontend)

.PHONY: test-go
test-go: ## Run Go tests
	go test ./...

.PHONY: test-web
test-web: ## Run frontend unit tests
	cd web && npm run test

.PHONY: vet
vet: ## Run go vet + frontend typecheck
	go vet ./...
	cd web && npm run typecheck

.PHONY: install-hooks
install-hooks: ## Enable the git pre-commit hook (blocks commits on failing tests)
	git config core.hooksPath .githooks
	@echo "pre-commit hook enabled (.githooks/pre-commit)"

.PHONY: tidy
tidy: ## Tidy Go modules
	go mod tidy

.PHONY: docker
docker: ## Build the Docker image for the local architecture
	docker build -t taskrr:dev .

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf bin
	rm -rf internal/web/dist/assets internal/web/dist/index.html
