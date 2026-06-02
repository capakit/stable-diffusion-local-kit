import type { RunnerSdk } from "@capakit/sdk";
import { mountTests } from "@capakit/sdk/testing";

import type { StableDiffusionServerManager } from "./stable_diffusion_server.ts";

export function registerTestHttp(
    sdk: RunnerSdk,
    stableDiffusion: StableDiffusionServerManager,
): void {
    mountTests(sdk, {
        tests: {
            "generate-test-image": {
                description: "Generate one small image through the local stable-diffusion.cpp server.",
                run: async () => await generateTestImage(stableDiffusion),
            },
        },
    });
}

async function generateTestImage(stableDiffusion: StableDiffusionServerManager) {
    const response = await stableDiffusion.fetch(undefined, "/v1/images/generations", {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            prompt: "a small blue paper boat on calm water, simple storybook illustration",
            n: 1,
            size: "512x512",
            response_format: "b64_json",
        }),
    });
    if (!response.ok) {
        throw new Error(`image generation failed: ${response.status} ${await response.text()}`);
    }
    const body = await response.json() as {
        data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = body.data?.[0];
    const b64 = first?.b64_json ?? "";
    return {
        image_count: body.data?.length ?? 0,
        image_bytes: b64 ? Math.floor(b64.length * 3 / 4) : 0,
        has_url: Boolean(first?.url),
    };
}
