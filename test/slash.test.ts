import assert from "node:assert/strict";
import { test } from "node:test";

import type { AutocompleteItem, AutocompleteSuggestions } from "@earendil-works/pi-tui";

import { emptyStore, recordUsage, type FrecencyStore } from "../src/frecency.ts";
import { commandNameFromInput, isSlashCommandSuggestion, reorderSuggestions } from "../src/slash.ts";

const NOW = 1_700_000_000_000;

/** Comandos tal como los entrega el provider de Pi: `value` sin barra inicial. */
const COMMANDS: AutocompleteItem[] = [
	{ value: "model", label: "model", description: "[builtin] Change the model" },
	{ value: "skill:commit", label: "skill:commit", description: "Commit the work" },
	{ value: "skill:review", label: "skill:review", description: "Review a change" },
	{ value: "skill:java", label: "skill:java", description: "Java rules" },
];

function suggestions(prefix: string, items: AutocompleteItem[] = COMMANDS): AutocompleteSuggestions {
	return { prefix, items };
}

test("lee el nombre del comando de la línea tipeada", () => {
	assert.equal(commandNameFromInput("/skill:commit"), "skill:commit");
	assert.equal(commandNameFromInput("/skill:commit con mensaje"), "skill:commit");
	assert.equal(commandNameFromInput("/skill:commit\nlínea 2"), "skill:commit");
	assert.equal(commandNameFromInput("  /skill:commit "), "skill:commit");
	assert.equal(commandNameFromInput("/model"), "model");
	assert.equal(commandNameFromInput("/unwrap 3"), "unwrap");
});

test("no cuenta texto que no es un comando", () => {
	for (const text of ["", "   ", "hola /skill:commit", "@archivo.md", "/", "//foo", "/usr/bin/env", "?"]) {
		assert.equal(commandNameFromInput(text), undefined, `esperaba undefined para ${JSON.stringify(text)}`);
	}
});

test("reconoce la sugerencia de slash commands al inicio de la línea", () => {
	assert.equal(isSlashCommandSuggestion("/", 1, "/"), true);
	assert.equal(isSlashCommandSuggestion("/s", 2, "/s"), true);
	assert.equal(isSlashCommandSuggestion("/skill:co", 9, "/skill:co"), true);
	assert.equal(isSlashCommandSuggestion("  /skill:co", 11, "/skill:co"), true);
});

test("no confunde con slash commands a los argumentos ni a otras sugerencias", () => {
	// Completado de argumentos de un comando: el prefijo es el argumento.
	assert.equal(isSlashCommandSuggestion("/model /ant", 11, "/ant"), false);
	// Archivos adjuntos.
	assert.equal(isSlashCommandSuggestion("@arch", 5, "@arch"), false);
	// Ruta absoluta a mitad de línea.
	assert.equal(isSlashCommandSuggestion("mirá /usr/lo", 12, "/usr/lo"), false);
	// Prefijo con espacio: ya son argumentos.
	assert.equal(isSlashCommandSuggestion("/skill:x ", 10, "/skill:x "), false);
	// Prefijo vacío.
	assert.equal(isSlashCommandSuggestion("", 0, ""), false);
});

test("pone arriba los comandos usados sin agregar ni quitar items", () => {
	let store = emptyStore();
	for (let index = 0; index < 3; index += 1) store = recordUsage(store, "skill:java", NOW);
	store = recordUsage(store, "skill:review", NOW);

	const ordered = reorderSuggestions(suggestions("/"), ["/"], 0, 1, store, NOW);

	assert.ok(ordered);
	assert.equal(ordered.prefix, "/");
	assert.deepEqual(
		ordered.items.map((entry) => entry.value),
		["skill:java", "skill:review", "model", "skill:commit"],
	);
	// Los items son los mismos objetos: no se reescriben label ni description.
	assert.deepEqual(
		ordered.items.find((entry) => entry.value === "skill:java"),
		COMMANDS.find((entry) => entry.value === "skill:java"),
	);
	assert.equal(ordered.items.length, COMMANDS.length);
});

test("el top se calcula solo entre los que matchean el filtro", () => {
	let store: FrecencyStore = { commands: {} };
	// Cuatro comandos con uso, todos matchean `/skill:`: solo los tres mejores suben.
	for (const [name, uses] of [["skill:commit", 1], ["skill:review", 6], ["skill:java", 4], ["skill:deploy", 2]] as const) {
		for (let index = 0; index < uses; index += 1) store = recordUsage(store, name, NOW);
	}
	const filtered: AutocompleteItem[] = [
		{ value: "skill:commit", label: "skill:commit" },
		{ value: "skill:deploy", label: "skill:deploy" },
		{ value: "skill:java", label: "skill:java" },
		{ value: "skill:review", label: "skill:review" },
	];

	const ordered = reorderSuggestions(suggestions("/skill:", filtered), ["/skill:"], 0, 7, store, NOW);

	assert.ok(ordered);
	// Top 3: review, java, deploy. `commit` no entra y queda en su lugar original.
	assert.deepEqual(
		ordered.items.map((entry) => entry.value),
		["skill:review", "skill:java", "skill:deploy", "skill:commit"],
	);
});

test("con un filtro escrito reordena solo entre los que matchean", () => {
	const store = recordUsage(emptyStore(), "skill:review", NOW);
	const filtered = [COMMANDS[2]!, COMMANDS[1]!];

	const ordered = reorderSuggestions(suggestions("/skill:r", filtered), ["/skill:r"], 0, 9, store, NOW);

	assert.ok(ordered);
	assert.deepEqual(ordered.items.map((entry) => entry.value), ["skill:review", "skill:commit"]);
});

test("sin usos deja la lista tal cual, sin copiarla", () => {
	const original = suggestions("/");

	assert.equal(reorderSuggestions(original, ["/"], 0, 1, emptyStore(), NOW), original);
});

test("no toca las sugerencias que no son slash commands", () => {
	const store = recordUsage(emptyStore(), "@skill:java", NOW);
	const files = suggestions("@skill:j", [
		{ value: "@skill:java", label: "skill:java.md", description: "archivo" },
	]);

	assert.equal(reorderSuggestions(files, ["@skill:j"], 0, 9, store, NOW), files);
});

test("no toca el completado de argumentos de un comando", () => {
	const store: FrecencyStore = { commands: { "claude-sonnet": { count: 9, lastUsed: NOW } } };
	const args = suggestions("/ant", [
		{ value: "claude-haiku", label: "claude-haiku" },
		{ value: "claude-sonnet", label: "claude-sonnet" },
	]);

	assert.equal(reorderSuggestions(args, ["/model /ant"], 0, 11, store, NOW), args);
});

test("devuelve null cuando no hay sugerencias", () => {
	assert.equal(reorderSuggestions(null, ["/"], 0, 1, emptyStore(), NOW), null);
});

test("usa la línea del cursor, no la primera", () => {
	let store = emptyStore();
	for (let index = 0; index < 2; index += 1) store = recordUsage(store, "skill:review", NOW);
	const lines = ["texto previo", "/skill:"];
	const ordered = reorderSuggestions(suggestions("/skill:"), lines, 1, 7, store, NOW);

	assert.ok(ordered);
	assert.equal(ordered.items[0]!.value, "skill:review");
});
