import {
  PostgrestBuilder,
  type PostgrestClient,
  type PostgrestClientOptions,
  PostgrestQueryBuilder,
  type PostgrestResponseSuccess,
  type PostgrestSingleResponse
} from "@supabase/postgrest-js"
import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import { getColumns, getTableName, is } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"

declare module "@supabase/postgrest-js" {
  interface PostgrestBuilder<
    ClientOptions extends PostgrestClientOptions,
    Result$1,
    ThrowOnError extends boolean = false
  > {
    then<
      TResult1 = ThrowOnError extends true
        ? PostgrestResponseSuccess<Result$1>
        : PostgrestSingleResponse<Result$1>,
      TResult2 = never
    >(
      onfulfilled?:
        | ((
            value: ThrowOnError extends true
              ? PostgrestResponseSuccess<Result$1>
              : PostgrestSingleResponse<Result$1>
          ) => TResult1 | PromiseLike<TResult1>)
        | undefined
        | null,
      onrejected?: // biome-ignore lint/suspicious/noExplicitAny: matches upstream
      ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2>
  }
}

/** Types a postgrest-js `Database` from a drizzle schema: every table, keyed by its SQL name. */
export type DrizzlePostgrest<Schema> = {
  public: {
    Tables: {
      [K in keyof Schema as Schema[K] extends PgTable
        ? Schema[K]["_"]["name"]
        : never]: Schema[K] extends PgTable
        ? {
            Row: InferSelectModel<Schema[K]>
            Insert: InferInsertModel<Schema[K]>
            Update: Partial<InferInsertModel<Schema[K]>>
            Relationships: []
          }
        : never
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

interface TableMap {
  toColumn: Record<string, string>
  toKey: Record<string, string>
  dates: Set<string>
}

type Row = Record<string, unknown>

const COLUMN_FIRST = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "likeAllOf",
  "likeAnyOf",
  "ilikeAllOf",
  "ilikeAnyOf",
  "is",
  "in",
  "contains",
  "containedBy",
  "rangeGt",
  "rangeGte",
  "rangeLt",
  "rangeLte",
  "rangeAdjacent",
  "overlaps",
  "textSearch",
  "not",
  "filter",
  "order"
])

const tableMap = (table: PgTable): TableMap => {
  const map: TableMap = { toColumn: {}, toKey: {}, dates: new Set() }
  for (const [key, column] of Object.entries(getColumns(table))) {
    map.toColumn[key] = column.name
    map.toKey[column.name] = key
    if (column.dataType === "object date") map.dates.add(key)
  }
  return map
}

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const wire = (value: unknown): unknown =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(wire)
      : value

const column = (map: TableMap, name: unknown) =>
  typeof name === "string" ? (map.toColumn[name] ?? name) : name

const columnList = (map: TableMap, list: string) =>
  list
    .split(",")
    .map((item) => column(map, item.trim()))
    .join(",")

const toWire = (map: TableMap, values: unknown): unknown => {
  if (Array.isArray(values)) return values.map((row) => toWire(map, row))
  if (!isRow(values)) return values
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [column(map, key), value])
  )
}

const fromWire = (map: TableMap, data: unknown): unknown => {
  if (Array.isArray(data)) return data.map((row) => fromWire(map, row))
  if (!isRow(data)) return data
  return Object.fromEntries(
    Object.entries(data).map(([name, value]) => {
      const key = map.toKey[name] ?? name
      return [
        key,
        map.dates.has(key) && typeof value === "string"
          ? new Date(value)
          : value
      ]
    })
  )
}

const rewrite = (map: TableMap, method: string, args: unknown[]) => {
  if (method === "select" && typeof args[0] === "string") {
    return [columnList(map, args[0]), ...args.slice(1)]
  }
  if (method === "insert" || method === "update" || method === "upsert") {
    const [values, options] = args
    const onConflict =
      isRow(options) && typeof options.onConflict === "string"
        ? { ...options, onConflict: columnList(map, options.onConflict) }
        : options
    return [toWire(map, values), onConflict, ...args.slice(2)]
  }
  if (method === "match" && isRow(args[0])) {
    return [toWire(map, wire(args[0])), ...args.slice(1)]
  }
  if (COLUMN_FIRST.has(method)) {
    return [column(map, args[0]), wire(args[1]), ...args.slice(2)]
  }
  return args
}

const wrap = <Builder extends object>(builder: Builder, map: TableMap) =>
  new Proxy(builder, {
    get(target, property) {
      if (property === "then" && target instanceof PostgrestBuilder) {
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) =>
          Promise.resolve(target)
            .then((response) => ({
              ...response,
              data: fromWire(map, response.data)
            }))
            .then(onFulfilled, onRejected)
      }
      const value = Reflect.get(target, property, target)
      if (typeof value !== "function" || typeof property !== "string") {
        return value
      }
      return (...args: unknown[]) => {
        const result = value.apply(target, rewrite(map, property, args))
        return result instanceof PostgrestBuilder ||
          result instanceof PostgrestQueryBuilder
          ? wrap(result, map)
          : result
      }
    }
  })

/**
 * Types a postgrest-js client against a drizzle schema, and makes the wire
 * match: TypeScript keys go out as SQL column names and come back as keys,
 * and date columns come back as Dates.
 *
 * Not translated: the string syntax of `or()` and `filter()` values, embedded
 * resources in `select()`, and `rpc()`.
 */
export function createDrizzlePostgrest<Schema extends Record<string, unknown>>(
  schema: Schema,
  postgrestClient: PostgrestClient
) {
  const tables: Record<string, TableMap> = {}
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) tables[getTableName(value)] = tableMap(value)
  }

  const wrapClient = (client: PostgrestClient): PostgrestClient =>
    new Proxy(client, {
      get(target, property) {
        if (property === "from") {
          return (relation: string) => {
            const builder = target.from(relation)
            const map = tables[relation]
            return map ? wrap(builder, map) : builder
          }
        }
        if (property === "schema") {
          return (name: string) =>
            wrapClient(target.schema(name) as PostgrestClient)
        }
        return Reflect.get(target, property, target)
      }
    })

  return wrapClient(postgrestClient) as PostgrestClient<
    DrizzlePostgrest<Schema>
  >
}
