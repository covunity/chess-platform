// Generated from migrations 001-043. Regenerate with: npm run db:types (requires running Supabase).

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
      account_applications: {
        Row: {
          created_at: string
          experience: string
          id: string
          metadata: Json
          motivation: string
          rejection_reason: string | null
          requested_tier_code: string
          reviewed_at: string | null
          reviewed_by: string | null
          sample_url: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          experience: string
          id?: string
          metadata?: Json
          motivation: string
          rejection_reason?: string | null
          requested_tier_code?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_url?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          experience?: string
          id?: string
          metadata?: Json
          motivation?: string
          rejection_reason?: string | null
          requested_tier_code?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_url?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "account_applications_requested_tier_code_fkey"; columns: ["requested_tier_code"]; referencedRelation: "account_tiers"; referencedColumns: ["code"] },
          { foreignKeyName: "account_applications_reviewed_by_fkey"; columns: ["reviewed_by"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "account_applications_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      account_tiers: {
        Row: {
          code: string
          created_at: string
          display_order: number
          is_enterprise: boolean
          max_chapters_per_course: number
          name_vi: string
          platform_fee_pct: number
          requires_approval: boolean
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          is_enterprise?: boolean
          max_chapters_per_course: number
          name_vi: string
          platform_fee_pct: number
          requires_approval?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          is_enterprise?: boolean
          max_chapters_per_course?: number
          name_vi?: string
          platform_fee_pct?: number
          requires_approval?: boolean
        }
        Relationships: []
      }
      bookmarks: {
        Row: {
          created_at: string
          id: string
          lesson_id: string
          node_id: string | null
          pgn_snapshot: string
          played_plies: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id: string
          node_id?: string | null
          pgn_snapshot?: string
          played_plies?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string
          node_id?: string | null
          pgn_snapshot?: string
          played_plies?: number | null
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "bookmarks_lesson_id_fkey"; columns: ["lesson_id"]; referencedRelation: "lessons"; referencedColumns: ["id"] },
          { foreignKeyName: "bookmarks_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      chapters: {
        Row: {
          course_id: string
          created_at: string
          id: string
          position: number
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          position?: number
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          position?: number
          title?: string
        }
        Relationships: [
          { foreignKeyName: "chapters_course_id_fkey"; columns: ["course_id"]; referencedRelation: "courses"; referencedColumns: ["id"] }
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          course_id: string
          created_at: string
          id: string
          is_hidden: boolean
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          course_id: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          course_id?: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "comments_author_id_fkey"; columns: ["author_id"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "comments_course_id_fkey"; columns: ["course_id"]; referencedRelation: "courses"; referencedColumns: ["id"] }
        ]
      }
      config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      courses: {
        Row: {
          avg_rating: number
          created_at: string
          creator_id: string
          description: string | null
          enrollment_count: number
          id: string
          language: string
          level: Database["public"]["Enums"]["course_level"]
          original_price: number | null
          prerequisites: string | null
          price: number
          promo_ends_at: string | null
          rating_count: number
          status: Database["public"]["Enums"]["course_status"]
          tags: string[]
          thumbnail_url: string | null
          title: string
          updated_at: string
          what_you_learn: string[]
        }
        Insert: {
          avg_rating?: number
          created_at?: string
          creator_id: string
          description?: string | null
          enrollment_count?: number
          id?: string
          language?: string
          level?: Database["public"]["Enums"]["course_level"]
          original_price?: number | null
          prerequisites?: string | null
          price?: number
          promo_ends_at?: string | null
          rating_count?: number
          status?: Database["public"]["Enums"]["course_status"]
          tags?: string[]
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          what_you_learn?: string[]
        }
        Update: {
          avg_rating?: number
          created_at?: string
          creator_id?: string
          description?: string | null
          enrollment_count?: number
          id?: string
          language?: string
          level?: Database["public"]["Enums"]["course_level"]
          original_price?: number | null
          prerequisites?: string | null
          price?: number
          promo_ends_at?: string | null
          rating_count?: number
          status?: Database["public"]["Enums"]["course_status"]
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          what_you_learn?: string[]
        }
        Relationships: [
          { foreignKeyName: "courses_creator_id_fkey"; columns: ["creator_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      creator_payout_info: {
        Row: {
          account_holder: string
          account_number: string
          bank_branch: string
          bank_code: string
          bank_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_holder: string
          account_number: string
          bank_branch: string
          bank_code: string
          bank_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_holder?: string
          account_number?: string
          bank_branch?: string
          bank_code?: string
          bank_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "creator_payout_info_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      creator_tags: {
        Row: {
          created_at: string
          creator_id: string
          id: string
          tag_name: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          id?: string
          tag_name: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          id?: string
          tag_name?: string
        }
        Relationships: [
          { foreignKeyName: "creator_tags_creator_id_fkey"; columns: ["creator_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          order_id: string | null
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          order_id?: string | null
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          order_id?: string | null
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "enrollments_course_id_fkey"; columns: ["course_id"]; referencedRelation: "courses"; referencedColumns: ["id"] },
          { foreignKeyName: "enrollments_order_id_fkey"; columns: ["order_id"]; referencedRelation: "orders"; referencedColumns: ["id"] },
          { foreignKeyName: "enrollments_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      lesson_progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          course_id: string
          id: string
          last_viewed_node_id: string | null
          lesson_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          course_id: string
          id?: string
          last_viewed_node_id?: string | null
          lesson_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          course_id?: string
          id?: string
          last_viewed_node_id?: string | null
          lesson_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          { foreignKeyName: "lesson_progress_course_id_fkey"; columns: ["course_id"]; referencedRelation: "courses"; referencedColumns: ["id"] },
          { foreignKeyName: "lesson_progress_lesson_id_fkey"; columns: ["lesson_id"]; referencedRelation: "lessons"; referencedColumns: ["id"] },
          { foreignKeyName: "lesson_progress_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      lessons: {
        Row: {
          board_perspective: string
          chapter_id: string
          coach_note: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          duration_seconds: number
          free_preview: boolean
          id: string
          is_view_only: boolean
          pgn_data: string
          position: number
          puzzle_player_side: string | null
          starting_fen: string | null
          title: string
          type: Database["public"]["Enums"]["lesson_type"]
          video_error: string | null
          video_filename: string | null
          video_mime: string | null
          video_provider: Database["public"]["Enums"]["video_provider"] | null
          video_provider_id: string | null
          video_size_bytes: number | null
          video_status: Database["public"]["Enums"]["video_status"]
        }
        Insert: {
          board_perspective?: string
          chapter_id: string
          coach_note?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          duration_seconds?: number
          free_preview?: boolean
          id?: string
          is_view_only?: boolean
          pgn_data?: string
          position?: number
          puzzle_player_side?: string | null
          starting_fen?: string | null
          title: string
          type?: Database["public"]["Enums"]["lesson_type"]
          video_error?: string | null
          video_filename?: string | null
          video_mime?: string | null
          video_provider?: Database["public"]["Enums"]["video_provider"] | null
          video_provider_id?: string | null
          video_size_bytes?: number | null
          video_status?: Database["public"]["Enums"]["video_status"]
        }
        Update: {
          board_perspective?: string
          chapter_id?: string
          coach_note?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          duration_seconds?: number
          free_preview?: boolean
          id?: string
          is_view_only?: boolean
          pgn_data?: string
          position?: number
          puzzle_player_side?: string | null
          starting_fen?: string | null
          title?: string
          type?: Database["public"]["Enums"]["lesson_type"]
          video_error?: string | null
          video_filename?: string | null
          video_mime?: string | null
          video_provider?: Database["public"]["Enums"]["video_provider"] | null
          video_provider_id?: string | null
          video_size_bytes?: number | null
          video_status?: Database["public"]["Enums"]["video_status"]
        }
        Relationships: [
          { foreignKeyName: "lessons_chapter_id_fkey"; columns: ["chapter_id"]; referencedRelation: "chapters"; referencedColumns: ["id"] }
        ]
      }
      orders: {
        Row: {
          account_tier_code: string | null
          amount: number
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          code: string
          confirmed_at: string | null
          confirmed_by: string | null
          course_id: string
          created_at: string
          creator_payout: number
          creator_payout_amount: number
          id: string
          notes: string | null
          platform_fee_amount: number
          platform_fee_pct: number
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_tier_code?: string | null
          amount?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          code: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          course_id: string
          created_at?: string
          creator_payout?: number
          creator_payout_amount?: number
          id?: string
          notes?: string | null
          platform_fee_amount?: number
          platform_fee_pct?: number
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_tier_code?: string | null
          amount?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          code?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          course_id?: string
          created_at?: string
          creator_payout?: number
          creator_payout_amount?: number
          id?: string
          notes?: string | null
          platform_fee_amount?: number
          platform_fee_pct?: number
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "orders_account_tier_code_fkey"; columns: ["account_tier_code"]; referencedRelation: "account_tiers"; referencedColumns: ["code"] },
          { foreignKeyName: "orders_cancelled_by_fkey"; columns: ["cancelled_by"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_confirmed_by_fkey"; columns: ["confirmed_by"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_course_id_fkey"; columns: ["course_id"]; referencedRelation: "courses"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      puzzle_attempts: {
        Row: {
          completed_at: string
          duration_seconds: number
          lesson_id: string
          user_id: string
          wrong_attempts: number
        }
        Insert: {
          completed_at?: string
          duration_seconds?: number
          lesson_id: string
          user_id: string
          wrong_attempts?: number
        }
        Update: {
          completed_at?: string
          duration_seconds?: number
          lesson_id?: string
          user_id?: string
          wrong_attempts?: number
        }
        Relationships: [
          { foreignKeyName: "puzzle_attempts_lesson_id_fkey"; columns: ["lesson_id"]; referencedRelation: "lessons"; referencedColumns: ["id"] },
          { foreignKeyName: "puzzle_attempts_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      reports: {
        Row: {
          comment_id: string
          context: string | null
          created_at: string
          id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
        }
        Insert: {
          comment_id: string
          context?: string | null
          created_at?: string
          id?: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
        }
        Update: {
          comment_id?: string
          context?: string | null
          created_at?: string
          id?: string
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
        }
        Relationships: [
          { foreignKeyName: "reports_comment_id_fkey"; columns: ["comment_id"]; referencedRelation: "comments"; referencedColumns: ["id"] },
          { foreignKeyName: "reports_reporter_id_fkey"; columns: ["reporter_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      reviews: {
        Row: {
          body: string | null
          course_id: string
          created_at: string
          id: string
          rating: number
          reviewer_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          course_id: string
          created_at?: string
          id?: string
          rating: number
          reviewer_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          course_id?: string
          created_at?: string
          id?: string
          rating?: number
          reviewer_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "reviews_course_id_fkey"; columns: ["course_id"]; referencedRelation: "courses"; referencedColumns: ["id"] },
          { foreignKeyName: "reviews_reviewer_id_fkey"; columns: ["reviewer_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      users: {
        Row: {
          account_tier_id: string
          avatar_url: string | null
          created_at: string
          editor_advanced: boolean
          email: string
          id: string
          name: string | null
          platform_fee_pct_override: number | null
          role: string
        }
        Insert: {
          account_tier_id?: string
          avatar_url?: string | null
          created_at?: string
          editor_advanced?: boolean
          email: string
          id: string
          name?: string | null
          platform_fee_pct_override?: number | null
          role?: string
        }
        Update: {
          account_tier_id?: string
          avatar_url?: string | null
          created_at?: string
          editor_advanced?: boolean
          email?: string
          id?: string
          name?: string | null
          platform_fee_pct_override?: number | null
          role?: string
        }
        Relationships: [
          { foreignKeyName: "users_account_tier_id_fkey"; columns: ["account_tier_id"]; referencedRelation: "account_tiers"; referencedColumns: ["code"] }
        ]
      }
    }
    Views: {
      puzzle_best_attempt: {
        Row: {
          lesson_id: string | null
          user_id: string | null
          wrong_attempts: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_order_with_fee_snapshot: {
        Args: { p_course_id: string }
        Returns: string
      }
      submit_account_application: {
        Args: {
          p_requested_tier_code: string
          p_motivation: string
          p_experience: string
          p_sample_url?: string
          p_metadata?: Json
        }
        Returns: string
      }
    }
    Enums: {
      course_level: "beginner" | "intermediate" | "advanced"
      course_status: "draft" | "pending_review" | "published"
      lesson_type: "video" | "chess" | "puzzle"
      order_status: "pending" | "active" | "cancelled"
      report_reason: "inappropriate" | "spam" | "misleading"
      video_provider: "supabase" | "cloudflare"
      video_status: "idle" | "uploading" | "processing" | "ready" | "error"
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"]

export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T]
