# Fourth-party provider plugin

Custom adapter for package `com.example.employee_check`. Copy this folder or
run `splitin-verification provider scaffold`.

The plugin is sandbox-only. Production routes stay disabled. It does not call a billable vendor.

```bash
cd examples/fourth-provider
node --experimental-strip-types src/conformance.ts
```
