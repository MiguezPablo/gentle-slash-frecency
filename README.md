# gentle-slash-frecency

Extensión de Pi que ordena el autocompletado de slash commands por **frecency**: al escribir `/` en el editor, arriba aparecen las skills, prompts y comandos de extensión que más usás, con un decaimiento por recencia. No oculta nada — la lista es la misma, en otro orden.

```text
> /
  skill:java          Java 21 y Spring Boot 3
  skill:commit        Redacta el commit con el diff actual
  /model              Cambiar de modelo
  skill:review        Revisar un cambio
  ...
```

## Qué hace

- Registra cada uso de un comando que pasa por el evento `input` (`/skill:foo`, `/mi-template`, …), sin tocar el texto que escribiste.
- Puntúa cada comando con `usos × 0.5^(días sin usar / 7)`: la frecuencia manda, pero un comando que no usás desde hace tres semanas pesa ocho veces menos que uno usado hoy.
- Reordena las sugerencias de slash commands en dos partes: arriba los **3 comandos de mayor puntaje**, en orden descendente; del cuarto en adelante, el orden original de Pi, tenga usos o no. Con un filtro escrito (`/sk`) el top 3 se calcula solo entre los que matchean.
- La cola no se mueve: un comando usado que no entra al top 3 vuelve a su lugar de siempre, así que las posiciones son predecibles y solo cambian cuando cambia lo que más usás.
- Deja intacto todo lo que no es un slash command: `@archivo`, rutas y el completado de argumentos (`/model /ant`) pasan sin cambios.
- Nunca rompe el editor: un archivo ausente, ilegible o con JSON corrupto equivale a "sin datos", y una escritura fallida solo pierde el uso en memoria.

## Instalación

Con Gentle Shell o Pi, desde el directorio del repo:

```bash
pi install ./gentle-slash-frecency
gentle-shell install ./gentle-slash-frecency
```

`pi install` agrega el paquete a `~/.pi/agent/settings.json` (o a `.pi/settings.json` con `--local`). También se puede declarar el path local a mano:

```json
{
  "packages": ["/home/persona/ProyectosPersonales/PROPIO/gentle-slash-frecency"]
}
```

Un path relativo se resuelve desde el archivo de settings que lo contiene. Después de instalar, recargá (`/reload`) o abrí una sesión nueva para que la extensión se cargue.

Para probarla una sola vez, sin instalarla:

```bash
pi -e ./gentle-slash-frecency
```

La extensión vive en `extensions/gentle-slash-frecency.ts` (ver la clave `pi` de `package.json`).

## Dónde guarda los datos

Un solo archivo, en el directorio del agente de Pi:

- `$PI_CODING_AGENT_DIR/slash-frecency.json` cuando la variable está definida
- `~/.gentle-shell/agent/slash-frecency.json` en Gentle Shell (que define esa variable)
- `~/.pi/agent/slash-frecency.json` en Pi sin la variable

```json
{
  "commands": {
    "skill:java": { "count": 12, "lastUsed": 1767225600000 }
  }
}
```

`count` son los usos y `lastUsed` el epoch en milisegundos del último. Se guardan hasta **200 comandos**: al superar el tope se descarta el de menor puntaje. La escritura es atómica (archivo temporal y `rename`), así que el JSON nunca queda a medio escribir.

### Resetear

Borrá el archivo y listo; la extensión arranca de cero:

```bash
rm "$PI_CODING_AGENT_DIR/slash-frecency.json"
```

Para olvidar un solo comando, borrá su entrada del JSON con el editor cerrado. También podés editarlo a mano: las entradas inválidas se descartan al leer.

## Detalles

- **Qué cuenta como uso**: el primer token de un mensaje que empieza con `/` — `/skill:foo`, `/skill:foo con argumentos` y `/mi-template` cuentan igual. Un token con `/` adentro (`/usr/bin/env`) es una ruta y no se cuenta, y los mensajes inyectados por otra extensión tampoco.
- **Comandos registrados con `pi.registerCommand`**: Pi corre su handler antes del evento `input`, así que esos usos no se registran; sus sugerencias sí se ordenan con lo que haya de las skills y los templates.
- **En subagentes hijos** la extensión no hace nada: no hay nadie tipeando ahí.
- **Sin UI interactiva** (modo print o JSON) no se registra el provider de autocompletado.
- El orden es estable: dos comandos con el mismo puntaje conservan el orden que traía Pi, y la cola (del cuarto en adelante) nunca se mueve entre sí.
- **Cantidad promovida**: 3 por defecto (`TOP_COUNT` en `src/frecency.ts`). El tope es un parámetro de `orderByFrecency`, no un número suelto: se puede probar con 1, 3 o 5 sin tocar la lógica.

## Desarrollo

```bash
npm install
npm test          # node --test
npm run typecheck # tsc --noEmit
```

La lógica pura (registro, puntaje, orden y persistencia) está en `src/` y no importa el runtime de Pi, así que los tests corren sin TUI:

- `src/frecency.ts` — modelo de usos, puntaje y orden.
- `src/slash.ts` — qué es un slash command y el reordenamiento de sugerencias.
- `src/store.ts` — resolución del directorio del agente, lectura y escritura atómica.
- `extensions/gentle-slash-frecency.ts` — el cableado con Pi.

## Licencia

MIT
