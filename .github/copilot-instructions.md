# Project Coding & Architecture Standards

## 1. Cross-Platform Mandate (Windows & Linux)
- Always use Node's `path.join()` and `path.resolve()` instead of hardcoded `/` or `\` separators.
- When interacting with the Docker socket via `dockerode`, always detect `process.platform`:
  - `win32`: `//./pipe/docker_engine`
  - `linux`: `/var/run/docker.sock`
- When spawning SecGen or Vagrant CLI commands, handle shell differences between Windows PowerShell/CMD and Linux Bash.

## 2. Security & Containment Rules
- Every container or VM spun up by SecGen or Docker MUST bind ports exclusively to `127.0.0.1` (never `0.0.0.0`).
- The AI Assistant system prompt must never reveal the raw flag value from SecGen's `flag_hints.xml`.

## 3. Definition of Done: Tests Required
- **No Untested Code:** Every new service method, IPC handler, or UI component MUST be accompanied by a Vitest unit test in `tests/unit/`.
- **Mock Heavy External Dependencies:** Always provide mocks for `dockerode`, `child_process` (SecGen/Vagrant), and LLM HTTP responses in unit tests so the test suite executes in under 10 seconds offline.