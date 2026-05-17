# Lua Scripts

Lua scripts live in `scripts/` and are copied to `dist/scripts/` during build.

Use `loadScript()` and `registerScript()` for package scripts. Registered scripts are released on process exit.

Scripts are used when operations must be atomic or when combining multiple Valkey commands into one roundtrip.
