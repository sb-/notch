// Thin dev-server entry point.
//
// This only re-exports the side effect of ../src/index.ts (which calls
// Bun.serve on port 1420). Its sole purpose is to give the dev-server process a
// command line that does NOT contain the substring "src/index.ts": a sibling
// project on this machine runs `pkill -f "src/index.ts"` as part of its own dev
// loop, which was collateral-killing this frontend server (both projects happen
// to use src/index.ts as their entry file). Launching via this wrapper keeps a
// single source of truth for the server config while dodging that pattern.
import '../src/index.ts';
