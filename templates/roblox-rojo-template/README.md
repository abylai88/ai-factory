# AI Factory Roblox Template

Roblox game template for the AI Factory.

Stack: Roblox + Luau + Rojo

## Layout (Rojo project, see `default.project.json`)

```
src/
├── ServerScriptService/   server entry (`main.server.lua`) + server modules
├── ServerStorage/         server-only assets/modules (never replicates)
├── ReplicatedStorage/
│   ├── Shared/            shared ModuleScripts (`Config`, pure helpers)
│   └── Remotes/           RemoteEvents/RemoteFunctions conventions
├── StarterPlayer/
│   └── StarterPlayerScripts/  client entry (`main.client.lua`)
└── StarterGui/            client UI (`HUD.client.lua`)
```

## Conventions

- Server-authoritative gameplay: trusted state (coins, upgrades, saves)
  lives on the server (`ServerScriptService`), validated on every remote call.
- `Script` (`.server.lua`) vs `LocalScript` (`.client.lua`) vs `ModuleScript`
  (`.lua`): keep each in its service container.
- Persistence: DataStore access stays on the server (`PlayerData.lua`).
- No `package.json`, no npm, no webpack — validation is `rojo build`
  (`default.project.json`) plus structural Luau checks from the factory.

## Build with Rojo (when installed)

```sh
rojo build default.project.json --output build.rbxlx
```

Then open `build.rbxlx` in Roblox Studio.
