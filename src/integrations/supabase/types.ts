export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      backlog_tree_shares: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          tree_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          tree_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          tree_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlog_tree_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backlog_trees: {
        Row: {
          id: string
          name: string
          organization_id: string | null
          rank: number
        }
        Insert: {
          id: string
          name: string
          organization_id?: string | null
          rank?: number
        }
        Update: {
          id?: string
          name?: string
          organization_id?: string | null
          rank?: number
        }
        Relationships: [
          {
            foreignKeyName: "backlog_trees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backlogs: {
        Row: {
          id: string
          name: string
          organization_id: string | null
          parent_id: string | null
          rank: number
          tree_id: string
        }
        Insert: {
          id: string
          name: string
          organization_id?: string | null
          parent_id?: string | null
          rank?: number
          tree_id: string
        }
        Update: {
          id?: string
          name?: string
          organization_id?: string | null
          parent_id?: string | null
          rank?: number
          tree_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlogs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlogs_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "backlogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backlogs_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "backlog_trees"
            referencedColumns: ["id"]
          },
        ]
      }
      change_log: {
        Row: {
          action: string
          created_at: string
          details: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          organization_id: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          organization_id: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          organization_id?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          token: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          stripe_customer_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          stripe_customer_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_superuser: boolean
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_superuser?: boolean
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_superuser?: boolean
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_backlog_ranks: {
        Row: {
          backlog_id: string
          created_at: string
          id: string
          organization_id: string
          rank: number
          work_item_id: string
        }
        Insert: {
          backlog_id: string
          created_at?: string
          id?: string
          organization_id: string
          rank?: number
          work_item_id: string
        }
        Update: {
          backlog_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          rank?: number
          work_item_id?: string
        }
        Relationships: []
      }
      work_item_hyperlinks: {
        Row: {
          alt_text: string
          created_at: string
          id: string
          organization_id: string
          rank: number
          url: string
          work_item_id: string
        }
        Insert: {
          alt_text?: string
          created_at?: string
          id?: string
          organization_id: string
          rank?: number
          url: string
          work_item_id: string
        }
        Update: {
          alt_text?: string
          created_at?: string
          id?: string
          organization_id?: string
          rank?: number
          url?: string
          work_item_id?: string
        }
        Relationships: []
      }
      work_item_team_assignments: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          team_id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          team_id: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          team_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_team_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_team_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          backlog_assignments: Json
          description: string | null
          id: string
          organization_id: string | null
          parent_id: string | null
          points: number | null
          rank: number
          respawn_enabled: boolean
          respawn_hour: number | null
          respawn_interval_days: number | null
          respawn_last_triggered_at: string | null
          status: string
          title: string
        }
        Insert: {
          backlog_assignments?: Json
          description?: string | null
          id: string
          organization_id?: string | null
          parent_id?: string | null
          points?: number | null
          rank?: number
          respawn_enabled?: boolean
          respawn_hour?: number | null
          respawn_interval_days?: number | null
          respawn_last_triggered_at?: string | null
          status?: string
          title: string
        }
        Update: {
          backlog_assignments?: Json
          description?: string | null
          id?: string
          organization_id?: string | null
          parent_id?: string | null
          points?: number | null
          rank?: number
          respawn_enabled?: boolean
          respawn_hour?: number | null
          respawn_interval_days?: number | null
          respawn_last_triggered_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_orphaned_users: {
        Args: { p_user_ids: string[] }
        Returns: undefined
      }
      create_organization_with_owner: {
        Args: { _name: string; _slug: string; _user_id: string }
        Returns: string
      }
      get_tree_sharing_info: {
        Args: { _exclude_org_id: string; _tree_id: string }
        Returns: {
          is_owner: boolean
          org_id: string
          org_name: string
        }[]
      }
      get_user_memberships: {
        Args: { _user_id: string }
        Returns: {
          organization_id: string
          organization_name: string
          organization_slug: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      has_accessible_tree_assignment: {
        Args: { _assignments: Json; _user_id: string }
        Returns: boolean
      }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_member_of: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_superuser: { Args: { _user_id: string }; Returns: boolean }
      is_tree_accessible: {
        Args: { _tree_id: string; _user_id: string }
        Returns: boolean
      }
      is_tree_admin: {
        Args: { _tree_id: string; _user_id: string }
        Returns: boolean
      }
      is_tree_owner_member: {
        Args: { _tree_id: string; _user_id: string }
        Returns: boolean
      }
      is_tree_shared_with_user: {
        Args: { _tree_id: string; _user_id: string }
        Returns: boolean
      }
      is_work_item_accessible: {
        Args: { _user_id: string; _work_item_id: string }
        Returns: boolean
      }
      get_org_names_by_ids: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          name: string
        }[]
      }
      lookup_org_by_slug: {
        Args: { _slug: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      redeem_invite: { Args: { _token: string }; Returns: Json }
      remove_tree_share_with_copy: {
        Args: { _share_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "member"
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
    : never = never,
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
    : never = never,
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
    : never = never,
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
    : never = never,
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "member"],
    },
  },
} as const
