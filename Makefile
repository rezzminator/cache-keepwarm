# Every check release.yml runs on a pull request to main; `make release-check` runs them all locally first.
RUN := $(if $(CI),,mise exec node@24 --)

.PHONY: release-check gate release

release-check: gate release

gate: export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS := 1
gate:
	$(RUN) npm ci
	$(RUN) npm test
	$(RUN) npm run typecheck
	$(RUN) npm run validate:plugin
	$(RUN) npm run check:structure
	$(RUN) npm run release:check

# origin/main is read as last fetched: `git fetch origin main` first.
release:
	base="$$(git show origin/main:package.json | $(RUN) node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')" && \
	RELEASE_BASE_VERSION="$$base" $(RUN) npm run release:check
	v="$$($(RUN) node -p 'require("./package.json").version')" || exit 1; \
	awk -v heading="## [$$v]" 'index($$0,heading)==1 {p=1;next} p && /^## / {exit} p {print}' CHANGELOG.md | grep -q '' || { echo "FAIL CHANGELOG.md section for $$v yields no release notes"; exit 1; }
