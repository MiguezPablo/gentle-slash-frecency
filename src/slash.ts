/**
 * Qué es un slash command para esta extensión y cómo se reordena su lista de
 * sugerencias. Sin dependencias del runtime de Pi: solo tipos, para que el
 * wrapper se pueda testear con providers falsos.
 */

import type { AutocompleteSuggestions } from "@earendil-works/pi-tui";

import { orderByFrecency, type FrecencyStore } from "./frecency.ts";

/** Un comando al inicio de la línea: `/nombre` y, opcionalmente, argumentos. */
const COMMAND_TOKEN = /^\s*\/(\S+)/;

/**
 * Nombre del comando que arranca el texto tipeado, o `undefined` si no es un
 * comando. Un token con `/` adentro es una ruta (`/usr/bin/env`), no un comando.
 */
export function commandNameFromInput(text: string): string | undefined {
	const token = COMMAND_TOKEN.exec(text)?.[1];
	if (!token || token.includes("/")) return undefined;
	return token;
}

/**
 * True cuando las sugerencias son la lista de slash commands: el prefijo empieza
 * con `/` y ocupa el comienzo de la línea del cursor. El completado de argumentos
 * (`/model /ant`) y el de archivos (`@arch`) quedan afuera.
 */
export function isSlashCommandSuggestion(line: string, cursorCol: number, prefix: string): boolean {
	if (!prefix.startsWith("/") || /\s/.test(prefix)) return false;
	return line.slice(0, Math.max(0, cursorCol)).trimStart() === prefix;
}

/**
 * Reordena por frecency solo las sugerencias de slash commands y devuelve el
 * mismo objeto cuando no hay nada que cambiar. Nunca filtra: los items que llegan
 * son los que vuelven, en otro orden.
 */
export function reorderSuggestions(
	suggestions: AutocompleteSuggestions | null,
	lines: readonly string[],
	cursorLine: number,
	cursorCol: number,
	store: FrecencyStore,
	now: number,
): AutocompleteSuggestions | null {
	if (!suggestions) return null;

	const line = lines[cursorLine] ?? "";
	if (!isSlashCommandSuggestion(line, cursorCol, suggestions.prefix)) return suggestions;

	const items = orderByFrecency(suggestions.items, store, now);
	const unchanged = items.length === suggestions.items.length
		&& items.every((item, index) => item === suggestions.items[index]);
	return unchanged ? suggestions : { ...suggestions, items };
}
