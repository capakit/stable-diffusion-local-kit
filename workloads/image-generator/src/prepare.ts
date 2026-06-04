import { hydrateStableDiffusionRuntime } from "./stable_diffusion_server.ts";

const modelsDir = process.env.CAPAKIT_MOUNT_MODELS;
if (!modelsDir) {
    throw new Error("missing required host mount env `CAPAKIT_MOUNT_MODELS`");
}

await hydrateStableDiffusionRuntime({
    modelsDir,
    defaultModel: process.env.SD_CPP_DEFAULT_MODEL ?? "turingevo/tiny-sd-gguf",
    releaseTag: process.env.SD_CPP_RELEASE_TAG ?? "master-650-1ceb5bd",
    backend: process.env.SD_CPP_BACKEND ?? "auto",
    paramsBackend: process.env.SD_CPP_PARAMS_BACKEND ?? "cpu",
    threads: Number(process.env.SD_CPP_THREADS ?? "4"),
    defaultSteps: Number(process.env.SD_CPP_DEFAULT_STEPS ?? "8"),
    cfgScale: Number(process.env.SD_CPP_CFG_SCALE ?? "1"),
}, hydrateModels(process.env.SD_CPP_HYDRATE_MODELS));

function hydrateModels(value: string | undefined): string[] {
    return value
        ?.split(/[,\n]/)
        .map((model) => model.trim())
        .filter(Boolean)
        ?? [];
}
