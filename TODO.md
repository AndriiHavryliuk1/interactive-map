1. Get rid of magic strings and numbers.
2. Refactor code to use more object oriented principles.
3. Extract PlaybackEngine Class (Worker State Encapsulation): Refactor db.worker.ts to move
   global/module-level variables (mode, buffer, clockHandle) into a dedicated class that manages the
   simulation lifecycle, timers, and state transitions.
4. SignalRepository Pattern (Database Encapsulation): Convert the procedural functions in
   indexed-db.util.ts into a class that holds the IDBDatabase connection instance and exposes data
   access methods (save(), getInRange()).
5. Apply Command/Dispatcher Pattern (Message Routing): Replace the procedural if/else block inside the
   worker's message event listener with a structured command dispatcher or method delegation inside
   the PlaybackEngine.
6. Review architecture since it's not very clear.
7. Improve error handling and logging.
8. Migrate to NX Monorepo.
