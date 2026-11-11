import assert from "node:assert/strict";
import { test } from "node:test";

import {
	HALF_LIFE_MS,
	MAX_ENTRIES,
	commandKey,
	emptyStore,
	frecencyScore,
	normalizeStore,
	orderByFrecency,
	recordUsage,
	type FrecencyStore,
} from "../src/frecency.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** Un item de autocompletado reducido a lo que importa para el orden. */
function item(value: string) {
	return { value, label: value, description: `desc ${value}` };
}

function values(items: Array<{ value: string }>): string[] {
	return items.map((entry) => entry.value);
}

test("un uso nuevo arranca en 1 con la marca de tiempo recibida", () => {
	const store = recordUsage(emptyStore(), "skill:commit", NOW);

	assert.deepEqual(store, { commands: { "skill:commit": { count: 1, lastUsed: NOW } } });
});

test("no muta el store recibido al registrar un uso", () => {
	const before = recordUsage(emptyStore(), "skill:commit", NOW);
	const snapshot = structuredClone(before);

	recordUsage(before, "skill:commit", NOW + 1);

	assert.deepEqual(before, snapshot);
});

test("suma el uso y actualiza la última vez", () => {
	const once = recordUsage(emptyStore(), "skill:commit", NOW);
	const twice = recordUsage(once, "skill:commit", NOW + 5 * DAY);

	assert.deepEqual(twice.commands["skill:commit"], { count: 2, lastUsed: NOW + 5 * DAY });
});

test("acepta el nombre con o sin barra inicial y guarda una sola clave", () => {
	const store = recordUsage(recordUsage(emptyStore(), "skill:commit", NOW), "/skill:commit", NOW + 1);

	assert.deepEqual(Object.keys(store.commands), ["skill:commit"]);
	assert.equal(store.commands["skill:commit"]!.count, 2);
	assert.equal(commandKey("/skill:commit"), "skill:commit");
	assert.equal(commandKey("skill:commit"), "skill:commit");
	assert.equal(commandKey("  /skill:commit  "), "skill:commit");
});

test("el puntaje decae a la mitad por cada vida media transcurrida", () => {
	const usage = { count: 4, lastUsed: NOW };

	assert.equal(frecencyScore(usage, NOW), 4);
	assert.equal(frecencyScore(usage, NOW + HALF_LIFE_MS), 2);
	assert.equal(frecencyScore(usage, NOW + 2 * HALF_LIFE_MS), 1);
});

test("un reloj que va para atrás no infla el puntaje", () => {
	const usage = { count: 2, lastUsed: NOW };

	assert.equal(frecencyScore(usage, NOW - 10 * DAY), 2);
});

test("ordena primero los usados por puntaje descendente", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:a": { count: 1, lastUsed: NOW },
			"skill:b": { count: 5, lastUsed: NOW },
			"skill:c": { count: 3, lastUsed: NOW },
		},
	};
	const items = [item("skill:a"), item("skill:b"), item("skill:c"), item("skill:d")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["skill:b", "skill:c", "skill:a", "skill:d"]);
});

test("los no usados conservan su orden original y van después de los usados", () => {
	const store: FrecencyStore = { commands: { "skill:z": { count: 1, lastUsed: NOW } } };
	const items = [item("skill:a"), item("skill:b"), item("skill:z"), item("skill:c"), item("skill:d")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["skill:z", "skill:a", "skill:b", "skill:c", "skill:d"]);
});

test("solo los 3 de mayor puntaje suben al principio", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:a": { count: 2, lastUsed: NOW },
			"skill:b": { count: 4, lastUsed: NOW },
			"skill:c": { count: 9, lastUsed: NOW },
			"skill:e": { count: 1, lastUsed: NOW },
		},
	};
	const items = [item("skill:a"), item("skill:b"), item("skill:c"), item("skill:d"), item("skill:e")];

	// Top 3: c, b, a. El usado que no entró (e) vuelve a su lugar original en vez
	// de quedar agrupado con los promovidos.
	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["skill:c", "skill:b", "skill:a", "skill:d", "skill:e"]);
});

test("la cola conserva el orden original aunque tenga usos", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:c": { count: 9, lastUsed: NOW },
			"skill:f": { count: 4, lastUsed: NOW },
			"skill:g": { count: 3, lastUsed: NOW },
			"skill:b": { count: 1, lastUsed: NOW },
		},
	};
	const items = ["skill:a", "skill:b", "skill:c", "skill:d", "skill:e", "skill:f", "skill:g"].map(item);

	assert.deepEqual(
		values(orderByFrecency(items, store, NOW)),
		["skill:c", "skill:f", "skill:g", "skill:a", "skill:b", "skill:d", "skill:e"],
	);
});

test("el tope de promovidos es configurable", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:a": { count: 2, lastUsed: NOW },
			"skill:c": { count: 9, lastUsed: NOW },
		},
	};
	const items = [item("skill:a"), item("skill:b"), item("skill:c")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW, 1)), ["skill:c", "skill:a", "skill:b"]);
	assert.deepEqual(values(orderByFrecency(items, store, NOW, 5)), ["skill:c", "skill:a", "skill:b"]);
	assert.deepEqual(values(orderByFrecency(items, store, NOW, 0)), ["skill:a", "skill:b", "skill:c"]);
});

test("si los usados entran todos en el top, ordenan como antes", () => {
	const store: FrecencyStore = { commands: { "skill:c": { count: 9, lastUsed: NOW } } };
	const items = [item("skill:a"), item("skill:b"), item("skill:c"), item("skill:d")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["skill:c", "skill:a", "skill:b", "skill:d"]);
});

test("empates de puntaje conservan el orden original", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:a": { count: 2, lastUsed: NOW },
			"skill:b": { count: 2, lastUsed: NOW },
			"skill:c": { count: 2, lastUsed: NOW },
		},
	};
	const items = [item("skill:a"), item("skill:b"), item("skill:c")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["skill:a", "skill:b", "skill:c"]);
});

test("con el mismo conteo gana el uso más reciente", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:old": { count: 3, lastUsed: NOW - 10 * DAY },
			"skill:new": { count: 3, lastUsed: NOW },
		},
	};
	const items = [item("skill:old"), item("skill:new")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["skill:new", "skill:old"]);
});

test("un uso reciente y poco frecuente puede superar a uno viejo y frecuente", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:heavy-long-ago": { count: 10, lastUsed: NOW - 3 * HALF_LIFE_MS },
			"skill:light-now": { count: 2, lastUsed: NOW },
		},
	};
	const items = [item("skill:heavy-long-ago"), item("skill:light-now")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["skill:light-now", "skill:heavy-long-ago"]);
});

test("reordena sin perder ni duplicar items ni tocar sus campos", () => {
	const store: FrecencyStore = {
		commands: {
			"skill:c": { count: 9, lastUsed: NOW },
			"skill:f": { count: 4, lastUsed: NOW },
		},
	};
	const items = ["skill:a", "skill:b", "skill:c", "skill:d", "skill:e", "skill:f", "skill:g"].map(item);
	const ordered = orderByFrecency(items, store, NOW);

	assert.equal(ordered.length, items.length);
	assert.deepEqual([...values(ordered)].sort(), [...values(items)].sort());
	for (const entry of ordered) {
		assert.deepEqual(entry, items.find((candidate) => candidate.value === entry.value));
	}
	// El array de entrada no se toca.
	assert.deepEqual(values(items), ["skill:a", "skill:b", "skill:c", "skill:d", "skill:e", "skill:f", "skill:g"]);
});

test("un item cuyo value lleva barra inicial también matchea su uso", () => {
	const store = recordUsage(emptyStore(), "skill:a", NOW);
	const items = [item("skill:b"), item("/skill:a")];

	assert.deepEqual(values(orderByFrecency(items, store, NOW)), ["/skill:a", "skill:b"]);
});

test("un store vacío deja el orden intacto", () => {
	const items = [item("skill:a"), item("skill:b")];

	assert.deepEqual(values(orderByFrecency(items, emptyStore(), NOW)), ["skill:a", "skill:b"]);
});

test("normaliza JSON corrupto a un store vacío", () => {
	for (const raw of [undefined, null, 42, "texto", [], [{ count: 1 }], { commands: [] }, { commands: "x" }]) {
		assert.deepEqual(normalizeStore(raw), emptyStore(), `esperaba vacío para ${JSON.stringify(raw)}`);
	}
});

test("conserva las entradas válidas y descarta las inválidas", () => {
	const raw = {
		commands: {
			"skill:a": { count: 2, lastUsed: NOW },
			"skill:b": { count: "3", lastUsed: NOW },
			"skill:c": { count: 1, lastUsed: "ayer" },
			"skill:d": { count: 0, lastUsed: NOW },
			"skill:e": { count: 2.5, lastUsed: NOW },
			"skill:f": {},
			"skill:g": null,
		},
	};

	assert.deepEqual(Object.keys(normalizeStore(raw).commands), ["skill:a"]);
});

test("acota el store a 200 entradas al registrar", () => {
	let store = emptyStore();
	for (let index = 0; index < MAX_ENTRIES; index += 1) {
		store = recordUsage(store, `skill:s${index}`, NOW);
	}
	assert.equal(Object.keys(store.commands).length, MAX_ENTRIES);

	// La entrada nueva entra y la más vieja (menor puntaje) sale.
	store = recordUsage(store, "skill:nueva", NOW + 1);

	assert.equal(Object.keys(store.commands).length, MAX_ENTRIES);
	assert.equal(store.commands["skill:nueva"]!.count, 1);
	assert.equal(store.commands["skill:s0"], undefined);
	assert.ok(store.commands["skill:s1"]);
});

test("un uso repetido de una entrada existente no expulsa a nadie", () => {
	let store = emptyStore();
	for (let index = 0; index < MAX_ENTRIES; index += 1) {
		store = recordUsage(store, `skill:s${index}`, NOW);
	}

	const next = recordUsage(store, "skill:s0", NOW + 1);

	assert.equal(Object.keys(next.commands).length, MAX_ENTRIES);
	assert.equal(next.commands["skill:s0"]!.count, 2);
});

test("normaliza también aplica el tope, conservando las más recientes", () => {
	const commands: Record<string, { count: number; lastUsed: number }> = {};
	for (let index = 0; index < MAX_ENTRIES + 50; index += 1) {
		commands[`skill:s${index}`] = { count: 1, lastUsed: NOW + index };
	}

	const store = normalizeStore({ commands });

	assert.equal(Object.keys(store.commands).length, MAX_ENTRIES);
	assert.equal(store.commands["skill:s0"], undefined);
	assert.equal(store.commands[`skill:s${MAX_ENTRIES + 49}`]!.lastUsed, NOW + MAX_ENTRIES + 49);
});

test("el store normalizado no comparte objetos con el JSON de entrada", () => {
	const raw = { commands: { "skill:a": { count: 1, lastUsed: NOW } } };
	const store = normalizeStore(raw);

	store.commands["skill:a"]!.count = 99;

	assert.equal(raw.commands["skill:a"].count, 1);
});
