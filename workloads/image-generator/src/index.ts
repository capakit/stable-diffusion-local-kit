import { createWorkloadSdk, endpointPath, hostMountMid } from "@capakit/sdk";

import { registerOaic } from "./capakit_oaic.ts";
import { registerTestHttp } from "./capakit_test.ts";
import { StableDiffusionServerManager } from "./stable_diffusion_server.ts";

const sdk = createWorkloadSdk({
    onShutdown: async () => {
        await stableDiffusion.stop();
    },
});

sdk.hijackConsoleLogging();

const modelsMount = sdk.mounts.get(hostMountMid("models"));
if (!modelsMount) {
    throw new Error("missing required host mount `models`");
}

const stableDiffusion = new StableDiffusionServerManager({
    modelsDir: modelsMount.path,
    defaultModel: process.env.SD_CPP_DEFAULT_MODEL ?? "turingevo/tiny-sd-gguf",
    releaseTag: process.env.SD_CPP_RELEASE_TAG ?? "master-650-1ceb5bd",
    backend: process.env.SD_CPP_BACKEND ?? "auto",
    paramsBackend: process.env.SD_CPP_PARAMS_BACKEND ?? "cpu",
    threads: Number(process.env.SD_CPP_THREADS ?? "4"),
    defaultSteps: Number(process.env.SD_CPP_DEFAULT_STEPS ?? "8"),
    cfgScale: Number(process.env.SD_CPP_CFG_SCALE ?? "1"),
});

registerOaic(sdk, stableDiffusion, endpointPath("/oaic"));
registerTestHttp(sdk, stableDiffusion);

await sdk.start();
