# Manual Setup

If you'd rather not use the `npx @db0-ai/openclaw init` CLI:

## 1. Create the extension directory

```bash
mkdir -p ~/.openclaw/extensions/db0
cd ~/.openclaw/extensions/db0
npm init -y
npm install @db0-ai/openclaw
```

## 2. Create the entry point

`~/.openclaw/extensions/db0/index.js`:

```javascript
module.exports = async function register(api) {
  const mod = await import("@db0-ai/openclaw");
  api.registerContextEngine("db0", () => mod.db0());
};
```

## 3. Create the plugin manifest

`~/.openclaw/extensions/db0/openclaw.plugin.json`:

```json
{
  "id": "db0",
  "name": "db0 Context Engine",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
```

## 4. Update OpenClaw config

`~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "none",
      "contextEngine": "db0"
    },
    "entries": {
      "db0": { "enabled": true }
    }
  }
}
```

## 5. Restart OpenClaw
