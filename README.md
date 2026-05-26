# stable-diffusion-local

Local image generation kit backed by `stable-diffusion.cpp`.

The workload exposes an OpenAI-compatible OAIC surface at `/oaic`, with `/v1`
also exposed as a convenience public alias. Requests are proxied to an on-demand
`sd-server` process. The server binary and model files are cached in the `models`
host mount.

## Run

```sh
env -u LOG_FORMAT capakit up . --mount models=/path/to/model-cache
```

Then call:

```sh
curl "$CAPAKIT_URL/oaic/v1/images/generations" \
  -H 'content-type: application/json' \
  -d '{"prompt":"soft watercolor picture book cottage","size":"512x512"}'
```

The `model` request field may be either a local model path or a Hugging Face
repo/file selector, for example:

```json
{"model": "turingevo/tiny-sd-gguf", "prompt": "a tiny red boat on a pond"}
```

## Options

- `default_model`: local path or Hugging Face repo/file spec.
- `release_tag`: `stable-diffusion.cpp` release tag to download.
- `backend`: `auto`, `cpu`, or `metal`.
- `params_backend`: `auto`, `cpu`, or `metal`.
- `threads`: CPU threads.
- `default_steps`: default sampling steps.
- `cfg_scale`: default guidance scale.
