/* Bootstrap equivalent of Convex codegen; regenerate with `npx convex dev`. */
import {
  queryGeneric,
  mutationGeneric,
  internalQueryGeneric,
  internalMutationGeneric,
  internalActionGeneric,
  httpActionGeneric,
} from "convex/server";
import type {
  QueryBuilder,
  MutationBuilder,
  ActionBuilder,
  GenericQueryCtx,
  GenericMutationCtx,
} from "convex/server";
import type { DataModel } from "./dataModel";
export const query: QueryBuilder<DataModel, "public"> = queryGeneric;
export const mutation: MutationBuilder<DataModel, "public"> = mutationGeneric;
export const internalQuery: QueryBuilder<DataModel, "internal"> =
  internalQueryGeneric;
export const internalMutation: MutationBuilder<DataModel, "internal"> =
  internalMutationGeneric;
export const internalAction: ActionBuilder<DataModel, "internal"> =
  internalActionGeneric;
export const httpAction = httpActionGeneric;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
