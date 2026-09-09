export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      attempts: {
        Row: {
          createdAt: string
          expiresAt: string
          id: string
          key: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          expiresAt: string
          id?: string
          key: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          expiresAt?: string
          id?: string
          key?: string
          updatedAt?: string
        }
        Relationships: []
      }
      identities: {
        Row: {
          createdAt: string
          id: string
          label: string | null
          provider: string
          providerUserId: string
          scope: string | null
          updatedAt: string
          userId: string
        }
        Insert: {
          createdAt?: string
          id?: string
          label?: string | null
          provider: string
          providerUserId: string
          scope?: string | null
          updatedAt?: string
          userId: string
        }
        Update: {
          createdAt?: string
          id?: string
          label?: string | null
          provider?: string
          providerUserId?: string
          scope?: string | null
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "identities_userId_users_id_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      identitySecrets: {
        Row: {
          accessTokenEncrypted: string | null
          accessTokenExpiresAt: string | null
          createdAt: string
          id: string
          identityId: string
          refreshTokenEncrypted: string | null
          refreshTokenExpiresAt: string | null
          updatedAt: string
        }
        Insert: {
          accessTokenEncrypted?: string | null
          accessTokenExpiresAt?: string | null
          createdAt?: string
          id?: string
          identityId: string
          refreshTokenEncrypted?: string | null
          refreshTokenExpiresAt?: string | null
          updatedAt?: string
        }
        Update: {
          accessTokenEncrypted?: string | null
          accessTokenExpiresAt?: string | null
          createdAt?: string
          id?: string
          identityId?: string
          refreshTokenEncrypted?: string | null
          refreshTokenExpiresAt?: string | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "identitySecrets_identityId_identities_id_fkey"
            columns: ["identityId"]
            isOneToOne: false
            referencedRelation: "identities"
            referencedColumns: ["id"]
          }
        ]
      }
      sessions: {
        Row: {
          amr: string[] | null
          createdAt: string
          expiresAt: string
          id: string
          ipAddress: string | null
          tokenHash: string
          updatedAt: string
          userAgent: string | null
          userId: string
        }
        Insert: {
          amr?: string[] | null
          createdAt?: string
          expiresAt: string
          id?: string
          ipAddress?: string | null
          tokenHash: string
          updatedAt?: string
          userAgent?: string | null
          userId: string
        }
        Update: {
          amr?: string[] | null
          createdAt?: string
          expiresAt?: string
          id?: string
          ipAddress?: string | null
          tokenHash?: string
          updatedAt?: string
          userAgent?: string | null
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_userId_users_id_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      todos: {
        Row: {
          completed: boolean
          createdAt: string
          id: string
          title: string
          updatedAt: string
          userId: string
        }
        Insert: {
          completed?: boolean
          createdAt?: string
          id?: string
          title: string
          updatedAt?: string
          userId?: string
        }
        Update: {
          completed?: boolean
          createdAt?: string
          id?: string
          title?: string
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "todos_userId_users_id_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      users: {
        Row: {
          createdAt: string
          email: string | null
          id: string
          image: string | null
          name: string | null
          phoneNumber: string | null
          primaryUserId: string | null
          type: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          email?: string | null
          id?: string
          image?: string | null
          name?: string | null
          phoneNumber?: string | null
          primaryUserId?: string | null
          type?: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          email?: string | null
          id?: string
          image?: string | null
          name?: string | null
          phoneNumber?: string | null
          primaryUserId?: string | null
          type?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_primaryUserId_users_id_fkey"
            columns: ["primaryUserId"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      verifications: {
        Row: {
          codeHash: string
          createdAt: string
          expiresAt: string
          id: string
          identifier: string
          purpose: string
          updatedAt: string
        }
        Insert: {
          codeHash: string
          createdAt?: string
          expiresAt: string
          id?: string
          identifier: string
          purpose?: string
          updatedAt?: string
        }
        Update: {
          codeHash?: string
          createdAt?: string
          expiresAt?: string
          id?: string
          identifier?: string
          purpose?: string
          updatedAt?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {}
  }
} as const
