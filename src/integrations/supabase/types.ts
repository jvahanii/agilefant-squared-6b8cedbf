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
      github_repo_integrations: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          organization_id: string
          repo_full_name: string
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id: string
          repo_full_name: string
          updated_at?: string
          webhook_secret: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id?: string
          repo_full_name?: string
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      github_repo_targets: {
        Row: {
          backlog_id: string
          created_at: string
          id: string
          integration_id: string
          organization_id: string
          tree_id: string
        }
        Insert: {
          backlog_id: string
          created_at?: string
          id?: string
          integration_id: string
          organization_id: string
          tree_id: string
        }
        Update: {
          backlog_id?: string
          created_at?: string
          id?: string
          integration_id?: string
          organization_id?: string
          tree_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_repo_targets_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "github_repo_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      label_assignments: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          label_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          label_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          label_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      organization_backups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          organization_id: string
          size_bytes: number
          snapshot: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          organization_id: string
          size_bytes?: number
          snapshot: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          organization_id?: string
          size_bytes?: number
          snapshot?: Json
        }
        Relationships: []
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
      organization_settings: {
        Row: {
          boards_enabled: boolean
          created_at: string
          custom_statuses_enabled: boolean
          id: string
          labels_enabled: boolean
          organization_id: string
          points_enabled: boolean
          savings_income_enabled: boolean
          time_logging_enabled: boolean
          updated_at: string
        }
        Insert: {
          boards_enabled?: boolean
          created_at?: string
          custom_statuses_enabled?: boolean
          id?: string
          labels_enabled?: boolean
          organization_id: string
          points_enabled?: boolean
          savings_income_enabled?: boolean
          time_logging_enabled?: boolean
          updated_at?: string
        }
        Update: {
          boards_enabled?: boolean
          created_at?: string
          custom_statuses_enabled?: boolean
          id?: string
          labels_enabled?: boolean
          organization_id?: string
          points_enabled?: boolean
          savings_income_enabled?: boolean
          time_logging_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
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
      time_entries: {
        Row: {
          backlog_id: string | null
          created_at: string
          duration_minutes: number
          id: string
          note: string | null
          organization_id: string
          spent_date: string
          user_id: string
          work_item_id: string | null
        }
        Insert: {
          backlog_id?: string | null
          created_at?: string
          duration_minutes: number
          id?: string
          note?: string | null
          organization_id: string
          spent_date?: string
          user_id: string
          work_item_id?: string | null
        }
        Update: {
          backlog_id?: string | null
          created_at?: string
          duration_minutes?: number
          id?: string
          note?: string | null
          organization_id?: string
          spent_date?: string
          user_id?: string
          work_item_id?: string | null
        }
        Relationships: []
      }
      tree_financial_targets: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          metric: string
          organization_id: string
          tree_id: string
          updated_at: string
          year: number
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metric?: string
          organization_id: string
          tree_id: string
          updated_at?: string
          year: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metric?: string
          organization_id?: string
          tree_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "tree_financial_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tree_financial_targets_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "backlog_trees"
            referencedColumns: ["id"]
          },
        ]
      }
      tree_statuses: {
        Row: {
          color: string
          created_at: string
          id: string
          key: string
          label: string
          rank: number
          tree_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          key: string
          label: string
          rank?: number
          tree_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          rank?: number
          tree_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_integrations: {
        Row: {
          backlog_id: string
          chat_id: string | null
          created_at: string
          enabled: boolean
          id: string
          label: string
          organization_id: string
          tree_id: string
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          backlog_id: string
          chat_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          organization_id: string
          tree_id: string
          updated_at?: string
          webhook_secret: string
        }
        Update: {
          backlog_id?: string
          chat_id?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          organization_id?: string
          tree_id?: string
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: []
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
      work_item_financials: {
        Row: {
          actual_income_by_month: Json
          actual_savings_by_month: Json
          created_at: string
          currency: string
          id: string
          income_by_month: Json
          monthly_income: number
          monthly_savings: number
          organization_id: string
          savings_by_month: Json
          updated_at: string
          work_item_id: string
        }
        Insert: {
          actual_income_by_month?: Json
          actual_savings_by_month?: Json
          created_at?: string
          currency?: string
          id?: string
          income_by_month?: Json
          monthly_income?: number
          monthly_savings?: number
          organization_id: string
          savings_by_month?: Json
          updated_at?: string
          work_item_id: string
        }
        Update: {
          actual_income_by_month?: Json
          actual_savings_by_month?: Json
          created_at?: string
          currency?: string
          id?: string
          income_by_month?: Json
          monthly_income?: number
          monthly_savings?: number
          organization_id?: string
          savings_by_month?: Json
          updated_at?: string
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
      work_item_snoozes: {
        Row: {
          created_at: string
          id: string
          note: string | null
          organization_id: string
          snoozed_until: string
          updated_at: string
          user_id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          snoozed_until: string
          updated_at?: string
          user_id: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          snoozed_until?: string
          updated_at?: string
          user_id?: string
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
          parent_id_overrides: Json
          points: number | null
          rank: number
          respawn_enabled: boolean
          respawn_hour: number | null
          respawn_interval_days: number | null
          respawn_last_triggered_at: string | null
          respawn_minute: number | null
          status: string
          title: string
        }
        Insert: {
          backlog_assignments?: Json
          description?: string | null
          id: string
          organization_id?: string | null
          parent_id?: string | null
          parent_id_overrides?: Json
          points?: number | null
          rank?: number
          respawn_enabled?: boolean
          respawn_hour?: number | null
          respawn_interval_days?: number | null
          respawn_last_triggered_at?: string | null
          respawn_minute?: number | null
          status?: string
          title: string
        }
        Update: {
          backlog_assignments?: Json
          description?: string | null
          id?: string
          organization_id?: string | null
          parent_id?: string | null
          parent_id_overrides?: Json
          points?: number | null
          rank?: number
          respawn_enabled?: boolean
          respawn_hour?: number | null
          respawn_interval_days?: number | null
          respawn_last_triggered_at?: string | null
          respawn_minute?: number | null
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
      youtube_channels: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          organization_id: string
          rank: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          organization_id: string
          rank?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          organization_id?: string
          rank?: number
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "youtube_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_search_channels: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          keywords: string
          name: string
          organization_id: string
          rank: number
          search_order: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          keywords: string
          name: string
          organization_id: string
          rank?: number
          search_order?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          keywords?: string
          name?: string
          organization_id?: string
          rank?: number
          search_order?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "youtube_search_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_video_links: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          organization_id: string
          rank: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          organization_id: string
          rank?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          organization_id?: string
          rank?: number
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "youtube_video_links_organization_id_fkey"
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
      build_organization_snapshot: { Args: { _org_id: string }; Returns: Json }
      can_view_org_labels: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      cleanup_orphaned_users: {
        Args: { p_user_ids: string[] }
        Returns: undefined
      }
      create_organization_backup: {
        Args: { _kind?: string; _note?: string; _org_id: string }
        Returns: string
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
      has_shared_tree_with_org: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_label_entity_accessible: {
        Args: { _entity_id: string; _entity_type: string; _user_id: string }
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
      rename_work_items_org_prefix: {
        Args: { _item_ids: string[]; _new_org_id: string }
        Returns: Json
      }
      restore_organization_backup: {
        Args: { _backup_id: string; _mode?: string; _scope?: Json }
        Returns: Json
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
