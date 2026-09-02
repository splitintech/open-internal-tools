# React launcher + operations console

Browser launcher props and an operator console model. The launcher receives
only a `launcherKey`, presentation, and a **memory-only** transient secret that
must never be logged or persisted.

Production routes stay disabled. Do not point the console at a live provider.

```bash
cd examples/react-launcher
node --experimental-strip-types src/console.ts
```
