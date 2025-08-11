export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instanciate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      account_comments: {
        Row: {
          assignment_id: string
          comment_text: string
          created_at: string
          id: string
          trial_balance_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assignment_id: string
          comment_text: string
          created_at?: string
          id?: string
          trial_balance_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assignment_id?: string
          comment_text?: string
          created_at?: string
          id?: string
          trial_balance_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      account_evidence: {
        Row: {
          account_group_id: string | null
          created_at: string
          description: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          trial_balance_id: string
          updated_at: string
          upload_date: string
          user_id: string
        }
        Insert: {
          account_group_id?: string | null
          created_at?: string
          description?: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id?: string
          trial_balance_id: string
          updated_at?: string
          upload_date?: string
          user_id: string
        }
        Update: {
          account_group_id?: string | null
          created_at?: string
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          trial_balance_id?: string
          updated_at?: string
          upload_date?: string
          user_id?: string
        }
        Relationships: []
      }
      account_group_assignments: {
        Row: {
          account_group_id: string
          account_name: string
          account_number: string
          confidence_score: number | null
          created_at: string
          current_year_balance: number
          foreign_currency_balance: number | null
          id: string
          match_status: string | null
          matched_documents: string[] | null
          previous_year_balance: number
        }
        Insert: {
          account_group_id: string
          account_name: string
          account_number: string
          confidence_score?: number | null
          created_at?: string
          current_year_balance?: number
          foreign_currency_balance?: number | null
          id?: string
          match_status?: string | null
          matched_documents?: string[] | null
          previous_year_balance?: number
        }
        Update: {
          account_group_id?: string
          account_name?: string
          account_number?: string
          confidence_score?: number | null
          created_at?: string
          current_year_balance?: number
          foreign_currency_balance?: number | null
          id?: string
          match_status?: string | null
          matched_documents?: string[] | null
          previous_year_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_group_assignments_account_group_id_fkey"
            columns: ["account_group_id"]
            isOneToOne: false
            referencedRelation: "account_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      account_groups: {
        Row: {
          assigned_member_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          status: string | null
          trial_balance_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_member_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: string | null
          trial_balance_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_member_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: string | null
          trial_balance_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_groups_assigned_member_id_fkey"
            columns: ["assigned_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_groups_trial_balance_id_fkey"
            columns: ["trial_balance_id"]
            isOneToOne: false
            referencedRelation: "trial_balances"
            referencedColumns: ["id"]
          },
        ]
      }
      document_analysis: {
        Row: {
          analysis_status: string
          created_at: string
          document_id: string
          extracted_numbers: Json
          id: string
          matched_accounts: Json
          trial_balance_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_status?: string
          created_at?: string
          document_id: string
          extracted_numbers?: Json
          id?: string
          matched_accounts?: Json
          trial_balance_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_status?: string
          created_at?: string
          document_id?: string
          extracted_numbers?: Json
          id?: string
          matched_accounts?: Json
          trial_balance_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_analysis_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "account_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_analysis_trial_balance_id_fkey"
            columns: ["trial_balance_id"]
            isOneToOne: false
            referencedRelation: "trial_balances"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_annotations: {
        Row: {
          annotation_type: string
          assignment_id: string
          color: string | null
          content: string | null
          coordinates: Json
          created_at: string
          document_id: string
          id: string
          page_number: number
          trial_balance_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          annotation_type?: string
          assignment_id: string
          color?: string | null
          content?: string | null
          coordinates: Json
          created_at?: string
          document_id: string
          id?: string
          page_number: number
          trial_balance_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          annotation_type?: string
          assignment_id?: string
          color?: string | null
          content?: string | null
          coordinates?: Json
          created_at?: string
          document_id?: string
          id?: string
          page_number?: number
          trial_balance_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      temp_account_matches: {
        Row: {
          account_name: string
          account_number: string
          assigned_member_id: string | null
          confidence_score: number | null
          created_at: string
          current_year_balance: number | null
          id: string
          match_status: string | null
          matched_documents: string[] | null
          previous_year_balance: number | null
          trial_balance_id: string
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number: string
          assigned_member_id?: string | null
          confidence_score?: number | null
          created_at?: string
          current_year_balance?: number | null
          id?: string
          match_status?: string | null
          matched_documents?: string[] | null
          previous_year_balance?: number | null
          trial_balance_id: string
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          assigned_member_id?: string | null
          confidence_score?: number | null
          created_at?: string
          current_year_balance?: number | null
          id?: string
          match_status?: string | null
          matched_documents?: string[] | null
          previous_year_balance?: number | null
          trial_balance_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "temp_account_matches_assigned_member_id_fkey"
            columns: ["assigned_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_balances: {
        Row: {
          account_name_column: string | null
          account_number_column: string | null
          created_at: string
          current_year_column: string | null
          file_path: string
          file_size: number | null
          filename: string
          foreign_currency_column: string | null
          id: string
          previous_year_column: string | null
          status: string | null
          updated_at: string
          upload_date: string
          user_id: string
        }
        Insert: {
          account_name_column?: string | null
          account_number_column?: string | null
          created_at?: string
          current_year_column?: string | null
          file_path: string
          file_size?: number | null
          filename: string
          foreign_currency_column?: string | null
          id?: string
          previous_year_column?: string | null
          status?: string | null
          updated_at?: string
          upload_date?: string
          user_id: string
        }
        Update: {
          account_name_column?: string | null
          account_number_column?: string | null
          created_at?: string
          current_year_column?: string | null
          file_path?: string
          file_size?: number | null
          filename?: string
          foreign_currency_column?: string | null
          id?: string
          previous_year_column?: string | null
          status?: string | null
          updated_at?: string
          upload_date?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_match_documents_function: {
        Args: { trial_balance_id_param: string }
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
    Enums: {},
  },
} as const
