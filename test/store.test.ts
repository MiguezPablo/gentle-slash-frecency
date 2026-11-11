import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { MAX_ENTRIES, emptyStore, recordUsage } from "../src/frecency.ts";
import { STORE_FILE_NAME, loadStore, resolveAgentDir, saveStore, storeFilePath } from "../src/store.ts";

const NOW = 1_700_000_000_000;
const HOME = "/home/persona";

/** Directorio de trabajo fuera del repo, borrado al terminar el test. */
async function scratch(t: { after(fn: () => Promise<void>): void }): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "slash-frecency-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

test("el archivo de datos vive en el directorio del agente", () => {
	assert.equal(STORE_FILE_NAME, "slash-frecency.json");
	assert.equal(storeFilePath("/home/persona/.gentle-shell/agent"), "/home/persona/.gentle-shell/agent/slash-frecency.json");
});

test("prefiere el directorio que expone la API", () => {
	assert.equal(
		resolveAgentDir({ apiAgentDir: "/api/agent", envAgentDir: "/env/agent", home: HOME }),
		"/api/agent",
	);
});

test("sin API usa PI_CODING_AGENT_DIR", () => {
	assert.equal(resolveAgentDir({ envAgentDir: "/env/agent", home: HOME }), "/env/agent");
	assert.equal(resolveAgentDir({ envAgentDir: "~/datos/agent", home: HOME }), "/home/persona/datos/agent");
});

test("sin API ni variable cae en el directorio de Gentle Shell", () => {
	assert.equal(resolveAgentDir({ home: HOME }), "/home/persona/.gentle-shell/agent");
});

test("ignora valores vacíos o con espacios", () => {
	assert.equal(resolveAgentDir({ apiAgentDir: "   ", envAgentDir: " ", home: HOME }), "/home/persona/.gentle-shell/agent");
	assert.equal(resolveAgentDir({ envAgentDir: "  /env/agent  ", home: HOME }), "/env/agent");
});

test("un archivo ausente es un store vacío", async (t) => {
	const dir = await scratch(t);

	assert.deepEqual(loadStore(join(dir, "absent.json")), emptyStore());
});

test("un archivo con JSON corrupto es un store vacío", async (t) => {
	const dir = await scratch(t);
	for (const [name, content] of [
		["broken.json", "{ comandos: "],
		["null.json", "null"],
		["list.json", "[]"],
		["string.json", "\"hola\""],
		["shape.json", JSON.stringify({ commands: { "skill:a": { count: "1" } } })],
	] as const) {
		const path = join(dir, name);
		await writeFile(path, content);
		assert.deepEqual(loadStore(path), emptyStore(), name);
	}
});

test("un directorio en lugar del archivo es un store vacío", async (t) => {
	const dir = await scratch(t);

	assert.deepEqual(loadStore(dir), emptyStore());
});

test("guarda y vuelve a leer el mismo store, con JSON legible", async (t) => {
	const dir = await scratch(t);
	const path = join(dir, STORE_FILE_NAME);
	const store = recordUsage(emptyStore(), "skill:commit", NOW);

	saveStore(path, store);

	assert.equal(await readFile(path, "utf-8"), `${JSON.stringify(store, null, 2)}\n`);
	assert.deepEqual(loadStore(path), store);
});

test("crea los directorios que faltan", async (t) => {
	const dir = await scratch(t);
	const path = join(dir, "agent", "mas", "profundo", STORE_FILE_NAME);

	saveStore(path, recordUsage(emptyStore(), "skill:commit", NOW));

	assert.deepEqual(Object.keys(loadStore(path).commands), ["skill:commit"]);
});

test("no deja archivos temporales al guardar", async (t) => {
	const dir = await scratch(t);
	const path = join(dir, STORE_FILE_NAME);

	saveStore(path, recordUsage(emptyStore(), "skill:commit", NOW));
	saveStore(path, recordUsage(recordUsage(emptyStore(), "skill:commit", NOW), "skill:review", NOW));

	assert.deepEqual(await readdir(dir), [STORE_FILE_NAME]);
});

test("acota a 200 entradas al guardar", async (t) => {
	const dir = await scratch(t);
	const path = join(dir, STORE_FILE_NAME);
	let store = emptyStore();
	for (let index = 0; index < MAX_ENTRIES + 10; index += 1) store = recordUsage(store, `skill:s${index}`, NOW + index);

	saveStore(path, store);

	assert.equal(Object.keys(loadStore(path).commands).length, MAX_ENTRIES);
});

test("al fallar la escritura no deja temporales y propaga el error", async (t) => {
	const dir = await scratch(t);
	// Un directorio con el nombre del archivo hace fallar el rename final.
	const path = join(dir, STORE_FILE_NAME);
	await scratchInto(path);

	assert.throws(() => saveStore(path, recordUsage(emptyStore(), "skill:commit", NOW)));
	assert.deepEqual(await readdir(dir), [STORE_FILE_NAME]);
});

/** Crea un directorio no vacío en `path`, para que el rename no pueda reemplazarlo. */
async function scratchInto(path: string): Promise<void> {
	const { mkdir } = await import("node:fs/promises");
	await mkdir(path, { recursive: true });
	await writeFile(join(path, "ocupado"), "x");
}
