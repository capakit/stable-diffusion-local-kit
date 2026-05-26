import { endpointPath } from "@capakit/sdk";
import type { EndpointPath, RunnerSdk } from "@capakit/sdk";

import type { StableDiffusionServerManager } from "./stable_diffusion_server.ts";

type ImageGenerationPayload = {
    model?: string;
    prompt?: string;
    [key: string]: unknown;
};

export function registerOaic(
    sdk: RunnerSdk,
    stableDiffusion: StableDiffusionServerManager,
    endpoint: EndpointPath = endpointPath("/oaic"),
): void {
    sdk.mount({
        protocol: "oaic",
        endpoint,
        handler: async (request) => {
            const url = new URL(request.url);
            const upstreamPath = oaicUpstreamPath(url, endpoint);
            const payload = await request.clone().json().catch(() => null) as ImageGenerationPayload | null;
            if (isImageGenerationPath(upstreamPath) && !payload?.prompt) {
                return Response.json(
                    { error: { message: "prompt is required" } },
                    { status: 400 },
                );
            }

            const headers = new Headers(request.headers);
            headers.delete("content-length");
            return stableDiffusion.fetch(payload?.model, upstreamPath, {
                method: request.method,
                headers,
                body: payload ? JSON.stringify(payload) : request.body,
            });
        },
    });
}

function isImageGenerationPath(path: string): boolean {
    return path === "/v1/images/generations" || path.startsWith("/v1/images/generations?");
}

function oaicUpstreamPath(url: URL, endpoint: EndpointPath): string {
    const endpointPath = endpoint.toString();
    const path = url.pathname.startsWith(`${endpointPath}/`)
        ? url.pathname.slice(endpointPath.length)
        : url.pathname;
    const normalized = path.startsWith("/v1/") ? path : `/v1${path}`;
    return `${normalized}${url.search}`;
}
