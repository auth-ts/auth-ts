import { type AuthWhere, defineAuthDatabase } from "@auth-ts/core"
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const operators: Record<string, string> = { eq: "=", lt: "<", gt: ">" }

function buildWhere(where: AuthWhere, params: unknown[]) {
  const clauses = Object.entries(where).flatMap(([column, condition]) =>
    Object.entries(condition).map(([operator, value]) => {
      params.push(value)
      return `"${column}" ${operators[operator]} $${params.length}`
    })
  )

  return clauses.join(" and ") || "true"
}

export const authDatabase = defineAuthDatabase({
  async select({ table, where, limit, orderBy }) {
    const params: unknown[] = []
    const order = Object.entries(orderBy)
      .map(([column, direction]) => `"${column}" ${direction}`)
      .join(", ")
    const { rows } = await pool.query(
      `select * from "${table}" where ${buildWhere(where, params)} order by ${order} limit ${limit}`,
      params
    )
    return rows
  },

  async insert({ table, values }) {
    const columns = Object.keys(values).map((column) => `"${column}"`)
    const placeholders = columns.map((_, index) => `$${index + 1}`)
    const { rows } = await pool.query(
      `insert into "${table}" (${columns.join(", ")}) values (${placeholders.join(", ")}) returning *`,
      Object.values(values)
    )
    return rows[0]
  },

  async update({ table, where, values }) {
    const params = Object.values(values)
    const set = Object.keys(values)
      .map((column, index) => `"${column}" = $${index + 1}`)
      .join(", ")
    const { rows } = await pool.query(
      `update "${table}" set ${set} where ${buildWhere(where, params)} returning *`,
      params
    )
    return rows
  },

  async delete({ table, where }) {
    const params: unknown[] = []
    const { rows } = await pool.query(
      `delete from "${table}" where ${buildWhere(where, params)} returning *`,
      params
    )
    return rows
  }
})
