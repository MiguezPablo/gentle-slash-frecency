import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

import extension from "../extensions/gentle-slash-frecency.ts";
import { STORE_FILE_NAME } from "../src/store.ts";

type Handler = (event: unknown, ctx: unknown) => void;
type ProviderFactory = (current: AutocompleteProvider) => AutocompleteProvider;

const ITEMS: AutocompleteItem[] = [
	{ value: "model", label: "model", description: "[builtin] Change the model" },
	{ value: "skill:commit", label: "skill:commit", description: "Commit the work" },
	{ value: "skill:review", label: "skill:review", description: "Review a change" },
];

function createFakePi() {
	const handlers = new Map<string, Handler>();
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
	};
	return { pi: pi as unknown as ExtensionAPI, handlers };
}

/** Provider base: devuelve siempre las mismas sugerencias y marcadores al completar. */
function createBaseProvider(suggestions: AutocompleteSuggestions | null): AutocompleteProvider {
	return {
		getSuggestions: async () => suggestions,
		applyCompletion: (lines, cursorLine, cursorCol, item) => ({
			lines: [...lines, `base:${item.value}`],
			cursorLine,
			cursorCol,
		}),
		shouldTriggerFileCompletion: () => true,
	};
}

/** Contexto de UI que registra los wrappers de autocompletado. */
function createUiContext(options: { hasUI?: boolean } = {}) {
	const factories: ProviderFactory[] = [];
	const ctx = {
		mode: "tui",
		hasUI: options.hasUI ?? true,
		ui: {
			addAutocompleteProvider: (factory: ProviderFactory) => {
				factories.push(factory);
			},
		},
	};
	return { ctx, factories };
}

type TestContext = { after(fn: () => void): void };

/**
 * Carga la extensión con la API de Pi simulada. El directorio del agente se
 * apunta a un directorio temporal para no tocar los datos reales; el valor previo
 * de la variable y el directorio se limpian al terminar.
 */
function loadExtension(t: TestContext, options: { store?: unknown; raw?: string } = {}) {
	const agentDir = mkdtempSync(join(tmpdir(), "slash-frecency-agent-"));
	if (options.raw !== undefined) writeFileSync(join(agentDir, STORE_FILE_NAME), options.raw);
	else if (options.store !== undefined) writeFileSync(join(agentDir, STORE_FILE_NAME), JSON.stringify(options.store));

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousChild = process.env.GENTLE_PI_AGENTS_CHILD;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	delete process.env.GENTLE_PI_AGENTS_CHILD;
	t.after(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		if (previousChild !== undefined) process.env.GENTLE_PI_AGENTS_CHILD = previousChild;
		rmSync(agentDir, { recursive: true, force: true });
	});

	const fake = createFakePi();
	extension(fake.pi);
	return { ...fake, agentDir };
}

function emit(handlers: Map<string, Handler>, event: string, payload: unknown, ctx: unknown = { mode: "tui", hasUI: true }): void {
	const handler = handlers.get(event);
	assert.ok(handler, `esperaba un handler para ${event}`);
	handler(payload, ctx);
}

/** Usos guardados; un archivo ausente significa que no se registró nada. */
function storedCommands(agentDir: string): Record<string, { count: number; lastUsed: number }> {
	try {
		return JSON.parse(readFileSync(join(agentDir, STORE_FILE_NAME), "utf-8")).commands;
	} catch {
		return {};
	}
}

test("registra el uso en el evento input y lo persiste", (t) => {
	const { handlers, agentDir } = loadExtension(t);

	emit(handlers, "input", { type: "input", text: "/skill:commit revisá esto", source: "interactive" });

	const commands = storedCommands(agentDir);
	assert.deepEqual(Object.keys(commands), ["skill:commit"]);
	assert.equal(commands["skill:commit"]!.count, 1);
});

test("cuenta también los comandos sin argumentos y los templates", (t) => {
	const { handlers, agentDir } = loadExtension(t);

	emit(handlers, "input", { type: "input", text: "/skill:review", source: "interactive" });
	emit(handlers, "input", { type: "input", text: "/commit ahora", source: "interactive" });

	assert.deepEqual(Object.keys(storedCommands(agentDir)).sort(), ["commit", "skill:review"]);
});

test("acumula usos sobre lo que ya estaba guardado", (t) => {
	const { handlers, agentDir } = loadExtension(t, {
		store: { commands: { "skill:commit": { count: 4, lastUsed: 1 } } },
	});

	emit(handlers, "input", { type: "input", text: "/skill:commit", source: "interactive" });

	assert.equal(storedCommands(agentDir)["skill:commit"]!.count, 5);
});

test("no cuenta texto común ni adjuntos", (t) => {
	const { handlers, agentDir } = loadExtension(t);

	emit(handlers, "input", { type: "input", text: "hola, mirá @archivo.md", source: "interactive" });
	emit(handlers, "input", { type: "input", text: "/", source: "interactive" });

	assert.deepEqual(storedCommands(agentDir), {});
	// Tampoco se crea el archivo: sin comandos no hay nada que guardar.
	assert.equal(existsSync(join(agentDir, STORE_FILE_NAME)), false);
});

test("no cuenta los mensajes que inyecta otra extensión", (t) => {
	const { handlers, agentDir } = loadExtension(t);

	emit(handlers, "input", { type: "input", text: "/skill:commit", source: "extension" });

	assert.deepEqual(storedCommands(agentDir), {});
	assert.equal(existsSync(join(agentDir, STORE_FILE_NAME)), false);
});

test("un archivo corrupto no rompe el registro de uso", (t) => {
	const { handlers, agentDir } = loadExtension(t, { raw: "{ no es json" });

	assert.doesNotThrow(() =>
		emit(handlers, "input", { type: "input", text: "/skill:commit", source: "interactive" }),
	);
	assert.equal(storedCommands(agentDir)["skill:commit"]!.count, 1);
});

test("reordena las sugerencias de slash commands con los usos guardados", async (t) => {
	const { handlers, agentDir } = loadExtension(t);
	emit(handlers, "input", { type: "input", text: "/skill:review", source: "interactive" });
	emit(handlers, "input", { type: "input", text: "/skill:review", source: "interactive" });
	emit(handlers, "input", { type: "input", text: "/skill:commit", source: "interactive" });
	assert.ok(agentDir);

	const { ctx, factories } = createUiContext();
	emit(handlers, "session_start", {}, ctx);
	assert.equal(factories.length, 1);

	const base = createBaseProvider({ items: ITEMS, prefix: "/" });
	const provider = factories[0]!(base);
	const suggestions = await provider.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal });

	assert.ok(suggestions);
	assert.deepEqual(suggestions.items.map((entry) => entry.value), ["skill:review", "skill:commit", "model"]);
	// La lista completa sigue estando: no se oculta nada.
	assert.equal(suggestions.items.length, ITEMS.length);
});

test("delega el completado en el provider base", async (t) => {
	const { handlers } = loadExtension(t);
	const { ctx, factories } = createUiContext();
	emit(handlers, "session_start", {}, ctx);

	const base = createBaseProvider({ items: ITEMS, prefix: "/" });
	const provider = factories[0]!(base);
	const result = provider.applyCompletion(["/"], 0, 1, ITEMS[1]!, "/");

	assert.deepEqual(result, { lines: ["/", "base:skill:commit"], cursorLine: 0, cursorCol: 1 });
	assert.equal(provider.shouldTriggerFileCompletion?.(["/"], 0, 1), true);
});

test("deja intactas las sugerencias que no son slash commands", async (t) => {
	const { handlers } = loadExtension(t);
	const { ctx, factories } = createUiContext();
	emit(handlers, "session_start", {}, ctx);

	const files: AutocompleteSuggestions = {
		prefix: "@arch",
		items: [{ value: "@archivo.md", label: "archivo.md", description: "archivo" }],
	};
	const provider = factories[0]!(createBaseProvider(files));

	assert.equal(await provider.getSuggestions(["@arch"], 0, 5, { signal: new AbortController().signal }), files);
});

test("propaga el null del provider base", async (t) => {
	const { handlers } = loadExtension(t);
	const { ctx, factories } = createUiContext();
	emit(handlers, "session_start", {}, ctx);

	const provider = factories[0]!(createBaseProvider(null));

	assert.equal(await provider.getSuggestions(["/zzz"], 0, 4, { signal: new AbortController().signal }), null);
});

test("no registra el provider cuando no hay UI interactiva", (t) => {
	const { handlers } = loadExtension(t);
	const { ctx, factories } = createUiContext({ hasUI: false });

	emit(handlers, "session_start", {}, ctx);

	assert.deepEqual(factories, []);
});

test("no hace nada en los subagentes hijos", (t) => {
	const previous = process.env.GENTLE_PI_AGENTS_CHILD;
	process.env.GENTLE_PI_AGENTS_CHILD = "1";
	t.after(() => {
		if (previous === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD;
		else process.env.GENTLE_PI_AGENTS_CHILD = previous;
	});

	const { pi, handlers } = createFakePi();
	extension(pi);

	assert.equal(handlers.size, 0);
});
