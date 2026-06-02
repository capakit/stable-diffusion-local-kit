<!--
Generated from kit-meta.json by scripts/demo-kit-standard.mjs.
Update kit-meta.json or capability.yml, then rerun the generator instead of hand-editing generated README sections.
-->

# Stable Diffusion Local

Local AI app Kit that serves stable-diffusion.cpp through an OpenAI-compatible image endpoint.

## What It Does

- Downloads and runs stable-diffusion.cpp on demand.
- Loads a local path or Hugging Face diffusion model spec.
- Exposes an OpenAI-compatible image-generation API for other Kits.

## Technologies

- stable-diffusion.cpp
- GGUF diffusion models
- CapaKit OAIC endpoint
- TypeScript
- Bun

## App Kit Info

```text
AI app Kit: stable-diffusion-local

Exposes
- Public path: /oaic
  Protocols:
    - Protocol: oaic
      Path: /oaic
- Public path: /v1
  Protocols:
    - Protocol: oaic
      Path: /oaic

Requires
Secrets:
No secrets declared.

Host mounts:
- models [read_write]
  Usage: Local stable-diffusion.cpp binary and model cache

Options:
- backend [enum, default=auto, values=auto|cpu|metal]: Runtime backend passed to sd-server.
- cfg_scale [number, default=1]: Default classifier-free guidance scale used by sd-server.
- default_model [string, default=turingevo/tiny-sd-gguf]: Local path or Hugging Face repo/file spec for the default diffusion model.
- default_steps [number, default=8]: Default sampling steps used by sd-server.
- params_backend [enum, default=cpu, values=auto|cpu|metal]: Parameter placement backend passed to sd-server.
- release_tag [string, default=master-650-1ceb5bd]: stable-diffusion.cpp release tag to download on demand.
- threads [number, default=4]: Number of CPU threads passed to sd-server.

External services
No external services declared.

AI app Kit dependencies
No AI app Kit dependencies declared.
Exports provided to dependents:
- oaic -> /oaic

Commands
- Run:
  capakit run https://github.com/capakit/stable-diffusion-local-kit \
    --mount models=~/.capakit/models
- Test:
  capakit test /Users/roman/Code/capakit/demo_kits/stable-diffusion-local-kit
```

## Run

```sh
capakit run https://github.com/capakit/stable-diffusion-local-kit \
--mount models=~/.capakit/models
```

## Test

```sh
capakit test .
```

## Security

Vault secrets are user-provided secrets available only to trusted integrations such as secure exit nodes. Kit secrets are Kit-local secrets that can be exposed to code workloads.

## About CapaKit

CapaKit runs AI app Kits locally with isolated workloads, explicit mounts, and agent-friendly commands. Learn more at https://capakit.com.

More AI app Kits: https://github.com/capakit/apps
