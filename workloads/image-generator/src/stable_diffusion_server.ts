import { spawn, type ChildProcess } from "node:child_process";
import { access, chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

type StableDiffusionServerManagerOptions = {
    modelsDir: string;
    defaultModel: string;
    releaseTag: string;
    backend: string;
    paramsBackend: string;
    threads: number;
    defaultSteps: number;
    cfgScale: number;
};

type ActiveServer = {
    key: string;
    port: number;
    process: ChildProcess;
    logTail: string[];
};

type ModelMemoryEstimate = {
    modelBytes: number;
    estimatedRequiredBytes: number;
    systemMemoryBytes: number;
    ratio: number;
};

const DEFAULT_MEMORY_WARN_RATIO = 0.65;
const DEFAULT_MEMORY_FAIL_RATIO = 0.92;
const MODEL_RUNTIME_OVERHEAD_RATIO = 1.0;
const MIN_MODEL_RUNTIME_OVERHEAD_BYTES = 2 * 1024 ** 3;
const LOG_TAIL_LINES = 30;
const LOG_TAIL_LINE_CHARS = 500;

export class StableDiffusionServerManager {
    private active: ActiveServer | null = null;
    private startPromise: Promise<ActiveServer> | null = null;

    constructor(private readonly options: StableDiffusionServerManagerOptions) {}

    async fetch(model: string | undefined, path: string, init: RequestInit): Promise<Response> {
        const server = await this.ensure(model);
        return fetch(`http://127.0.0.1:${server.port}${path}`, init);
    }

    async stop(): Promise<void> {
        const active = this.active;
        this.active = null;
        this.startPromise = null;
        if (!active) {
            return;
        }
        active.process.kill("SIGTERM");
        await new Promise<void>((resolve) => {
            active.process.once("exit", () => resolve());
            setTimeout(resolve, 2_000);
        });
    }

    private async ensure(model: string | undefined): Promise<ActiveServer> {
        const target = model ?? this.options.defaultModel;
        if (this.active?.key === target) {
            return this.active;
        }
        if (this.startPromise) {
            const active = await this.startPromise;
            if (active.key === target) {
                return active;
            }
        }
        await this.stop();
        this.startPromise = this.start(target).finally(() => {
            this.startPromise = null;
        });
        return this.startPromise;
    }

    private async start(model: string): Promise<ActiveServer> {
        const sdServer = await hydrateStableDiffusionServer(
            this.options.modelsDir,
            this.options.releaseTag,
        );
        const modelPath = await hydrateModel(this.options.modelsDir, model);
        const port = await findFreePort();
        const args = [
            "--model",
            modelPath,
            "--listen-ip",
            "127.0.0.1",
            "--listen-port",
            String(port),
            "--threads",
            String(this.options.threads),
            "--steps",
            String(this.options.defaultSteps),
            "--cfg-scale",
            String(this.options.cfgScale),
            ...backendArgs(this.options.backend, this.options.paramsBackend),
        ];

        const child = spawn(sdServer, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        const active = { key: model, port, process: child, logTail: [] };
        attachLogs(active);
        await waitForServer(active);
        this.active = active;
        return active;
    }
}

function backendArgs(backend: string, paramsBackend: string): string[] {
    const args: string[] = [];
    if (backend !== "auto") {
        args.push("--backend", backend);
    }
    if (paramsBackend !== "auto") {
        args.push("--params-backend", paramsBackend);
    }
    return args;
}

async function hydrateStableDiffusionServer(modelsDir: string, releaseTag: string): Promise<string> {
    const platform = sdReleasePlatform();
    const asset = `sd-${releaseTag.replace(/^master-\d+-/, "master-")}-bin-${platform}.zip`;
    const releaseDir = join(modelsDir, "stable-diffusion.cpp", releaseTag, platform);
    const binary = await findExistingFile(releaseDir, "sd-server");
    if (binary) {
        return binary;
    }

    await mkdir(releaseDir, { recursive: true });
    const archive = join(releaseDir, asset);
    const url = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${releaseTag}/${asset}`;
    console.log(`[stable-diffusion-local] downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `failed downloading stable-diffusion.cpp release ${releaseTag}: ${response.status} ${response.statusText}`,
        );
    }
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    await run("/usr/bin/unzip", ["-q", "-o", archive, "-d", releaseDir]);

    const found = await findFile(releaseDir, "sd-server");
    if (!found) {
        throw new Error(`stable-diffusion.cpp release ${releaseTag} did not contain sd-server`);
    }
    await chmod(found, 0o755);
    return found;
}

async function findExistingFile(root: string, name: string): Promise<string | null> {
    try {
        return await findFile(root, name);
    } catch {
        return null;
    }
}

function sdReleasePlatform(): string {
    if (process.platform === "darwin" && process.arch === "arm64") {
        return "Darwin-macOS-15.7.7-arm64";
    }
    if (process.platform === "linux" && process.arch === "x64") {
        return "Linux-Ubuntu-24.04-x86_64";
    }
    throw new Error(`unsupported stable-diffusion.cpp release platform ${process.platform}/${process.arch}`);
}

async function hydrateModel(modelsDir: string, model: string): Promise<string> {
    if (isLocalModelSpec(model)) {
        await checkModelMemory(model, await localFileSize(model));
        return model;
    }
    const { repo, selector } = parseModelSpec(model);
    const modelDir = join(modelsDir, "diffusion", safeName(repo));
    await mkdir(modelDir, { recursive: true });
    const selected = await resolveModelFile(repo, selector);
    const destination = join(modelDir, selected.fileName);
    if (await isExecutable(destination)) {
        await checkModelMemory(model, await localFileSize(destination));
        return destination;
    }
    const url = `https://huggingface.co/${repo}/resolve/main/${encodePath(selected.fileName)}`;
    await checkModelMemory(model, selected.sizeBytes ?? await remoteFileSize(url));
    console.log(`[stable-diffusion-local] downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`failed downloading model ${model}: ${response.status} ${response.statusText}`);
    }
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    return destination;
}

function isLocalModelSpec(model: string): boolean {
    return model.startsWith("/") || model.startsWith(".");
}

function parseModelSpec(model: string): { repo: string; selector: string | null } {
    const [repo, selector] = model.split(":", 2);
    if (!repo.includes("/")) {
        throw new Error(`model \`${model}\` must be a local path or Hugging Face repo id`);
    }
    return { repo, selector: selector ?? null };
}

async function resolveModelFile(
    repo: string,
    selector: string | null,
): Promise<{ fileName: string; sizeBytes: number | null }> {
    const response = await fetch(`https://huggingface.co/api/models/${repo}`);
    if (!response.ok) {
        throw new Error(`failed resolving model repo ${repo}: ${response.status} ${response.statusText}`);
    }
    const body = await response.json() as { siblings?: Array<{ rfilename?: string; size?: number }> };
    const files = body.siblings
        ?.filter((item) => item.rfilename && isSupportedModelFile(item.rfilename))
        ?? [];
    const selected = selector
        ? files.find((file) => file.rfilename?.toLowerCase().includes(selector.toLowerCase()))
        : files[0];
    if (!selected?.rfilename) {
        throw new Error(`no supported diffusion model file found in ${repo}${selector ? ` matching ${selector}` : ""}`);
    }
    return {
        fileName: selected.rfilename,
        sizeBytes: typeof selected.size === "number" ? selected.size : null,
    };
}

function isSupportedModelFile(fileName: string): boolean {
    return [".gguf", ".safetensors", ".ckpt"].some((suffix) =>
        fileName.toLowerCase().endsWith(suffix)
    );
}

async function checkModelMemory(model: string, modelBytes: number): Promise<void> {
    if ((process.env.SD_CPP_MEMORY_CHECK ?? "on").toLowerCase() === "off") {
        return;
    }
    const estimate = estimateModelMemory(modelBytes);
    const failRatio = memoryRatioEnv("SD_CPP_MEMORY_FAIL_RATIO", DEFAULT_MEMORY_FAIL_RATIO);
    const warnRatio = memoryRatioEnv("SD_CPP_MEMORY_WARN_RATIO", DEFAULT_MEMORY_WARN_RATIO);
    if (estimate.ratio >= failRatio) {
        throw new Error(
            `model ${model} is too large for local memory: ${formatMemoryEstimate(estimate)}. `
            + "Set SD_CPP_MEMORY_CHECK=off to bypass this guard.",
        );
    }
    if (estimate.ratio >= warnRatio) {
        console.warn(`[stable-diffusion-local] warning: model ${model} may pressure memory: ${formatMemoryEstimate(estimate)}`);
    }
}

function estimateModelMemory(modelBytes: number): ModelMemoryEstimate {
    const estimatedRequiredBytes = modelBytes
        + Math.max(modelBytes * MODEL_RUNTIME_OVERHEAD_RATIO, MIN_MODEL_RUNTIME_OVERHEAD_BYTES);
    const systemMemoryBytes = totalmem();
    return {
        modelBytes,
        estimatedRequiredBytes,
        systemMemoryBytes,
        ratio: estimatedRequiredBytes / systemMemoryBytes,
    };
}

function memoryRatioEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) {
        return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
        throw new Error(`${key} must be a number between 0 and 1`);
    }
    return parsed;
}

function formatMemoryEstimate(estimate: ModelMemoryEstimate): string {
    return [
        `model=${formatBytes(estimate.modelBytes)}`,
        `estimated_required=${formatBytes(estimate.estimatedRequiredBytes)}`,
        `system_memory=${formatBytes(estimate.systemMemoryBytes)}`,
        `ratio=${Math.round(estimate.ratio * 100)}%`,
    ].join(" ");
}

function formatBytes(bytes: number): string {
    const gib = bytes / 1024 ** 3;
    if (gib >= 1) {
        return `${gib.toFixed(1)}GiB`;
    }
    return `${(bytes / 1024 ** 2).toFixed(0)}MiB`;
}

async function findFreePort(): Promise<number> {
    const { createServer } = await import("node:net");
    return await new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close(() => reject(new Error("failed to allocate local port")));
                return;
            }
            const port = address.port;
            server.close(() => resolve(port));
        });
    });
}

async function waitForServer(server: ActiveServer): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < 180_000) {
        if (server.process.exitCode !== null) {
            throw new Error(`sd-server exited with code ${server.process.exitCode}${formatLogTail(server)}`);
        }
        try {
            const response = await fetch(`http://127.0.0.1:${server.port}/`);
            if (response.ok) {
                return;
            }
        } catch {}
        await sleep(500);
    }
    throw new Error(`timed out waiting for sd-server model=${server.key}${formatLogTail(server)}`);
}

function attachLogs(server: ActiveServer): void {
    pipeLogStream(server.process.stdout, server.logTail, "stdout", process.stdout);
    pipeLogStream(server.process.stderr, server.logTail, "stderr", process.stderr);
}

function pipeLogStream(
    stream: Readable | null,
    tail: string[],
    label: string,
    output: NodeJS.WriteStream,
): void {
    if (!stream) {
        return;
    }
    let pending = "";
    stream.on("data", (chunk: Buffer | string) => {
        pending += chunk.toString();
        const parts = pending.split(/[\r\n]+/);
        pending = parts.pop() ?? "";
        for (const line of parts) {
            ingestLogLine(tail, label, line, output);
        }
    });
    stream.on("end", () => {
        ingestLogLine(tail, label, pending, output);
        pending = "";
    });
}

function ingestLogLine(
    tail: string[],
    label: string,
    rawLine: string,
    output: NodeJS.WriteStream,
): void {
    const line = rawLine.trim();
    if (!line) {
        return;
    }
    output.write(`${line}\n`);
    tail.push(`${label}: ${truncateLogLine(line)}`);
    if (tail.length > LOG_TAIL_LINES) {
        tail.splice(0, tail.length - LOG_TAIL_LINES);
    }
}

function formatLogTail(server: ActiveServer): string {
    if (server.logTail.length === 0) {
        return "";
    }
    return `\nrecent sd-server logs:\n${server.logTail.join("\n")}`;
}

function truncateLogLine(line: string): string {
    return line.length <= LOG_TAIL_LINE_CHARS
        ? line
        : `${line.slice(0, LOG_TAIL_LINE_CHARS)}...`;
}

function safeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
}

async function localFileSize(path: string): Promise<number> {
    return (await stat(path)).size;
}

async function remoteFileSize(url: string): Promise<number> {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
        throw new Error(`failed checking model size: ${response.status} ${response.statusText}`);
    }
    const raw = response.headers.get("content-length");
    const bytes = raw ? Number(raw) : NaN;
    if (!Number.isFinite(bytes) || bytes <= 0) {
        throw new Error("failed checking model size: missing content-length");
    }
    return bytes;
}

async function isExecutable(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function findFile(root: string, name: string): Promise<string | null> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isFile() && entry.name === name) {
            return path;
        }
        if (entry.isDirectory()) {
            const found = await findFile(path, name);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

async function run(program: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(program, args, { stdio: ["ignore", "inherit", "inherit"] });
        child.once("error", reject);
        child.once("exit", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${program} exited with code ${code}`));
            }
        });
    });
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
