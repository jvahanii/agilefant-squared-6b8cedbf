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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      backlog_statuses: {
        Row: {
          backlog_id: string
          color: string
          created_at: string
          id: string
          key: string
          label: string
          rank: number
          updated_at: string
        }
        Insert: {
          backlog_id: string
          color?: string
          created_at?: string
          id?: string
          key: string
          label: string
          rank?: number
          updated_at?: string
        }
        Update: {
          backlog_id?: string
          color?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          rank?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "backlog_statuses_backlog_id_fkey"
            columns: ["backlog_id"]
            isOneToOne: false
            referencedRelation: "backlogs"
            referencedColumns: ["id"]
          },
        ]
      }
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
          points_enabled: boolean | null
          rank: number
        }
        Insert: {
          id: string
          name: string
          organization_id?: string | null
          points_enabled?: boolean | null
          rank?: number
        }
        Update: {
          id?: string
          name?: string
          organization_id?: string | null
          points_enabled?: boolean | null
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
          view_mode: string
        }
        Insert: {
          id: string
          name: string
          organization_id?: string | null
          parent_id?: string | null
          rank?: number
          tree_id: string
          view_mode?: string
        }
        Update: {
          id?: string
          name?: string
          organization_id?: string | null
          parent_id?: string | null
          rank?: number
          tree_id?: string
          view_mode?: string
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
      gmail_connections: {
        Row: {
          connected_email: string | null
          connection_key_encrypted: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_email?: string | null
          connection_key_encrypted: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_email?: string | null
          connection_key_encrypted?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_import_queries: {
        Row: {
          backlog_id: string
          created_at: string
          frequency: string
          id: string
          last_run_at: string | null
          last_run_status: string | null
          name: string | null
          organization_id: string
          query: string
          schedule_enabled: boolean
          tree_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          backlog_id: string
          created_at?: string
          frequency?: string
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string | null
          organization_id: string
          query: string
          schedule_enabled?: boolean
          tree_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          backlog_id?: string
          created_at?: string
          frequency?: string
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string | null
          organization_id?: string
          query?: string
          schedule_enabled?: boolean
          tree_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_import_queries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gmail_import_queries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_imported_links: {
        Row: {
          created_at: string
          gmail_message_id: string
          id: string
          normalized_url: string
          organization_id: string
          query_id: string | null
          work_item_id: string | null
        }
        Insert: {
          created_at?: string
          gmail_message_id: string
          id?: string
          normalized_url: string
          organization_id: string
          query_id?: string | null
          work_item_id?: string | null
        }
        Update: {
          created_at?: string
          gmail_message_id?: string
          id?: string
          normalized_url?: string
          organization_id?: string
          query_id?: string | null
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gmail_imported_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gmail_imported_links_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "gmail_import_queries"
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
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          burnups_enabled: boolean
          created_at: string
          custom_statuses_enabled: boolean
          id: string
          labels_enabled: boolean
          organization_id: string
          persist_notifications_enabled: boolean
          points_enabled: boolean
          savings_income_enabled: boolean
          time_logging_enabled: boolean
          updated_at: string
        }
        Insert: {
          boards_enabled?: boolean
          burnups_enabled?: boolean
          created_at?: string
          custom_statuses_enabled?: boolean
          id?: string
          labels_enabled?: boolean
          organization_id: string
          persist_notifications_enabled?: boolean
          points_enabled?: boolean
          savings_income_enabled?: boolean
          time_logging_enabled?: boolean
          updated_at?: string
        }
        Update: {
          boards_enabled?: boolean
          burnups_enabled?: boolean
          created_at?: string
          custom_statuses_enabled?: boolean
          id?: string
          labels_enabled?: boolean
          organization_id?: string
          persist_notifications_enabled?: boolean
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
          clerk_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_superuser: boolean
        }
        Insert: {
          avatar_url?: string | null
          clerk_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_superuser?: boolean
        }
        Update: {
          avatar_url?: string | null
          clerk_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_superuser?: boolean
        }
        Relationships: []
      }
      published_link_settings: {
        Row: {
          backlog_id: string | null
          hidden_attributes: string[]
          id: string
          tree_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          backlog_id?: string | null
          hidden_attributes?: string[]
          id?: string
          tree_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          backlog_id?: string | null
          hidden_attributes?: string[]
          id?: string
          tree_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "published_link_settings_backlog_id_fkey"
            columns: ["backlog_id"]
            isOneToOne: false
            referencedRelation: "backlogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_link_settings_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "backlog_trees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_link_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      published_links: {
        Row: {
          backlog_id: string | null
          created_at: string
          created_by: string | null
          organization_id: string
          token: string
          tree_id: string
        }
        Insert: {
          backlog_id?: string | null
          created_at?: string
          created_by?: string | null
          organization_id: string
          token: string
          tree_id: string
        }
        Update: {
          backlog_id?: string | null
          created_at?: string
          created_by?: string | null
          organization_id?: string
          token?: string
          tree_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "published_links_backlog_id_fkey"
            columns: ["backlog_id"]
            isOneToOne: false
            referencedRelation: "backlogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_links_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "backlog_trees"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          tree_id: string | null
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
          tree_id?: string | null
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
          tree_id?: string | null
          user_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "backlog_trees"
            referencedColumns: ["id"]
          },
        ]
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
      whatsapp_integrations: {
        Row: {
          backlog_id: string
          chat_id: string | null
          created_at: string
          enabled: boolean
          id: string
          label: string
          min_fragment_length: number
          organization_id: string
          split_delimiters: string
          split_on_newline: boolean
          split_on_space: boolean
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
          min_fragment_length?: number
          organization_id: string
          split_delimiters?: string
          split_on_newline?: boolean
          split_on_space?: boolean
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
          min_fragment_length?: number
          organization_id?: string
          split_delimiters?: string
          split_on_newline?: boolean
          split_on_space?: boolean
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
      work_item_board_ranks: {
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
      work_item_chart_prefs: {
        Row: {
          created_at: string
          id: string
          metric: string
          organization_id: string
          scope_id: string
          scope_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          organization_id: string
          scope_id: string
          scope_kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          organization_id?: string
          scope_id?: string
          scope_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_chart_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      work_item_history: {
        Row: {
          backlog_assignments: Json
          event: string
          existed: boolean
          id: string
          organization_id: string
          parent_id: string | null
          points: number | null
          snapshot_at: string
          status: string | null
          title: string | null
          work_item_id: string
        }
        Insert: {
          backlog_assignments?: Json
          event: string
          existed: boolean
          id?: string
          organization_id: string
          parent_id?: string | null
          points?: number | null
          snapshot_at?: string
          status?: string | null
          title?: string | null
          work_item_id: string
        }
        Update: {
          backlog_assignments?: Json
          event?: string
          existed?: boolean
          id?: string
          organization_id?: string
          parent_id?: string | null
          points?: number | null
          snapshot_at?: string
          status?: string | null
          title?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      build_organization_snapshot: { Args: { _org_id: string }; Returns: Json }
      bulk_delete_work_items: { Args: { _ids: string[] }; Returns: number }
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
      current_user_id: { Args: never; Returns: string }
      get_published_backlog: { Args: { _token: string }; Returns: Json }
      get_published_link_options: {
        Args: { _backlog_id: string; _tree_id: string }
        Returns: Json
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
      get_work_item_ranks: { Args: { _org_ids: string[] }; Returns: Json }
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
      link_clerk_identity: { Args: never; Returns: string }
      lookup_org_by_slug: {
        Args: { _slug: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      move_time_entries: {
        Args: { _entry_ids: string[]; _target_id: string; _target_kind: string }
        Returns: number
      }
      publish_backlog_link: {
        Args: { _backlog_id?: string; _tree_id: string }
        Returns: string
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
      set_published_link_hidden_attributes: {
        Args: { _backlog_id: string; _hidden: string[]; _tree_id: string }
        Returns: string[]
      }
      superuser_user_overview: {
        Args: never
        Returns: {
          clerk_linked: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          is_superuser: boolean
          last_activity: string
          organizations: number
          time_entries: number
        }[]
      }
      unpublish_backlog_link: {
        Args: { _backlog_id?: string; _tree_id: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["owner", "admin", "member"],
    },
  },
} as const
