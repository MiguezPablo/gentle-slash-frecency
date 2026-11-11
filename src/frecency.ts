/**
 * Modelo de frecency de los slash commands: cuántas veces se usó cada comando,
 * cuándo fue la última vez y cómo se ordenan las sugerencias con eso.
 *
 * Sin imports del runtime de Pi: el registro, el orden y la normalización son
 * funciones puras, así que se pueden testear fuera del editor.
 */

/** Tope de comandos guardados; el resto se descarta por puntaje. */
export const MAX_ENTRIES = 200;

/**
 * Vida media del puntaje: cada 7 días sin usar un comando, su peso cae a la
 * mitad. Un comando usado mucho hace meses pierde contra uno usado poco y ahora.
 */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cuántos comandos suben al principio de la lista. La ventana visible del
 * autocompletado muestra cinco filas, así que tres promovidos dejan dos de cola
 * a la vista; y solo cambian tres posiciones cuando cambia lo que más se usa.
 */
export const TOP_COUNT = 3;

/** Uso acumulado de un comando. */
export interface CommandUsage {
	/** Veces que se ejecutó. */
	count: number;
	/** Epoch en milisegundos del último uso. */
	lastUsed: number;
}

/** Datos persistidos: un uso por nombre de comando. */
export interface FrecencyStore {
	commands: Record<string, CommandUsage>;
}

/** Store sin datos. */
export function emptyStore(): FrecencyStore {
	return { commands: {} };
}

/**
 * Clave de un comando: el nombre sin la barra inicial. El autocompletado entrega
 * `value = "skill:foo"`, mientras que lo tipeado es `/skill:foo`; esta función
 * hace que ambos extremos hablen del mismo comando.
 */
export function commandKey(value: string): string {
	const trimmed = value.trim();
	return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

/**
 * Puntaje frecency: la cantidad de usos pesada por un decaimiento exponencial
 * desde el último uso. Un reloj que va para atrás no lo infla.
 */
export function frecencyScore(usage: CommandUsage, now: number): number {
	const age = Math.max(0, now - usage.lastUsed);
	return usage.count * 0.5 ** (age / HALF_LIFE_MS);
}

function isUsage(raw: unknown): raw is CommandUsage {
	if (typeof raw !== "object" || raw === null) return false;
	const { count, lastUsed } = raw as Record<string, unknown>;
	return typeof count === "number" && Number.isInteger(count) && count > 0
		&& typeof lastUsed === "number" && Number.isFinite(lastUsed);
}

/**
 * Deja solo las `MAX_ENTRIES` entradas de mayor puntaje. En un empate gana la de
 * último uso más reciente y, si también empatan, la agregada más tarde: se
 * descarta siempre la entrada más antigua.
 */
function evict(commands: Record<string, CommandUsage>, now: number): Record<string, CommandUsage> {
	const entries = Object.entries(commands);
	if (entries.length <= MAX_ENTRIES) return commands;

	const ranked = entries
		.map(([name, usage], index) => ({ name, usage, index, score: frecencyScore(usage, now) }))
		.sort((a, b) => b.score - a.score || b.usage.lastUsed - a.usage.lastUsed || b.index - a.index);
	const kept: Record<string, CommandUsage> = {};
	for (const entry of ranked.slice(0, MAX_ENTRIES)) {
		kept[entry.name] = entry.usage;
	}
	return kept;
}

/**
 * Convierte JSON arbitrario en un store usable: descarta entradas inválidas,
 * normaliza las claves y aplica el tope. Un JSON corrupto (o ausente) devuelve
 * un store vacío, nunca lanza.
 *
 * `now` define el puntaje con el que se decide el tope; en la carga se omite y se
 * usa el último uso más reciente, para conservar las entradas más nuevas.
 */
export function normalizeStore(raw: unknown, now?: number): FrecencyStore {
	const source = typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>).commands
		: undefined;

	const commands: Record<string, CommandUsage> = {};
	if (typeof source === "object" && source !== null && !Array.isArray(source)) {
		for (const [name, usage] of Object.entries(source as Record<string, unknown>)) {
			const key = commandKey(name);
			if (key.length === 0 || !isUsage(usage)) continue;
			commands[key] = { count: usage.count, lastUsed: usage.lastUsed };
		}
	}

	const reference = now ?? Object.values(commands).reduce((latest, usage) => Math.max(latest, usage.lastUsed), 0);
	return { commands: evict(commands, reference) };
}

/**
 * Devuelve un store nuevo con un uso más de `command`. No muta el recibido, así
 * que el llamador puede guardar la versión anterior si la escritura falla.
 */
export function recordUsage(store: FrecencyStore, command: string, now: number): FrecencyStore {
	const normalized = normalizeStore(store);
	const key = commandKey(command);
	if (key.length === 0) return normalized;

	const previous = normalized.commands[key];
	const commands = { ...normalized.commands, [key]: { count: (previous?.count ?? 0) + 1, lastUsed: now } };
	return { commands: evict(commands, now) };
}

/**
 * Ordena las sugerencias de autocompletado: arriba los `topCount` comandos de
 * mayor puntaje, en orden descendente; el resto conserva el orden original, tenga
 * usos o no. Es una permutación estable: no agrega, quita ni reescribe items.
 */
export function orderByFrecency<T extends { value: string }>(
	items: readonly T[],
	store: FrecencyStore,
	now: number,
	topCount: number = TOP_COUNT,
): T[] {
	const decorated = items.map((entry, index) => {
		const usage = store.commands[commandKey(entry.value)];
		return { item: entry, index, score: usage ? frecencyScore(usage, now) : undefined };
	});

	const promoted = decorated
		.filter((entry) => entry.score !== undefined)
		.sort((a, b) => (b.score as number) - (a.score as number) || a.index - b.index)
		.slice(0, Math.max(0, topCount));
	if (promoted.length === 0) return items.slice();

	// La cola se arma con los índices que quedaron afuera, en el orden en que
	// llegaron: un comando usado que no entró al top no se mueve.
	const promotedIndexes = new Set(promoted.map((entry) => entry.index));
	const rest = decorated.filter((entry) => !promotedIndexes.has(entry.index));

	return [...promoted, ...rest].map((entry) => entry.item);
}
