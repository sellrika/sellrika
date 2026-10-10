/**
 * Dependency injection.
 *
 * One container for the whole backend.
 * Repositories, services and controllers are `@Service()` classes.
 * They get their collaborators through the constructor.
 * Everything is a singleton,
 * so `Container.get(X)` always hands back the same instance.
 *
 * `reflect-metadata` is imported here (and only here),
 * so it is loaded before any decorator runs.
 * Every decorated file imports `@Service` from this module,
 * never from "typedi" directly.
 * Constructor types are read from `design:paramtypes`.
 * That needs `experimentalDecorators` + `emitDecoratorMetadata`
 * in tsconfig.json.
 */
import "reflect-metadata";

export { Container, Inject, Service } from "typedi";
export type { Constructable } from "typedi";
