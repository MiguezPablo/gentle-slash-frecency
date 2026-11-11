/**
 * Dónde viven los datos y cómo se leen y escriben. Todo es tolerante a errores:
 * un archivo ausente o corrupto es un store vacío y la escritura es atómica, así
 * que el editor nunca queda roto ni con un JSON a medio escribir.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { emptyStore, normalizeStore, type FrecencyStore } from "./frecency.ts";

/** Nombre del archivo dentro del directorio del agente. */
export const STORE_FILE_NAME = "slash-frecency.json";

/** Último recurso cuando la API no expone el directorio del agente. */
export const FALLBACK_AGENT_DIR = [".gentle-shell", "agent"] as const;

/**
 * Directorio del agente, en orden de prioridad: el que expone la API de Pi (que
 * ya resuelve `PI_CODING_AGENT_DIR`), la variable de entorno y, si no hay nada,
 * el directorio de Gentle Shell.
 */
export function resolveAgentDir(options: {
	apiAgentDir?: string | undefined;
	envAgentDir?: string | undefined;
	home: string;
}): string {
	const fromApi = options.apiAgentDir?.trim();
	if (fromApi) return fromApi;

	const fromEnv = options.envAgentDir?.trim();
	if (fromEnv) return fromEnv.startsWith("~/") ? join(options.home, fromEnv.slice(2)) : fromEnv;

	return join(options.home, ...FALLBACK_AGENT_DIR);
}

/** Ruta del archivo de datos dentro del directorio del agente. */
export function storeFilePath(agentDir: string): string {
	return join(agentDir, STORE_FILE_NAME);
}

/** Lee el store; cualquier problema devuelve un store vacío. */
export function loadStore(path: string): FrecencyStore {
	try {
		return normalizeStore(JSON.parse(readFileSync(path, "utf-8")));
	} catch {
		return emptyStore();
	}
}

let temporaryCounter = 0;

/**
 * Escribe el store con un temporal y un rename, para que el archivo nunca quede
 * a medio escribir. Lanza si no se puede escribir y limpia el temporal: el
 * llamador decide si el error importa (en el editor, no).
 */
export function saveStore(path: string, store: FrecencyStore): void {
	const normalized = normalizeStore(store);
	mkdirSync(dirname(path), { recursive: true });

	temporaryCounter += 1;
	const temporary = `${path}.${process.pid}.${temporaryCounter}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`);
		renameSync(temporary, path);
	} catch (error) {
		try {
			rmSync(temporary, { force: true });
		} catch {
			// El error de la escritura es el que le importa al llamador.
		}
		throw error;
	}
}
