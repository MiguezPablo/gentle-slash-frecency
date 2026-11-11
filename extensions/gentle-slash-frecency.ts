/**
 * gentle-slash-frecency
 *
 * Al escribir `/` en el editor, las sugerencias de slash commands (skills,
 * prompt templates y comandos de extensión) se ordenan por frecency: arriba las
 * que más se usan, con un decaimiento por recencia. No se oculta ninguna: la
 * lista es la misma, en otro orden.
 *
 * Los usos se registran desde el evento `input` y se guardan en
 * `<agentDir>/slash-frecency.json`. Toda la lógica de orden y persistencia vive
 * en `src/`, sin runtime de Pi, para poder testearla.
 */

import { homedir } from "node:os";

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { recordUsage } from "../src/frecency.ts";
import { commandNameFromInput, reorderSuggestions } from "../src/slash.ts";
import { loadStore, resolveAgentDir, saveStore, storeFilePath } from "../src/store.ts";

/** Directorio del agente según la API de Pi; `undefined` si no lo expone. */
function apiAgentDir(): string | undefined {
	try {
		const dir = getAgentDir();
		return typeof dir === "string" && dir.trim().length > 0 ? dir : undefined;
	} catch {
		return undefined;
	}
}

export default function slashFrecency(pi: ExtensionAPI) {
	// En los subagentes hijos no hay nadie tipeando: registrar usos ahí ensuciaría
	// las estadísticas con lo que el padre delega.
	if (process.env.GENTLE_PI_AGENTS_CHILD !== undefined) return;

	const storePath = storeFilePath(
		resolveAgentDir({
			apiAgentDir: apiAgentDir(),
			envAgentDir: process.env.PI_CODING_AGENT_DIR,
			home: homedir(),
		}),
	);
	let store = loadStore(storePath);
	let providerRegistered = false;

	// El texto llega crudo (`/skill:foo args`), antes de expandir skills y
	// templates. Los comandos de extensión no pasan por acá: los atiende su
	// handler y este evento no se dispara.
	pi.on("input", (event) => {
		if (event.source === "extension") return;

		const command = commandNameFromInput(event.text);
		if (!command) return;

		store = recordUsage(store, command, Date.now());
		try {
			saveStore(storePath, store);
		} catch {
			// Un disco lleno o un directorio de solo lectura no deben romper el
			// editor: el uso queda en memoria y se pierde al cerrar la sesión.
		}
	});

	pi.on("session_start", (_event, ctx) => {
		// Sin UI interactiva no hay autocompletado que ordenar; y registrar el
		// wrapper dos veces reordenaría de más (idempotente, pero inútil).
		if (!ctx.hasUI || providerRegistered) return;
		providerRegistered = true;

		ctx.ui.addAutocompleteProvider((current) => {
			const triggerCharacters = current.triggerCharacters;
			const fileCompletion = current.shouldTriggerFileCompletion;
			return {
				...(triggerCharacters ? { triggerCharacters: [...triggerCharacters] } : {}),
				async getSuggestions(lines, cursorLine, cursorCol, options) {
					const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
					// El store se lee en cada pedido: un uso registrado hace un segundo
					// ya pesa en la próxima tecla.
					return reorderSuggestions(suggestions, lines, cursorLine, cursorCol, store, Date.now());
				},
				applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
					return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
				},
				...(fileCompletion
					? {
						shouldTriggerFileCompletion: (lines: string[], cursorLine: number, cursorCol: number) =>
							fileCompletion.call(current, lines, cursorLine, cursorCol),
					}
					: {}),
			};
		});
	});
}
