# pwnstore_application
This is groundwork for what will become an interactive teaching machine! With integrated AI grading, this teaching application aims to serve as a proof of concept for the use of a locally hosted AI. The AI is installed on the user's PC and, without the need for API keys or an LLM, can help the user answer questions, acting as a 24/7 tutor. 
* The legal and ethical use disclaimer is at the bottom of this README.md file; before downloading this application, ensure you familiarise yourself with the legal and ethical use disclaimer.

## Running and testing the UI

Run `npm ci`, then `npm run build` and `npm start` to open the desktop app. The UI requires Electron's preload API, so the Vite browser preview alone cannot exercise the app.

Run `npm run test:unit` for component tests and `npm run test:e2e` for the Electron smoke test. The smoke test builds the app and does not start a lab.

## Local AI and lab cleanup

Enable Docker Model Runner and host-side TCP access on port 12434 in Docker Desktop, or install Docker Model Runner for Docker Engine. On each machine, run:

```sh
npm run setup:model
```

This downloads the Q4_K_M Qwen model (about 1.04 GiB) into the project's `models` directory, verifies its SHA-256, and imports it into Docker Model Runner if it is not already installed. The model is not tracked by Git or included in the application installer. Docker maintains its own model cache, so allow space for both copies. Internet access is required for the initial download.

If Docker reports an import succeeded but setup cannot find the model, check `docker model logs`. As an alternative, run `docker model pull hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF` and then rerun `npm run setup:model`; Docker will download its own copy.

The helper uses the loopback OpenAI-compatible endpoint and stays disabled until the runner and model are available. Use **Check AI** to retry. Health checks reconnect up to three times; failures are recorded in `debug/model-runner.log` under the application working directory. Do not expose the unauthenticated Model Runner endpoint to untrusted networks.

Only one lab can run at a time. Stop it before launching another. If provisioning fails and automatic VM cleanup also fails, use **Retry lab cleanup** in the catalog before launching another lab. The project reference is retained across application restarts so cleanup can be retried. Stopping a lab destroys its VM and removes its generated project.

## Docker demo lab

With Docker running, build the local demo image once using `npm run build:demo-lab`. Select **Demo: SQL Injection** at the top of the catalog to launch it without SecGen or Vagrant. Docker assigns a host port bound only to `127.0.0.1`; open the provided URL in a browser. The log drawer shows recent container requests and SQL errors, and the local AI helper receives recent logs and conceptual hints with the demo flag redacted. Stop the lab when finished. If the desktop app is restarted with the container present, use **Retry lab cleanup** before launching another lab. When a demo is awaiting recovery, Docker must be reachable to verify its state.

## SecGen setup and inisalisation

run: `$env:SECGEN_DIR = (Resolve-Path .\SecGen\SecGen-master).Path` then `npm start`
this will point to application in the direction of the SecGen files. 

## Legal & Ethical Use Disclaimer
This software—including its web components, desktop sandbox, automated vulnerability generators (SecGen), and local AI diagnostic assistants—is designed strictly for **educational and ethical cybersecurity training purposes**. 

* Authorised Targets Only: **Users are strictly prohibited** from using the techniques, tools, or local sandbox mechanisms learned or provided through this platform against production systems, external websites, or any networks they do not own or possess explicit, written legal authorisation to test.
* No Liability: The creators, contributors, and maintainers of this project assume **no liability** for any misuse, damage, or legal consequences resulting from the deployment or improper use of this software. 

By downloading, installing, or using this platform, you acknowledge that you understand these terms and agree to use the software responsibly and ethically.
