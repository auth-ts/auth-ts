import {
  PostgrestBuilder,
  type PostgrestClient,
  type PostgrestClientOptions,
  PostgrestQueryBuilder,
  type PostgrestResponseSuccess,
  type PostgrestSingleResponse
} from "@supabase/postgrest-js"
import type {
  Column,
  InferInsertModel,
  InferSelectModel,
  Many,
  One
} from "drizzle-orm"
import { getTableColumns, getTableName, is } from "drizzle-orm"
import { type Casing, getCasingFn } from "drizzle-orm/casing"
import { getTableConfig, PgTable } from "drizzle-orm/pg-core"

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

type UnionToIntersection<U> = (
  U extends unknown
    ? (value: U) => void
    : never
) extends (value: infer I) => void
  ? I
  : never

type LastOf<U> =
  UnionToIntersection<U extends unknown ? () => U : never> extends () => infer R
    ? R
    : never

/** Bounded so the open form terminates when postgrest-js checks its constraint. */
type UnionToTuple<U, Depth extends unknown[] = []> = Depth["length"] extends 16
  ? []
  : [U] extends [never]
    ? []
    : [...UnionToTuple<Exclude<U, LastOf<U>>, [...Depth, 0]>, LastOf<U>]

/** The tables in what was passed: a schema module, or what `defineRelations` returns. */
type TablesOf<Schema> = {
  [K in keyof Schema as Schema[K] extends PgTable
    ? K
    : Schema[K] extends { table: PgTable }
      ? K
      : never]: Schema[K] extends PgTable
    ? Schema[K]
    : Schema[K] extends { table: infer T extends PgTable }
      ? T
      : never
}

type RelationsOf<Schema> = {
  [K in keyof Schema]: Schema[K] extends {
    relations: infer R extends Record<string, unknown>
  }
    ? R
    : Record<string, never>
}

type SqlName<Tables, K> = K extends keyof Tables
  ? Tables[K] extends PgTable
    ? Tables[K]["_"]["name"]
    : never
  : never

type NullableKeys<Row> = {
  [C in keyof Row]: null extends Row[C] ? C : never
}[keyof Row]

type RowOf<Tables, T> = T extends keyof Tables
  ? Tables[T] extends PgTable
    ? InferSelectModel<Tables[T]>
    : never
  : never

type OneKeysTo<Relations, From, To> = {
  [R in keyof Relations[From & keyof Relations]]: Relations[From &
    keyof Relations][R] extends One<To & string, boolean>
    ? R
    : never
}[keyof Relations[From & keyof Relations]]

type MultipleOnesTo<Relations, From, To> =
  UnionToTuple<OneKeysTo<Relations, From, To>> extends [
    unknown,
    unknown,
    ...unknown[]
  ]
    ? true
    : false

type HasOneTo<Relations, From, To> = [OneKeysTo<Relations, From, To>] extends [
  never
]
  ? false
  : true

/** `one` relations on this table: it holds the foreign key. */
type OneRelationships<Tables, Relations, T extends keyof Tables> = {
  [R in keyof Relations[T & keyof Relations]]: Relations[T &
    keyof Relations][R] extends One<infer Target, infer Optional>
    ? Target extends keyof Tables
      ? {
          foreignKeyName: MultipleOnesTo<Relations, T, Target> extends true
            ? `${R & string}_relation`
            : R & string
          columns: MultipleOnesTo<Relations, T, Target> extends true
            ? [R & string]
            : Optional extends true
              ? [NullableKeys<RowOf<Tables, T>>]
              : []
          isOneToOne: HasOneTo<Relations, Target, T>
          referencedRelation: SqlName<Tables, Target>
          referencedColumns: []
        }
      : never
    : never
}[keyof Relations[T & keyof Relations]]

/** `many` relations aimed at this table, where no `one` names the same pair. */
type ManyRelationships<Tables, Relations, T extends keyof Tables> = {
  [S in keyof Relations]: HasOneTo<Relations, T, S> extends true
    ? never
    : {
        [R in keyof Relations[S]]: Relations[S][R] extends Many<T & string>
          ? {
              foreignKeyName: R & string
              columns: []
              isOneToOne: false
              referencedRelation: SqlName<Tables, S>
              referencedColumns: []
            }
          : never
      }[keyof Relations[S]]
}[keyof Relations]

type Relationships<Tables, Relations, T extends keyof Tables> = UnionToTuple<
  | OneRelationships<Tables, Relations, T>
  | ManyRelationships<Tables, Relations, T>
>

/**
 * Types a postgrest-js `Database` from a drizzle schema: every table keyed by
 * its SQL name, with relationships from `defineRelations` when that is what
 * was passed.
 */
export type DrizzlePostgrest<
  Schema,
  Tables = TablesOf<Schema>,
  Relations = RelationsOf<Schema>
> = {
  public: {
    Tables: {
      [K in keyof Tables as SqlName<Tables, K>]: Tables[K] extends PgTable
        ? {
            Row: InferSelectModel<Tables[K]>
            Insert: InferInsertModel<Tables[K]>
            Update: Partial<InferInsertModel<Tables[K]>>
            Relationships: Relationships<Tables, Relations, K>
          }
        : never
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

/**
 * Deferred on `Schema` so a generic caller never instantiates the postgrest
 * client type with an open schema, which overflows its constraint check.
 */
export type DrizzlePostgrestClient<Schema> = Schema extends unknown
  ? PostgrestClient<DrizzlePostgrest<Schema>>
  : never

interface ForeignKey {
  name: string
  key: string
  column: string
  table: string
}

/** A drizzle relation as PostgREST needs it: the table it lands on, and the FK column on whichever side holds it. */
interface Relation {
  table: string
  column: string | undefined
}

interface Table {
  name: string
  toColumn: Record<string, string>
  toKey: Record<string, string>
  dates: Set<string>
  foreignKeys: ForeignKey[]
  relations: Record<string, Relation>
}

type Tables = Record<string, Table>

type Field = { key: string; date: boolean } | { key: string; shape: Shape }

/** How a response row maps back: listed fields by wire key, then the tables `*` may have pulled in. */
interface Shape {
  fields: Record<string, Field>
  tables: Table[]
}

interface State {
  tables: Tables
  table: Table | undefined
  shape: Shape
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
  "filter"
])

const AGGREGATES = new Set(["count", "sum", "avg", "min", "max"])

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const wire = (value: unknown): unknown =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(wire)
      : value

const revive = (date: boolean, value: unknown) =>
  date && typeof value === "string" ? new Date(value) : value

interface DrizzleRelation {
  relationType: "one" | "many"
  targetTableName: string
  sourceColumns?: Column[]
  targetColumns?: Column[]
}

const readTables = (
  schema: Record<string, unknown>,
  casing: Casing | undefined
): Tables => {
  const convert = getCasingFn(casing)
  const columnName = (column: Column) =>
    column.keyAsName ? convert(column.name) : column.name
  const tables: Tables = {}
  const bySchemaKey: Record<string, Table> = {}
  const relationsBySchemaKey: Record<
    string,
    Record<string, DrizzleRelation>
  > = {}

  for (const [schemaKey, value] of Object.entries(schema)) {
    const pgTable = is(value, PgTable)
      ? value
      : isRow(value) && is(value.table, PgTable)
        ? value.table
        : undefined
    if (!pgTable) continue
    if (isRow(value) && isRow(value.relations)) {
      relationsBySchemaKey[schemaKey] = value.relations as Record<
        string,
        DrizzleRelation
      >
    }
    const table: Table = {
      name: getTableName(pgTable),
      toColumn: {},
      toKey: {},
      dates: new Set(),
      foreignKeys: [],
      relations: {}
    }
    for (const [key, column] of Object.entries(getTableColumns(pgTable))) {
      const name = columnName(column)
      table.toColumn[key] = name
      table.toKey[name] = key
      if (column.dataType === "object date") table.dates.add(key)
    }
    for (const foreignKey of getTableConfig(pgTable).foreignKeys) {
      const { columns, foreignTable } = foreignKey.reference()
      const column = columns[0] ? columnName(columns[0]) : ""
      table.foreignKeys.push({
        name: foreignKey.getName(),
        key: table.toKey[column] ?? column,
        column,
        table: getTableName(foreignTable)
      })
    }
    tables[table.name] = table
    bySchemaKey[schemaKey] = table
  }

  for (const [schemaKey, relations] of Object.entries(relationsBySchemaKey)) {
    const table = bySchemaKey[schemaKey]
    if (!table) continue
    for (const [name, relation] of Object.entries(relations)) {
      const target = bySchemaKey[relation.targetTableName]
      if (!target) continue
      const holder =
        relation.relationType === "one"
          ? relation.sourceColumns?.[0]
          : relation.targetColumns?.[0]
      table.relations[name] = {
        table: target.name,
        column: holder && columnName(holder)
      }
    }
  }
  return tables
}

/** Splits on `separator` outside parentheses and double quotes. */
const splitTop = (input: string, separator: string) => {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === '"') quoted = !quoted
    else if (quoted) continue
    else if (char === "(") depth++
    else if (char === ")") depth--
    else if (char === separator && depth === 0) {
      parts.push(input.slice(start, index))
      start = index + 1
    }
  }
  parts.push(input.slice(start))
  return parts
}

const column = (table: Table | undefined, name: string) =>
  table?.toColumn[name] ?? name

/** A column, possibly followed by a JSON path: `data->>name`. */
const columnRef = (table: Table | undefined, ref: string) => {
  const arrow = ref.indexOf("->")
  return arrow === -1
    ? column(table, ref)
    : column(table, ref.slice(0, arrow)) + ref.slice(arrow)
}

/** The table an embed names, by table name, by the FK column or FK name on either side. */
const embedTarget = (
  tables: Tables,
  from: Table | undefined,
  name: string
): Table | undefined => {
  if (tables[name]) return tables[name]
  if (!from) return undefined
  const relation = from.relations[name]
  if (relation) return tables[relation.table]
  const own = from.foreignKeys.find(
    (fk) => fk.key === name || fk.column === name || fk.name === name
  )
  if (own) return tables[own.table]
  return Object.values(tables).find((table) =>
    table.foreignKeys.some((fk) => fk.table === from.name && fk.name === name)
  )
}

/**
 * What an embed goes out as. A relation name becomes the target table with the
 * FK column as its hint, so the response keeps the relation's name; an FK
 * column's key becomes the column's SQL name.
 */
const embedName = (from: Table | undefined, name: string) => {
  const relation = from?.relations[name]
  if (relation) {
    return relation.column
      ? `${relation.table}!${relation.column}`
      : relation.table
  }
  return from?.foreignKeys.find((fk) => fk.key === name)?.column ?? name
}

/** A hint names a relation on either side, or a column of the table holding the FK. */
const hint = (
  from: Table | undefined,
  target: Table | undefined,
  value: string
) =>
  from?.relations[value]?.column ??
  target?.relations[value]?.column ??
  from?.toColumn[value] ??
  target?.toColumn[value] ??
  value

/** Walks `embed.embed.column`, translating every hop. */
const columnPath = (tables: Tables, table: Table | undefined, path: string) => {
  const segments = splitTop(path, ".")
  const last = segments.pop() ?? ""
  let current = table
  const hops = segments.map((segment) => {
    const out = current?.relations[segment]
      ? segment
      : embedName(current, segment)
    current = embedTarget(tables, current, segment)
    return out
  })
  return [...hops, columnRef(current, last)].join(".")
}

/** Walks `embed.embed`, returning the translated path and the table it lands on. */
const embedPath = (tables: Tables, table: Table | undefined, path: string) => {
  let current = table
  const out = splitTop(path, ".").map((segment) => {
    const name = current?.relations[segment]
      ? segment
      : embedName(current, segment)
    current = embedTarget(tables, current, segment)
    return name
  })
  return { path: out.join("."), table: current }
}

const emptyShape = (table: Table | undefined): Shape => ({
  fields: {},
  tables: table ? [table] : []
})

/** Translates a select list and records how its rows come back. */
const parseSelect = (
  tables: Tables,
  table: Table | undefined,
  input: string
): { out: string; shape: Shape } => {
  const shape = emptyShape(table)
  const out = splitTop(input, ",").map((item) => {
    const open = item.indexOf("(")
    const close = item.lastIndexOf(")")
    let head = open === -1 ? item : item.slice(0, open)
    const children = open === -1 ? undefined : item.slice(open + 1, close)

    const spread = head.startsWith("...")
    if (spread) head = head.slice(3)
    const castAt = head.indexOf("::")
    const cast =
      castAt === -1
        ? open === -1
          ? ""
          : item.slice(close + 1)
        : head.slice(castAt)
    if (castAt !== -1) head = head.slice(0, castAt)
    const aliasAt = head.indexOf(":")
    const alias = aliasAt === -1 ? undefined : head.slice(0, aliasAt)
    const [ref = "", ...hints] = head.slice(aliasAt + 1).split("!")
    const prefix = `${spread ? "..." : ""}${alias === undefined ? "" : `${alias}:`}`

    if (ref === "*") return `${prefix}*${cast}`

    if (children === "" && ref === "count") {
      return `${prefix}count()${cast}`
    }

    const dot = ref.lastIndexOf(".")
    const aggregate = children === "" ? ref.slice(dot + 1) : ""
    if (children === "" && dot !== -1 && AGGREGATES.has(aggregate)) {
      const base = ref.slice(0, dot)
      const key = alias ?? aggregate
      shape.fields[key] = {
        key,
        date:
          !cast &&
          !base.includes("->") &&
          (aggregate === "min" || aggregate === "max") &&
          (table?.dates.has(base) ?? false)
      }
      return `${prefix}${columnRef(table, base)}.${aggregate}()${cast}`
    }

    if (children === undefined) {
      const arrow = ref.indexOf("->")
      const name = arrow === -1 ? ref : ref.slice(0, arrow)
      const wireKey =
        alias ??
        (arrow === -1 ? column(table, name) : (ref.split(/->>?/).pop() ?? ref))
      shape.fields[wireKey] = {
        key: alias ?? (arrow === -1 ? name : wireKey),
        date: !cast && arrow === -1 && (table?.dates.has(name) ?? false)
      }
      return `${prefix}${columnRef(table, ref)}${cast}`
    }

    const target = embedTarget(tables, table, ref)
    const nested = parseSelect(tables, target, children)
    const name = embedName(table, ref)
    const relation = table?.relations[ref]
    const label =
      alias ?? (relation && relation.table !== ref ? ref : undefined)
    if (spread) {
      Object.assign(shape.fields, nested.shape.fields)
      shape.tables.push(...nested.shape.tables)
    } else {
      const bang = name.indexOf("!")
      const wireKey = label ?? (bang === -1 ? name : name.slice(0, bang))
      shape.fields[wireKey] = { key: alias ?? ref, shape: nested.shape }
    }
    const suffix = hints
      .map((value) => `!${hint(table, target, value)}`)
      .join("")
    const start = `${spread ? "..." : ""}${label === undefined ? "" : `${label}:`}`
    return `${start}${name}${suffix}(${nested.out})`
  })
  return { out: out.join(","), shape }
}

/** Translates the column of every condition in an `or()` string, through `and()`/`or()`/`not.`. */
const logic = (table: Table | undefined, filters: string): string =>
  splitTop(filters, ",")
    .map((item) => {
      const negated = item.startsWith("not.")
      const body = negated ? item.slice(4) : item
      const open = body.indexOf("(")
      if (open !== -1 && (body.startsWith("and(") || body.startsWith("or("))) {
        const inner = body.slice(open + 1, body.lastIndexOf(")"))
        return `${negated ? "not." : ""}${body.slice(0, open)}(${logic(table, inner)})`
      }
      const dot = body.indexOf(".")
      if (dot === -1) return item
      return `${negated ? "not." : ""}${columnRef(table, body.slice(0, dot))}${body.slice(dot)}`
    })
    .join(",")

const toWire = (table: Table | undefined, values: unknown): unknown => {
  if (Array.isArray(values)) return values.map((row) => toWire(table, row))
  if (!isRow(values)) return values
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [column(table, key), value])
  )
}

const fromWire = (shape: Shape, data: unknown): unknown => {
  if (Array.isArray(data)) return data.map((row) => fromWire(shape, row))
  if (!isRow(data)) return data
  return Object.fromEntries(
    Object.entries(data).map(([name, value]) => {
      const field = shape.fields[name]
      if (field && "shape" in field)
        return [field.key, fromWire(field.shape, value)]
      if (field) return [field.key, revive(field.date, value)]
      for (const table of shape.tables) {
        const key = table.toKey[name]
        if (key) return [key, revive(table.dates.has(key), value)]
      }
      return [name, value]
    })
  )
}

const referenced = (
  state: State,
  options: unknown
): { options: unknown; table: Table | undefined } => {
  if (!isRow(options)) return { options, table: state.table }
  const name = options.referencedTable ?? options.foreignTable
  if (typeof name !== "string") return { options, table: state.table }
  const { path, table } = embedPath(state.tables, state.table, name)
  const { foreignTable: _, ...rest } = options
  return { options: { ...rest, referencedTable: path }, table }
}

const rewrite = (
  state: State,
  method: string,
  args: unknown[]
): { args: unknown[]; state: State } => {
  const { tables, table } = state
  if (method === "select") {
    const input = typeof args[0] === "string" ? args[0] : "*"
    const { out, shape } = parseSelect(tables, table, input.replace(/\s+/g, ""))
    return { args: [out, ...args.slice(1)], state: { ...state, shape } }
  }
  if (method === "insert" || method === "update" || method === "upsert") {
    const [values, options] = args
    const onConflict =
      isRow(options) && typeof options.onConflict === "string"
        ? {
            ...options,
            onConflict: splitTop(options.onConflict, ",")
              .map((name) => column(table, name))
              .join(",")
          }
        : options
    return {
      args: [toWire(table, values), onConflict, ...args.slice(2)],
      state
    }
  }
  if (method === "match" && isRow(args[0])) {
    const query = Object.fromEntries(
      Object.entries(args[0]).map(([key, value]) => [
        columnPath(tables, table, key),
        wire(value)
      ])
    )
    return { args: [query, ...args.slice(1)], state }
  }
  if (method === "or" && typeof args[0] === "string") {
    const scope = referenced(state, args[1])
    return { args: [logic(scope.table, args[0]), scope.options], state }
  }
  if (method === "order" && typeof args[0] === "string") {
    const scope = referenced(state, args[1])
    return {
      args: [columnPath(tables, scope.table, args[0]), scope.options],
      state
    }
  }
  if (method === "limit" || method === "range") {
    const at = method === "limit" ? 1 : 2
    if (args[at] === undefined) return { args, state }
    return {
      args: [...args.slice(0, at), referenced(state, args[at]).options],
      state
    }
  }
  if (COLUMN_FIRST.has(method) && typeof args[0] === "string") {
    const valueAt = method === "filter" || method === "not" ? 2 : 1
    const rewritten = [...args]
    rewritten[0] = columnPath(tables, table, args[0])
    rewritten[valueAt] = wire(args[valueAt])
    return { args: rewritten, state }
  }
  return { args, state }
}

const wrap = <Builder extends object>(builder: Builder, state: State) =>
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
              data: fromWire(state.shape, response.data)
            }))
            .then(onFulfilled, onRejected)
      }
      const value = Reflect.get(target, property, target)
      if (typeof value !== "function" || typeof property !== "string") {
        return value
      }
      return (...args: unknown[]) => {
        const next = rewrite(state, property, args)
        const result = value.apply(target, next.args)
        return result instanceof PostgrestBuilder ||
          result instanceof PostgrestQueryBuilder
          ? wrap(result, next.state)
          : result
      }
    }
  })

/**
 * Types a postgrest-js client against a drizzle schema, and makes the wire
 * match: TypeScript keys go out as SQL column names and come back as keys,
 * and date columns come back as Dates — through embedded resources at any
 * depth, spreads, aliases, hints, JSON paths, aggregates, `or()` strings, and
 * `referencedTable` options. Embeds resolve by table name, by foreign key, or
 * by relation name when given what `defineRelations` returns, which also types
 * them. `casing` applies to columns declared without a name, as drizzle does.
 * Not translated: `rpc()`.
 */
export function createDrizzlePostgrest<Schema extends Record<string, unknown>>(
  schema: Schema,
  postgrestClient: PostgrestClient,
  options: { casing?: Casing } = {}
): DrizzlePostgrestClient<Schema> {
  const tables = readTables(schema, options.casing)

  const wrapClient = (client: PostgrestClient): PostgrestClient =>
    new Proxy(client, {
      get(target, property) {
        if (property === "from") {
          return (relation: string) => {
            const table = tables[relation]
            return wrap(target.from(relation), {
              tables,
              table,
              shape: emptyShape(table)
            })
          }
        }
        if (property === "schema") {
          return (name: string) =>
            wrapClient(target.schema(name) as PostgrestClient)
        }
        return Reflect.get(target, property, target)
      }
    })

  return wrapClient(
    postgrestClient
  ) as unknown as DrizzlePostgrestClient<Schema>
}
