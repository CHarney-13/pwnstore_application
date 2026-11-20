# pwnstore_application
This is groundwork for what will become an interactive teaching machine! With integrated AI grading, this teaching application aims to serve as a proof of concept for the use of a locally hosted AI. The AI is installed on the user's PC and, without the need for API keys or an LLM, can help the user answer questions, acting as a 24/7 tutor. 
* The legal and ethical use disclaimer is at the bottom of this README.md file; before downloading this application, ensure you familiarise yourself with the legal and ethical use disclaimer.

## Local AI and lab cleanup

Enable Docker Model Runner and host-side TCP access on port 12434 in Docker Desktop, or install Docker Model Runner for Docker Engine. Pull the required model with:

```sh
docker model pull hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF
```

The helper uses the loopback OpenAI-compatible endpoint and stays disabled until the runner and model are available. Use **Check AI** to retry. Health checks reconnect up to three times; failures are recorded in `debug/model-runner.log` under the application working directory. Do not expose the unauthenticated Model Runner endpoint to untrusted networks.

Only one lab can run at a time. Stop it before launching another. If provisioning fails and automatic VM cleanup also fails, use **Retry lab cleanup** in the catalog before launching another lab. The project reference is retained across application restarts so cleanup can be retried. Stopping a lab destroys its VM and removes its generated project.

## Legal & Ethical Use Disclaimer
This software—including its web components, desktop sandbox, automated vulnerability generators (SecGen), and local AI diagnostic assistants—is designed strictly for **educational and ethical cybersecurity training purposes**. 

* Authorised Targets Only: **Users are strictly prohibited** from using the techniques, tools, or local sandbox mechanisms learned or provided through this platform against production systems, external websites, or any networks they do not own or possess explicit, written legal authorisation to test.
* No Liability: The creators, contributors, and maintainers of this project assume **no liability** for any misuse, damage, or legal consequences resulting from the deployment or improper use of this software. 

By downloading, installing, or using this platform, you acknowledge that you understand these terms and agree to use the software responsibly and ethically.
