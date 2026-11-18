# PWNShop UI: Features and Limitations

## Implemented features

### Design system
- Tailwind CSS theme with the PWNShop brand colours (`brand-purple`, `brand-lavender`, `surface-*`, `ink-*`), light-mode first.
- Shared styles: uppercase purple eyebrow labels, rounded pill tags, primary and secondary buttons.
- Only the log drawer uses a dark monospace terminal style.

### Secure Electron bridge
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Typed `window.pwnshopApi` (`src/shared/ipcTypes.ts`, `src/preload.ts`) with:
  `getSystemHealth`, `listScenarios`, `launchScenario`, `stopScenario`, `submitFlag`, `askAiHelper`, `saveConfidenceRating`.
- IPC handlers (`src/main/ipcHandlers.ts`) validate their inputs and return `{ ok, error }`, so failures reach the UI as normal errors.
- Labs are reported on `http://127.0.0.1:<port>` only.
- External links from the renderer are limited to `http://127.0.0.1:` URLs.
- The AI helper only receives scenario context from the catalog and never receives flag values.

### Views
- **TopBar:** PWNShop wordmark (returns to the catalog) and live `Docker: Connected/Offline` and `Local AI: Ready/Starting` pills, polled every 5 seconds.
- **LabCatalog:**
  - Hero banner with progress summary and a "Resume Last Lab" button.
  - Topic filter pills (All, SQL injection, IDOR, Cross-site scripting, Broken access control, OS command injection).
  - Responsive scenario cards with difficulty, topic, last confidence score and a "Launch Lab" button.
- **ActiveLabWorkspace:**
  - Target bar with Copy URL, Open in Browser and Stop Lab.
  - Lab briefing card.
  - Flag form with success and error feedback.
  - Collapsible dark log drawer.
  - AI chat with quick-action chips and a free-text input.
- **ConfidenceModal:** opens automatically on a correct flag, with a 1–5 scale and "Save & Continue".

### Backend support added
- `ProgressService`: JSON-backed attempts, completions, confidence ratings and last-lab tracking.
- `DockerLlmService.checkHealth()`.
- `scenarioCatalog.ts` with five starter scenarios.

### Tests (Vitest and React Testing Library)
- IPC handlers, preload bridge, progress service, health check, `App`, `LabCatalog`, `ActiveLabWorkspace` (including `ConfidenceModal`).
- All external dependencies are mocked and the suite runs offline in about 4 seconds.

## Limitations

- **Scenario files are missing.** The five catalog scenarios reference SecGen XML files that are not in the repo. They are expected in `$SECGEN_DIR/scenarios/pwnshop` or `$PWNSHOP_SCENARIOS_DIR`, so launching will fail until they exist.
- **Ports are hard-coded.** Host ports 18081–18085 are set in the catalog and not read from the generated SecGen or Vagrant configuration.
- **The log drawer shows session events only.** It lists lab start and flag attempts, not real container or HTTP logs, because no service exposes them yet.
- **Leaving a lab does not stop it.** Clicking the wordmark mid-lab returns to the catalog and leaves the lab running. Launching another lab stops the previous one.
- **Only one lab can run at a time**, because `SecGenService` tracks a single project.
- **The Local AI pill only reports container state.** The helper ensures the container is running on first use, but there is no model-pull progress and no streaming responses (answers arrive all at once).
- **The AI helper keeps no chat history.** Each question is sent on its own, with only the last 10 log lines as context.
- **Progress is simple.** It uses a JSON file (not SQLite), with no multi-user support and no reset or export. A rating at or below 2 marks a topic as low confidence.
- **The "Resume Last Lab" button relaunches the lab** and does not reattach to a lab that is already running.
- **Accessibility is basic.** There are ARIA roles and labels, but no keyboard focus management in the modal (no focus trap or Escape to close) and no formal audit.
- **No end-to-end coverage.** The Playwright test was only updated, not run, and the UI has not been manually run inside Electron.
- **Dependencies were installed with `--ignore-scripts`**, so native modules such as `better-sqlite3` were not built.
