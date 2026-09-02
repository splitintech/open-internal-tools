# Protected action interruption

Shows how a human IDV or business KYB gate returns `VERIFICATION_REQUIRED`
before an external effect. The engine owns enforcement. This example is
sandbox-only; production routes stay disabled.

```bash
cd examples/protected-action
node --experimental-strip-types src/gate.ts
```
