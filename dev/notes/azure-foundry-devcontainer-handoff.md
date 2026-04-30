# Azure Foundry + Devcontainer Handoff

Objective: develop support for Azure Foundry in Metabase, using Azure Foundry as a backend for Metabase AI features.

## Branch

- Working branch: `feat/azure-foundry-devcontainer`

## What Was Implemented

### Devcontainer

The devcontainer was expanded so Metabase development can happen inside the container instead of depending on the host machine for the language toolchain.

Updated files:

- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`

Changes made:

- Added Node 22.
- Added Bun.
- Added Clojure CLI.
- Added Babashka.
- Added Python 3.
- Added `uv`.
- Added common CLI utilities used during development: `jq`, `ripgrep`, `fd`, `fzf`, `zip`, `unzip`, `rlwrap`, `fontconfig`.
- Added Docker access from inside the devcontainer using the `docker-outside-of-docker` devcontainer feature.
- Added useful VS Code extensions for Clojure, Docker, and EditorConfig.
- Added `postCreateCommand: bun install`.
- Forwarded ports `3000` and `8080`.
- Removed the old explicit `--network=metabase-dev` dependency so the container does not require a pre-created Docker network just to start.

Validation done:

- `docker build -f .devcontainer/Dockerfile -t metabase-devcontainer-test .devcontainer` succeeded.

### Azure Foundry Provider Work

Backend and frontend implementation has been started.

Updated backend files:

- `src/metabase/llm/settings.clj`
- `src/metabase/metabot/api.clj`
- `src/metabase/metabot/self.clj`
- `src/metabase/metabot/self/azure.clj`
- `src/metabase/metabot/settings.clj`
- `test/metabase/metabot/self_test.clj`
- `test/metabase/metabot/settings_test.clj`

Updated frontend files:

- `frontend/src/metabase-types/api/metabot.ts`
- `frontend/src/metabase-types/api/settings.ts`
- `frontend/src/metabase/metabot/components/MetabotAdmin/utils.ts`
- `frontend/src/metabase/metabot/components/MetabotAdmin/MetabotSetup.tsx`
- `frontend/src/metabase/metabot/components/MetabotAdmin/MetabotSetup.unit.spec.tsx`

Implemented so far:

- Added Azure-specific admin settings for API key, base URL, and API version.
- Added `azure` as a supported Metabot provider in backend and frontend types.
- Added a new backend adapter file for Azure Foundry chat completions.
- Wired provider dispatch in Metabot to route `azure/...` requests to the new adapter.
- Added frontend provider option and manual Azure configuration fields.
- Added frontend tests for Azure provider selection and manual setup flow.
- Added backend tests for provider parsing and configuration checks.

## Current Status

### Devcontainer Status

The devcontainer is ready for the main Metabase development workflow.

What should work inside the devcontainer:

- Clojure development
- TypeScript/frontend development
- `bun install`
- `bun run dev`
- Docker commands from inside the container, assuming Docker Desktop on the host is running
- Building container images from inside the container

Important nuance:

- This is sufficient for the core Metabase dev/build/run workflow.
- It is not exact 1:1 parity with every optional tool in `mise.toml`.
- Notably, ancillary tools like `gh`, `awscli`, and `op` were not added because they are not required to continue the current Azure Foundry implementation.

### VS Code Setup Status

Added in the devcontainer configuration:

- Calva for Clojure
- Docker extension
- EditorConfig extension

Ports forwarded:

- `3000`
- `8080`

Expected workflow:

1. Reopen the repository in the devcontainer.
2. Let `postCreateCommand` finish running `bun install`.
3. Use the integrated terminal inside the container for all further work.

### Network Status

- The devcontainer no longer depends on a pre-created `metabase-dev` Docker network.
- Host Docker still needs to be installed and running.
- The devcontainer uses Docker-through-host access via the devcontainer feature rather than running a separate Docker daemon in the container.

## Validation Status

Completed:

- Devcontainer JSON and Dockerfile are syntactically valid.
- Devcontainer image build succeeded.
- Editor diagnostics reported no immediate syntax/type errors in the touched TypeScript files after the Azure frontend changes.
- Editor diagnostics reported no immediate syntax errors in the touched Clojure files after the backend adapter fix.

Not fully completed yet:

- Frontend unit tests were not executed successfully on the host because `bun` was not installed locally before the devcontainer work.
- Backend Metabot tests were invoked through `./bin/test-agent`, but the terminal in this session did not return usable test output to rely on as final proof.
- No full app run has been completed yet inside the devcontainer.

## Recommended Next Steps Inside The Devcontainer

1. Reopen the repo in the devcontainer.
2. Confirm tool availability:
   - `bun --version`
   - `clojure -Sdescribe`
   - `bb --version`
   - `python3 --version`
   - `uv --version`
   - `docker --version`
3. Run the focused frontend test:
   - `bun x jest frontend/src/metabase/metabot/components/MetabotAdmin/MetabotSetup.unit.spec.tsx --runInBand`
4. Run the focused backend tests:
   - `./bin/test-agent :only '[metabase.metabot.self-test metabase.metabot.settings-test]'`
5. Run the development app:
   - `bun run dev`
6. Manually validate the Azure admin flow in the UI.

## Likely Remaining Work On Azure Foundry

The implementation is not finished end-to-end yet. The next work items are:

1. Validate the backend adapter against real Azure request semantics from inside the devcontainer.
2. Confirm the current `metabot.settings` changes behave correctly under real tests.
3. Run and fix the new frontend tests if any behavior mismatches show up.
4. Manually verify admin configuration and one real Metabot-backed request.
5. Optionally tighten the devcontainer further if additional repo tooling is needed.

## Continuation Notes

- The current user-visible continuation file is this one.
- The current session also has memory notes describing the plan and earlier discovery.
- If reopening in the devcontainer changes the active branch unexpectedly, switch back to `feat/azure-foundry-devcontainer` before continuing.