import { endpointPath, type WorkloadSdk } from "@capakit/sdk";

import type { StableDiffusionServerManager } from "./stable_diffusion_server.ts";

export function registerTestHttp(
    sdk: WorkloadSdk,
    stableDiffusion: StableDiffusionServerManager,
): void {
    sdk.mount({
        protocol: "http",
        endpoint: endpointPath("/test"),
        handler: async (request) => {
            if (request.method !== "POST") {
                return Response.json({ error: "method not allowed" }, { status: 405 });
            }
            if (lastPathSegment(new URL(request.url).pathname) !== "generate-test-image") {
                return Response.json({ error: "not found" }, { status: 404 });
            }
            try {
                return Response.json(await generateTestImage(stableDiffusion));
            } catch (error) {
                return Response.json(
                    { error: error instanceof Error ? error.message : String(error) },
                    { status: 500 },
                );
            }
        },
    });
}

function lastPathSegment(pathname: string): string | undefined {
    return pathname.split("/").filter(Boolean).at(-1);
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
