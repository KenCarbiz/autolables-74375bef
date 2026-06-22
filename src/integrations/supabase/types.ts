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
  public: {
    Tables: {
      addendum_events: {
        Row: {
          actor: string | null
          actor_name: string | null
          addendum_id: string
          channel: string | null
          created_at: string
          details: Json | null
          event: string
          id: string
          signing_token: string | null
        }
        Insert: {
          actor?: string | null
          actor_name?: string | null
          addendum_id: string
          channel?: string | null
          created_at?: string
          details?: Json | null
          event: string
          id?: string
          signing_token?: string | null
        }
        Update: {
          actor?: string | null
          actor_name?: string | null
          addendum_id?: string
          channel?: string | null
          created_at?: string
          details?: Json | null
          event?: string
          id?: string
          signing_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addendum_events_addendum_id_fkey"
            columns: ["addendum_id"]
            isOneToOne: false
            referencedRelation: "addendums"
            referencedColumns: ["id"]
          },
        ]
      }
      addendum_signings: {
        Row: {
          acknowledgments: Json
          addendum_id: string | null
          canonical_payload: Json | null
          content_hash: string | null
          created_at: string
          deal_token_id: string | null
          delivery_mileage: number | null
          esign_consent: Json | null
          id: string
          ip_address: string | null
          prep_sign_off_id: string | null
          price_overrides: Json | null
          signature_data: string | null
          signature_type: string | null
          signed_at: string
          signer_email: string | null
          signer_name: string | null
          signer_phone: string | null
          signer_type: string
          signing_location: Json | null
          tenant_id: string | null
          user_agent: string | null
          vehicle_listing_id: string | null
          vin: string | null
        }
        Insert: {
          acknowledgments?: Json
          addendum_id?: string | null
          canonical_payload?: Json | null
          content_hash?: string | null
          created_at?: string
          deal_token_id?: string | null
          delivery_mileage?: number | null
          esign_consent?: Json | null
          id?: string
          ip_address?: string | null
          prep_sign_off_id?: string | null
          price_overrides?: Json | null
          signature_data?: string | null
          signature_type?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_name?: string | null
          signer_phone?: string | null
          signer_type: string
          signing_location?: Json | null
          tenant_id?: string | null
          user_agent?: string | null
          vehicle_listing_id?: string | null
          vin?: string | null
        }
        Update: {
          acknowledgments?: Json
          addendum_id?: string | null
          canonical_payload?: Json | null
          content_hash?: string | null
          created_at?: string
          deal_token_id?: string | null
          delivery_mileage?: number | null
          esign_consent?: Json | null
          id?: string
          ip_address?: string | null
          prep_sign_off_id?: string | null
          price_overrides?: Json | null
          signature_data?: string | null
          signature_type?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_name?: string | null
          signer_phone?: string | null
          signer_type?: string
          signing_location?: Json | null
          tenant_id?: string | null
          user_agent?: string | null
          vehicle_listing_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addendum_signings_addendum_id_fkey"
            columns: ["addendum_id"]
            isOneToOne: false
            referencedRelation: "addendums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_deal_token_id_fkey"
            columns: ["deal_token_id"]
            isOneToOne: false
            referencedRelation: "deal_signing_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_prep_sign_off_id_fkey"
            columns: ["prep_sign_off_id"]
            isOneToOne: false
            referencedRelation: "prep_sign_offs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_vehicle_listing_id_fkey"
            columns: ["vehicle_listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      addendums: {
        Row: {
          addendum_date: string | null
          cobuyer_name: string | null
          cobuyer_signature_data: string | null
          cobuyer_signature_type: string | null
          cobuyer_signed_at: string | null
          content_hash: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_info: Json
          customer_ip: string | null
          customer_name: string | null
          customer_signature_data: string | null
          customer_signature_type: string | null
          customer_signed_at: string | null
          dealer_snapshot: Json | null
          delivered_at: string | null
          delivered_by: string | null
          delivery_mileage: number | null
          employee_name: string | null
          employee_signature_data: string | null
          employee_signature_type: string | null
          employee_signed_at: string | null
          esign_consent: Json | null
          expected_total: number | null
          financing_input: Json | null
          frozen_snapshot: Json | null
          id: string
          initials: Json | null
          lifecycle_status: string
          listing_slug: string | null
          locked_at: string | null
          optional_selections: Json | null
          price_overrides: Json | null
          price_verification_delta: number | null
          price_verification_method: string | null
          price_verification_status: string
          price_verified: boolean
          price_verified_at: string | null
          products_snapshot: Json
          ready_at: string | null
          sb766_add_on_precontract: Json | null
          sb766_financing_disclosure: Json | null
          sb766_three_day_return_ack: boolean | null
          scraped_advertised_price: number | null
          selling_price: number | null
          signing_location: Json | null
          signing_token: string | null
          status: string
          sticker_match_ack: boolean | null
          store_id: string | null
          tenant_id: string | null
          total_installed: number | null
          total_with_optional: number | null
          updated_at: string
          user_agent: string | null
          vehicle_file_id: string | null
          vehicle_price: number | null
          vehicle_state: string | null
          vehicle_stock: string | null
          vehicle_vin: string | null
          vehicle_ymm: string | null
          version_label: string | null
          warranty_ack: boolean | null
        }
        Insert: {
          addendum_date?: string | null
          cobuyer_name?: string | null
          cobuyer_signature_data?: string | null
          cobuyer_signature_type?: string | null
          cobuyer_signed_at?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_info?: Json
          customer_ip?: string | null
          customer_name?: string | null
          customer_signature_data?: string | null
          customer_signature_type?: string | null
          customer_signed_at?: string | null
          dealer_snapshot?: Json | null
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_mileage?: number | null
          employee_name?: string | null
          employee_signature_data?: string | null
          employee_signature_type?: string | null
          employee_signed_at?: string | null
          esign_consent?: Json | null
          expected_total?: number | null
          financing_input?: Json | null
          frozen_snapshot?: Json | null
          id?: string
          initials?: Json | null
          lifecycle_status?: string
          listing_slug?: string | null
          locked_at?: string | null
          optional_selections?: Json | null
          price_overrides?: Json | null
          price_verification_delta?: number | null
          price_verification_method?: string | null
          price_verification_status?: string
          price_verified?: boolean
          price_verified_at?: string | null
          products_snapshot?: Json
          ready_at?: string | null
          sb766_add_on_precontract?: Json | null
          sb766_financing_disclosure?: Json | null
          sb766_three_day_return_ack?: boolean | null
          scraped_advertised_price?: number | null
          selling_price?: number | null
          signing_location?: Json | null
          signing_token?: string | null
          status?: string
          sticker_match_ack?: boolean | null
          store_id?: string | null
          tenant_id?: string | null
          total_installed?: number | null
          total_with_optional?: number | null
          updated_at?: string
          user_agent?: string | null
          vehicle_file_id?: string | null
          vehicle_price?: number | null
          vehicle_state?: string | null
          vehicle_stock?: string | null
          vehicle_vin?: string | null
          vehicle_ymm?: string | null
          version_label?: string | null
          warranty_ack?: boolean | null
        }
        Update: {
          addendum_date?: string | null
          cobuyer_name?: string | null
          cobuyer_signature_data?: string | null
          cobuyer_signature_type?: string | null
          cobuyer_signed_at?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_info?: Json
          customer_ip?: string | null
          customer_name?: string | null
          customer_signature_data?: string | null
          customer_signature_type?: string | null
          customer_signed_at?: string | null
          dealer_snapshot?: Json | null
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_mileage?: number | null
          employee_name?: string | null
          employee_signature_data?: string | null
          employee_signature_type?: string | null
          employee_signed_at?: string | null
          esign_consent?: Json | null
          expected_total?: number | null
          financing_input?: Json | null
          frozen_snapshot?: Json | null
          id?: string
          initials?: Json | null
          lifecycle_status?: string
          listing_slug?: string | null
          locked_at?: string | null
          optional_selections?: Json | null
          price_overrides?: Json | null
          price_verification_delta?: number | null
          price_verification_method?: string | null
          price_verification_status?: string
          price_verified?: boolean
          price_verified_at?: string | null
          products_snapshot?: Json
          ready_at?: string | null
          sb766_add_on_precontract?: Json | null
          sb766_financing_disclosure?: Json | null
          sb766_three_day_return_ack?: boolean | null
          scraped_advertised_price?: number | null
          selling_price?: number | null
          signing_location?: Json | null
          signing_token?: string | null
          status?: string
          sticker_match_ack?: boolean | null
          store_id?: string | null
          tenant_id?: string | null
          total_installed?: number | null
          total_with_optional?: number | null
          updated_at?: string
          user_agent?: string | null
          vehicle_file_id?: string | null
          vehicle_price?: number | null
          vehicle_state?: string | null
          vehicle_stock?: string | null
          vehicle_vin?: string | null
          vehicle_ymm?: string | null
          version_label?: string | null
          warranty_ack?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "addendums_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendums_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendums_vehicle_file_id_fkey"
            columns: ["vehicle_file_id"]
            isOneToOne: false
            referencedRelation: "vehicle_files"
            referencedColumns: ["id"]
          },
        ]
      }
      advertised_prices: {
        Row: {
          advertised_price: number
          captured_at: string
          captured_by: string | null
          created_at: string
          id: string
          notes: string | null
          screenshot_bucket: string
          screenshot_sha256: string | null
          screenshot_url: string | null
          source_channel: string
          source_url: string | null
          store_id: string | null
          tenant_id: string
          updated_at: string
          vin: string
        }
        Insert: {
          advertised_price: number
          captured_at?: string
          captured_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          screenshot_bucket?: string
          screenshot_sha256?: string | null
          screenshot_url?: string | null
          source_channel?: string
          source_url?: string | null
          store_id?: string | null
          tenant_id: string
          updated_at?: string
          vin: string
        }
        Update: {
          advertised_price?: number
          captured_at?: string
          captured_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          screenshot_bucket?: string
          screenshot_sha256?: string | null
          screenshot_url?: string | null
          source_channel?: string
          source_url?: string | null
          store_id?: string | null
          tenant_id?: string
          updated_at?: string
          vin?: string
        }
        Relationships: []
      }
      app_entitlements: {
        Row: {
          activated_at: string
          app_slug: string
          created_at: string
          expires_at: string | null
          id: string
          metadata: Json
          plan_tier: string
          renewed_at: string | null
          seat_limit: number | null
          status: string
          stripe_subscription_id: string | null
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string
          app_slug: string
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          plan_tier?: string
          renewed_at?: string | null
          seat_limit?: number | null
          status?: string
          stripe_subscription_id?: string | null
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string
          app_slug?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          plan_tier?: string
          renewed_at?: string | null
          seat_limit?: number | null
          status?: string
          stripe_subscription_id?: string | null
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_entitlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_entitlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          content_hash: string | null
          created_at: string
          details: Json
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          prev_hash: string | null
          row_hash: string | null
          store_id: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          content_hash?: string | null
          created_at?: string
          details?: Json
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          prev_hash?: string | null
          row_hash?: string | null
          store_id?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          content_hash?: string | null
          created_at?: string
          details?: Json
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          prev_hash?: string | null
          row_hash?: string | null
          store_id?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      autolabels_usage_events: {
        Row: {
          created_at: string
          created_by: string | null
          entity_id: string | null
          entity_type: string | null
          feature_key: string
          id: string
          metadata: Json
          metric_key: string
          quantity: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: string | null
          feature_key: string
          id?: string
          metadata?: Json
          metric_key: string
          quantity?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: string | null
          feature_key?: string
          id?: string
          metadata?: Json
          metric_key?: string
          quantity?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "autolabels_usage_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autolabels_usage_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          error: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          stripe_event_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          stripe_event_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          stripe_event_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ct_mvp_certification_runs: {
        Row: {
          certified_at: string
          checks: Json
          created_at: string
          id: string
          lifecycle_audit: Json
          ready: boolean
          required_document_keys: string[]
          rule_output: Json
          signature_validation: Json
          source: string
          stock: string | null
          tenant_id: string
          vehicle_id: string | null
          vehicle_title: string | null
          vin: string | null
        }
        Insert: {
          certified_at?: string
          checks?: Json
          created_at?: string
          id?: string
          lifecycle_audit?: Json
          ready?: boolean
          required_document_keys?: string[]
          rule_output?: Json
          signature_validation?: Json
          source?: string
          stock?: string | null
          tenant_id: string
          vehicle_id?: string | null
          vehicle_title?: string | null
          vin?: string | null
        }
        Update: {
          certified_at?: string
          checks?: Json
          created_at?: string
          id?: string
          lifecycle_audit?: Json
          ready?: boolean
          required_document_keys?: string[]
          rule_output?: Json
          signature_validation?: Json
          source?: string
          stock?: string | null
          tenant_id?: string
          vehicle_id?: string | null
          vehicle_title?: string | null
          vin?: string | null
        }
        Relationships: []
      }
      ct_mvp_compliance_digest_outbox: {
        Row: {
          channel: string
          created_at: string
          digest: Json
          error: string | null
          id: string
          recipient_email: string | null
          sent_at: string | null
          status: string
          subject: string
          summary_text: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          digest?: Json
          error?: string | null
          id?: string
          recipient_email?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          summary_text: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          digest?: Json
          error?: string | null
          id?: string
          recipient_email?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          summary_text?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_engagement_events: {
        Row: {
          browser: string | null
          city: string | null
          country: string | null
          created_at: string
          device_type: string | null
          document_id: string | null
          document_title: string | null
          document_type: string | null
          event_type: string
          id: string
          ip_address: unknown
          landing_url: string | null
          metadata: Json
          occurred_at: string
          os: string | null
          packet_id: string | null
          qr_token: string | null
          referrer: string | null
          region: string | null
          session_id: string
          source: string
          stock: string | null
          store_id: string | null
          surface: string
          tenant_id: string | null
          user_agent: string | null
          vehicle_id: string | null
          vin: string | null
          visitor_id: string | null
        }
        Insert: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          document_id?: string | null
          document_title?: string | null
          document_type?: string | null
          event_type: string
          id?: string
          ip_address?: unknown
          landing_url?: string | null
          metadata?: Json
          occurred_at?: string
          os?: string | null
          packet_id?: string | null
          qr_token?: string | null
          referrer?: string | null
          region?: string | null
          session_id: string
          source?: string
          stock?: string | null
          store_id?: string | null
          surface?: string
          tenant_id?: string | null
          user_agent?: string | null
          vehicle_id?: string | null
          vin?: string | null
          visitor_id?: string | null
        }
        Update: {
          browser?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device_type?: string | null
          document_id?: string | null
          document_title?: string | null
          document_type?: string | null
          event_type?: string
          id?: string
          ip_address?: unknown
          landing_url?: string | null
          metadata?: Json
          occurred_at?: string
          os?: string | null
          packet_id?: string | null
          qr_token?: string | null
          referrer?: string | null
          region?: string | null
          session_id?: string
          source?: string
          stock?: string | null
          store_id?: string | null
          surface?: string
          tenant_id?: string | null
          user_agent?: string | null
          vehicle_id?: string | null
          vin?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      deal_signing_tokens: {
        Row: {
          content_hash: string | null
          created_at: string
          created_by: string | null
          customer_ip: string | null
          esign_consent: Json | null
          expires_at: string
          id: string
          revoked_at: string | null
          signed_at: string | null
          signed_payload: Json | null
          status: string
          tenant_id: string | null
          token: string
          updated_at: string
          user_agent: string | null
          vehicle_file_id: string
          vehicle_payload: Json
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          customer_ip?: string | null
          esign_consent?: Json | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          signed_at?: string | null
          signed_payload?: Json | null
          status?: string
          tenant_id?: string | null
          token: string
          updated_at?: string
          user_agent?: string | null
          vehicle_file_id: string
          vehicle_payload?: Json
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          customer_ip?: string | null
          esign_consent?: Json | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          signed_at?: string | null
          signed_payload?: Json | null
          status?: string
          tenant_id?: string | null
          token?: string
          updated_at?: string
          user_agent?: string | null
          vehicle_file_id?: string
          vehicle_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "deal_signing_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_signing_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_branding: {
        Row: {
          accent_color: string | null
          address: string | null
          branding: Json
          created_at: string
          dealer_name: string | null
          disclaimer: string | null
          id: string
          logo_url: string | null
          phone: string | null
          primary_color: string | null
          secondary_color: string | null
          tagline: string | null
          tenant_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          accent_color?: string | null
          address?: string | null
          branding?: Json
          created_at?: string
          dealer_name?: string | null
          disclaimer?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tagline?: string | null
          tenant_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          accent_color?: string | null
          address?: string | null
          branding?: Json
          created_at?: string
          dealer_name?: string | null
          disclaimer?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tagline?: string | null
          tenant_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      dealer_cpo_programs: {
        Row: {
          created_at: string
          disclosure: string | null
          headline: string
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          metadata: Json
          miles: number | null
          months: number | null
          price_add_on: number | null
          program_type: string
          requires_financing: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          disclosure?: string | null
          headline: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          metadata?: Json
          miles?: number | null
          months?: number | null
          price_add_on?: number | null
          program_type?: string
          requires_financing?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          disclosure?: string | null
          headline?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          metadata?: Json
          miles?: number | null
          months?: number | null
          price_add_on?: number | null
          program_type?: string
          requires_financing?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_passport_settings: {
        Row: {
          created_at: string
          id: string
          passport_enabled: boolean
          qr_destination_mode: string
          settings: Json
          show_history_signals: boolean
          show_market_data: boolean
          show_reconditioning: boolean
          show_service_records: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          passport_enabled?: boolean
          qr_destination_mode?: string
          settings?: Json
          show_history_signals?: boolean
          show_market_data?: boolean
          show_reconditioning?: boolean
          show_service_records?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          passport_enabled?: boolean
          qr_destination_mode?: string
          settings?: Json
          show_history_signals?: boolean
          show_market_data?: boolean
          show_reconditioning?: boolean
          show_service_records?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_price_labels: {
        Row: {
          context: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          context?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          context?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_print_settings: {
        Row: {
          addendum_label_size: string
          created_at: string
          id: string
          label_mode: string
          location_id: string | null
          printer_name: string | null
          safe_margin_bottom_inches: number
          safe_margin_left_inches: number
          safe_margin_right_inches: number
          safe_margin_top_inches: number
          scale_percentage: number
          show_crop_marks: boolean
          show_safe_area: boolean
          tenant_id: string
          updated_at: string
          window_label_size: string
          x_offset_inches: number
          y_offset_inches: number
        }
        Insert: {
          addendum_label_size?: string
          created_at?: string
          id?: string
          label_mode?: string
          location_id?: string | null
          printer_name?: string | null
          safe_margin_bottom_inches?: number
          safe_margin_left_inches?: number
          safe_margin_right_inches?: number
          safe_margin_top_inches?: number
          scale_percentage?: number
          show_crop_marks?: boolean
          show_safe_area?: boolean
          tenant_id: string
          updated_at?: string
          window_label_size?: string
          x_offset_inches?: number
          y_offset_inches?: number
        }
        Update: {
          addendum_label_size?: string
          created_at?: string
          id?: string
          label_mode?: string
          location_id?: string | null
          printer_name?: string | null
          safe_margin_bottom_inches?: number
          safe_margin_left_inches?: number
          safe_margin_right_inches?: number
          safe_margin_top_inches?: number
          scale_percentage?: number
          show_crop_marks?: boolean
          show_safe_area?: boolean
          tenant_id?: string
          updated_at?: string
          window_label_size?: string
          x_offset_inches?: number
          y_offset_inches?: number
        }
        Relationships: []
      }
      dealer_profiles: {
        Row: {
          created_at: string
          settings: Json
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          settings?: Json
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          settings?: Json
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dealer_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_review_sources: {
        Row: {
          allow_automated_fetch: boolean
          created_at: string
          id: string
          is_active: boolean
          is_primary: boolean
          label: string
          manually_entered: boolean
          metadata: Json
          profile_url: string | null
          rating: number | null
          review_count: number | null
          source_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allow_automated_fetch?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label?: string
          manually_entered?: boolean
          metadata?: Json
          profile_url?: string | null
          rating?: number | null
          review_count?: number | null
          source_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allow_automated_fetch?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          label?: string
          manually_entered?: boolean
          metadata?: Json
          profile_url?: string | null
          rating?: number | null
          review_count?: number | null
          source_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_rule_preferences: {
        Row: {
          auto_archive_signed_packet: boolean
          auto_generate_addendum: boolean
          auto_generate_passport: boolean
          auto_select_templates: boolean
          created_at: string
          id: string
          require_ftc_buyers_guide: boolean
          require_k208: boolean
          rules: Json
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_archive_signed_packet?: boolean
          auto_generate_addendum?: boolean
          auto_generate_passport?: boolean
          auto_select_templates?: boolean
          created_at?: string
          id?: string
          require_ftc_buyers_guide?: boolean
          require_k208?: boolean
          rules?: Json
          state?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_archive_signed_packet?: boolean
          auto_generate_addendum?: boolean
          auto_generate_passport?: boolean
          auto_select_templates?: boolean
          created_at?: string
          id?: string
          require_ftc_buyers_guide?: boolean
          require_k208?: boolean
          rules?: Json
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_settings: {
        Row: {
          created_at: string
          dealer_name: string | null
          default_condition: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          settings: Json
          state: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dealer_name?: string | null
          default_condition?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          settings?: Json
          state?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dealer_name?: string | null
          default_condition?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          settings?: Json
          state?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_sticker_template_prefs: {
        Row: {
          created_at: string
          id: string
          is_favorite: boolean
          template_id: string
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_favorite?: boolean
          template_id: string
          tenant_id: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_favorite?: boolean
          template_id?: string
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_sticker_template_prefs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "sticker_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_subscriptions: {
        Row: {
          active_product_slugs: string[]
          bundle_slug: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          dealer_id: string
          id: string
          plan_tier: string
          status: string
          updated_at: string
        }
        Insert: {
          active_product_slugs?: string[]
          bundle_slug?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          dealer_id: string
          id?: string
          plan_tier?: string
          status?: string
          updated_at?: string
        }
        Update: {
          active_product_slugs?: string[]
          bundle_slug?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          dealer_id?: string
          id?: string
          plan_tier?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      dealer_template_customizations: {
        Row: {
          accent_color: string | null
          addendum_wording: string | null
          created_at: string
          default_benefits: Json
          disclaimer_override: string | null
          id: string
          logo_enabled: boolean
          preferred_label_mode: string | null
          qr_enabled: boolean
          secondary_color: string | null
          section_label_overrides: Json
          template_id: string
          tenant_id: string
          updated_at: string
          value_prop_override: string | null
        }
        Insert: {
          accent_color?: string | null
          addendum_wording?: string | null
          created_at?: string
          default_benefits?: Json
          disclaimer_override?: string | null
          id?: string
          logo_enabled?: boolean
          preferred_label_mode?: string | null
          qr_enabled?: boolean
          secondary_color?: string | null
          section_label_overrides?: Json
          template_id: string
          tenant_id: string
          updated_at?: string
          value_prop_override?: string | null
        }
        Update: {
          accent_color?: string | null
          addendum_wording?: string | null
          created_at?: string
          default_benefits?: Json
          disclaimer_override?: string | null
          id?: string
          logo_enabled?: boolean
          preferred_label_mode?: string | null
          qr_enabled?: boolean
          secondary_color?: string | null
          section_label_overrides?: Json
          template_id?: string
          tenant_id?: string
          updated_at?: string
          value_prop_override?: string | null
        }
        Relationships: []
      }
      dealer_template_preferences: {
        Row: {
          created_at: string
          dealer_cpo_template: string | null
          default_addendum_template: string | null
          default_window_template: string | null
          id: string
          luxury_template: string | null
          new_window_template: string | null
          oem_cpo_template: string | null
          settings: Json
          tenant_id: string
          updated_at: string
          used_window_template: string | null
        }
        Insert: {
          created_at?: string
          dealer_cpo_template?: string | null
          default_addendum_template?: string | null
          default_window_template?: string | null
          id?: string
          luxury_template?: string | null
          new_window_template?: string | null
          oem_cpo_template?: string | null
          settings?: Json
          tenant_id: string
          updated_at?: string
          used_window_template?: string | null
        }
        Update: {
          created_at?: string
          dealer_cpo_template?: string | null
          default_addendum_template?: string | null
          default_window_template?: string | null
          id?: string
          luxury_template?: string | null
          new_window_template?: string | null
          oem_cpo_template?: string | null
          settings?: Json
          tenant_id?: string
          updated_at?: string
          used_window_template?: string | null
        }
        Relationships: []
      }
      demo_requests: {
        Row: {
          created_at: string
          dealership_name: string | null
          email: string
          id: string
          message: string | null
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          dealership_name?: string | null
          email: string
          id?: string
          message?: string | null
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          dealership_name?: string | null
          email?: string
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      document_lifecycle_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          source: string | null
          stock: string | null
          tenant_id: string
          vehicle_id: string | null
          vin: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          source?: string | null
          stock?: string | null
          tenant_id: string
          vehicle_id?: string | null
          vin?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          source?: string | null
          stock?: string | null
          tenant_id?: string
          vehicle_id?: string | null
          vin?: string | null
        }
        Relationships: []
      }
      email_recipients: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          is_active: boolean
          name: string
          role: string
          store_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          is_active?: boolean
          name?: string
          role: string
          store_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          role?: string
          store_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      evidence_receipts: {
        Row: {
          chain_root: string
          created_at: string
          generated_by: string | null
          id: string
          manifest: Json
          packet_version: string
          tenant_id: string
          vin: string
        }
        Insert: {
          chain_root: string
          created_at?: string
          generated_by?: string | null
          id?: string
          manifest: Json
          packet_version?: string
          tenant_id: string
          vin: string
        }
        Update: {
          chain_root?: string
          created_at?: string
          generated_by?: string | null
          id?: string
          manifest?: Json
          packet_version?: string
          tenant_id?: string
          vin?: string
        }
        Relationships: []
      }
      generated_documents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          data_snapshot: Json
          document_status: string
          document_type: string
          generated_by: string | null
          id: string
          label_mode: string
          last_printed_at: string | null
          online_url: string | null
          pdf_url: string | null
          png_url: string | null
          print_count: number
          printed_at: string | null
          published_at: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          superseded_at: string | null
          superseded_by: string | null
          template_id: string
          template_version: number | null
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          data_snapshot?: Json
          document_status?: string
          document_type: string
          generated_by?: string | null
          id?: string
          label_mode?: string
          last_printed_at?: string | null
          online_url?: string | null
          pdf_url?: string | null
          png_url?: string | null
          print_count?: number
          printed_at?: string | null
          published_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          template_id: string
          template_version?: number | null
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          data_snapshot?: Json
          document_status?: string
          document_type?: string
          generated_by?: string | null
          id?: string
          label_mode?: string
          last_printed_at?: string | null
          online_url?: string | null
          pdf_url?: string | null
          png_url?: string | null
          print_count?: number
          printed_at?: string | null
          published_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          template_id?: string
          template_version?: number | null
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      get_ready_records: {
        Row: {
          accessories_to_install: Json
          acquired_date: string | null
          assigned_technician: string
          autocurb_inspection_id: string | null
          condition: string
          created_at: string
          created_by: string
          get_ready_complete_date: string | null
          get_ready_start_date: string | null
          id: string
          inspection_by: string | null
          inspection_complete: boolean
          inspection_date: string | null
          inspection_form_type: string | null
          inspection_required: boolean
          inspection_signature_data: string | null
          inventory_date: string | null
          items: Json
          ro_number: string
          service_advisor: string
          status: string
          stock_number: string
          store_id: string | null
          tenant_id: string
          updated_at: string
          vehicle_file_id: string | null
          vin: string
          ymm: string
        }
        Insert: {
          accessories_to_install?: Json
          acquired_date?: string | null
          assigned_technician?: string
          autocurb_inspection_id?: string | null
          condition?: string
          created_at?: string
          created_by?: string
          get_ready_complete_date?: string | null
          get_ready_start_date?: string | null
          id?: string
          inspection_by?: string | null
          inspection_complete?: boolean
          inspection_date?: string | null
          inspection_form_type?: string | null
          inspection_required?: boolean
          inspection_signature_data?: string | null
          inventory_date?: string | null
          items?: Json
          ro_number?: string
          service_advisor?: string
          status?: string
          stock_number?: string
          store_id?: string | null
          tenant_id: string
          updated_at?: string
          vehicle_file_id?: string | null
          vin: string
          ymm?: string
        }
        Update: {
          accessories_to_install?: Json
          acquired_date?: string | null
          assigned_technician?: string
          autocurb_inspection_id?: string | null
          condition?: string
          created_at?: string
          created_by?: string
          get_ready_complete_date?: string | null
          get_ready_start_date?: string | null
          id?: string
          inspection_by?: string | null
          inspection_complete?: boolean
          inspection_date?: string | null
          inspection_form_type?: string | null
          inspection_required?: boolean
          inspection_signature_data?: string | null
          inventory_date?: string | null
          items?: Json
          ro_number?: string
          service_advisor?: string
          status?: string
          stock_number?: string
          store_id?: string | null
          tenant_id?: string
          updated_at?: string
          vehicle_file_id?: string | null
          vin?: string
          ymm?: string
        }
        Relationships: [
          {
            foreignKeyName: "get_ready_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "get_ready_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "get_ready_records_vehicle_file_id_fkey"
            columns: ["vehicle_file_id"]
            isOneToOne: false
            referencedRelation: "vehicle_files"
            referencedColumns: ["id"]
          },
        ]
      }
      handoff_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          intent: string
          payload: Json
          source_app: string
          target_app: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          intent?: string
          payload?: Json
          source_app: string
          target_app: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          intent?: string
          payload?: Json
          source_app?: string
          target_app?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handoff_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoff_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      install_proofs: {
        Row: {
          created_at: string
          id: string
          installed_at: string | null
          installer_company: string | null
          installer_ip: string | null
          installer_name: string | null
          installer_signature_data: string | null
          installer_signature_type: string | null
          is_verified: boolean | null
          notes: string | null
          photo_path: string | null
          product_id: string | null
          product_name: string | null
          tenant_id: string | null
          vehicle_vin: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          installed_at?: string | null
          installer_company?: string | null
          installer_ip?: string | null
          installer_name?: string | null
          installer_signature_data?: string | null
          installer_signature_type?: string | null
          is_verified?: boolean | null
          notes?: string | null
          photo_path?: string | null
          product_id?: string | null
          product_name?: string | null
          tenant_id?: string | null
          vehicle_vin: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          installed_at?: string | null
          installer_company?: string | null
          installer_ip?: string | null
          installer_name?: string | null
          installer_signature_data?: string | null
          installer_signature_type?: string | null
          is_verified?: boolean | null
          notes?: string | null
          photo_path?: string | null
          product_id?: string | null
          product_name?: string | null
          tenant_id?: string | null
          vehicle_vin?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          captured_at: string
          email: string
          id: string
          name: string
          notes: string
          phone: string
          signing_url: string
          source: string
          status: string
          store_id: string | null
          tenant_id: string | null
          updated_at: string
          vehicle_interest: string
          vehicle_vin: string
        }
        Insert: {
          captured_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
          signing_url?: string
          source?: string
          status?: string
          store_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          vehicle_interest?: string
          vehicle_vin?: string
        }
        Update: {
          captured_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
          signing_url?: string
          source?: string
          status?: string
          store_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          vehicle_interest?: string
          vehicle_vin?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketcheck_sync_config: {
        Row: {
          allowed: boolean
          created_at: string
          day_of_week: number
          dealer_id: string
          enabled: boolean
          frequency: string
          last_run_at: string | null
          last_status: Json
          max_vehicles: number
          run_hour: number
          source: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          day_of_week?: number
          dealer_id?: string
          enabled?: boolean
          frequency?: string
          last_run_at?: string | null
          last_status?: Json
          max_vehicles?: number
          run_hour?: number
          source?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed?: boolean
          created_at?: string
          day_of_week?: number
          dealer_id?: string
          enabled?: boolean
          frequency?: string
          last_run_at?: string | null
          last_status?: Json
          max_vehicles?: number
          run_hour?: number
          source?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketcheck_sync_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketcheck_sync_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_profiles: {
        Row: {
          billing: Json
          completed_at: string | null
          created_at: string
          display_name: string | null
          last_synced_at: string | null
          lead_preferences: Json
          logo_url: string | null
          phone: string | null
          primary_color: string | null
          secondary_color: string | null
          source: string
          stores: Json
          tagline: string | null
          tenant_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          billing?: Json
          completed_at?: string | null
          created_at?: string
          display_name?: string | null
          last_synced_at?: string | null
          lead_preferences?: Json
          logo_url?: string | null
          phone?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          source?: string
          stores?: Json
          tagline?: string | null
          tenant_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          billing?: Json
          completed_at?: string | null
          created_at?: string
          display_name?: string | null
          last_synced_at?: string | null
          lead_preferences?: Json
          logo_url?: string | null
          phone?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          source?: string
          stores?: Json
          tagline?: string | null
          tenant_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      passport_delivery_settings: {
        Row: {
          allow_customer_visible_reconditioning_notes: boolean
          allow_customer_visible_service_photos: boolean
          allow_trade_value_cta: boolean
          autocurb_trade_enabled: boolean
          autocurb_trade_url: string | null
          create_lead: boolean
          created_at: string
          email_intro_template: string
          email_subject_template: string
          enable_reconditioning_workflow: boolean
          enable_used_car_service_inspection: boolean
          enabled: boolean
          id: string
          metadata: Json
          notify_sales_team: boolean
          require_customer_name: boolean
          require_manager_approval_for_passport_proof: boolean
          require_phone: boolean
          require_sms_verification: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allow_customer_visible_reconditioning_notes?: boolean
          allow_customer_visible_service_photos?: boolean
          allow_trade_value_cta?: boolean
          autocurb_trade_enabled?: boolean
          autocurb_trade_url?: string | null
          create_lead?: boolean
          created_at?: string
          email_intro_template?: string
          email_subject_template?: string
          enable_reconditioning_workflow?: boolean
          enable_used_car_service_inspection?: boolean
          enabled?: boolean
          id?: string
          metadata?: Json
          notify_sales_team?: boolean
          require_customer_name?: boolean
          require_manager_approval_for_passport_proof?: boolean
          require_phone?: boolean
          require_sms_verification?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allow_customer_visible_reconditioning_notes?: boolean
          allow_customer_visible_service_photos?: boolean
          allow_trade_value_cta?: boolean
          autocurb_trade_enabled?: boolean
          autocurb_trade_url?: string | null
          create_lead?: boolean
          created_at?: string
          email_intro_template?: string
          email_subject_template?: string
          enable_reconditioning_workflow?: boolean
          enable_used_car_service_inspection?: boolean
          enabled?: boolean
          id?: string
          metadata?: Json
          notify_sales_team?: boolean
          require_customer_name?: boolean
          require_manager_approval_for_passport_proof?: boolean
          require_phone?: boolean
          require_sms_verification?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      passport_document_delivery_outbox: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          payload: Json
          provider: string | null
          provider_message_id: string | null
          recipient: string | null
          request_id: string
          sent_at: string | null
          status: string
          subject: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient?: string | null
          request_id: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient?: string | null
          request_id?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "passport_document_delivery_outbox_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "passport_document_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      passport_document_delivery_requests: {
        Row: {
          autocurb_handoff: Json
          created_at: string
          customer_email: string
          customer_name: string | null
          customer_phone: string | null
          customer_trade_intent: Json
          delivered_at: string | null
          delivery_status: string
          id: string
          ip_address: unknown
          landing_url: string | null
          lead_status: string
          metadata: Json
          packet_id: string | null
          qr_token: string | null
          referrer: string | null
          requested_at: string
          requested_documents: Json
          session_id: string | null
          source: string
          stock: string | null
          store_id: string | null
          tenant_id: string | null
          updated_at: string
          user_agent: string | null
          vehicle_id: string | null
          vehicle_of_interest: Json
          verification_required: boolean
          verification_status: string
          verified_at: string | null
          vin: string | null
          visitor_id: string | null
        }
        Insert: {
          autocurb_handoff?: Json
          created_at?: string
          customer_email: string
          customer_name?: string | null
          customer_phone?: string | null
          customer_trade_intent?: Json
          delivered_at?: string | null
          delivery_status?: string
          id?: string
          ip_address?: unknown
          landing_url?: string | null
          lead_status?: string
          metadata?: Json
          packet_id?: string | null
          qr_token?: string | null
          referrer?: string | null
          requested_at?: string
          requested_documents?: Json
          session_id?: string | null
          source?: string
          stock?: string | null
          store_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          vehicle_id?: string | null
          vehicle_of_interest?: Json
          verification_required?: boolean
          verification_status?: string
          verified_at?: string | null
          vin?: string | null
          visitor_id?: string | null
        }
        Update: {
          autocurb_handoff?: Json
          created_at?: string
          customer_email?: string
          customer_name?: string | null
          customer_phone?: string | null
          customer_trade_intent?: Json
          delivered_at?: string | null
          delivery_status?: string
          id?: string
          ip_address?: unknown
          landing_url?: string | null
          lead_status?: string
          metadata?: Json
          packet_id?: string | null
          qr_token?: string | null
          referrer?: string | null
          requested_at?: string
          requested_documents?: Json
          session_id?: string | null
          source?: string
          stock?: string | null
          store_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          vehicle_id?: string | null
          vehicle_of_interest?: Json
          verification_required?: boolean
          verification_status?: string
          verified_at?: string | null
          vin?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      passport_sms_verifications: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          max_attempts: number
          metadata: Json
          phone: string
          provider: string | null
          provider_message_id: string | null
          request_id: string
          sent_at: string
          status: string
          tenant_id: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          metadata?: Json
          phone: string
          provider?: string | null
          provider_message_id?: string | null
          request_id: string
          sent_at?: string
          status?: string
          tenant_id?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          metadata?: Json
          phone?: string
          provider?: string | null
          provider_message_id?: string | null
          request_id?: string
          sent_at?: string
          status?: string
          tenant_id?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "passport_sms_verifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "passport_document_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_bundles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          included_product_slugs: string[]
          name: string
          price_monthly: number
          price_yearly: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          included_product_slugs?: string[]
          name: string
          price_monthly?: number
          price_yearly?: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          included_product_slugs?: string[]
          name?: string
          price_monthly?: number
          price_yearly?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_products: {
        Row: {
          app_url: string | null
          created_at: string
          description: string | null
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          app_url?: string | null
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          app_url?: string | null
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      prep_sign_offs: {
        Row: {
          accessories_installed: Json
          created_at: string
          created_by: string | null
          foreman_ip: string | null
          foreman_name: string
          foreman_signature_data: string | null
          get_ready_record_id: string | null
          id: string
          inspection_form_type: string | null
          inspection_passed: boolean
          install_photos: Json
          listing_unlocked: boolean
          notes: string | null
          rejection_reason: string | null
          signed_at: string | null
          status: string
          stock_number: string | null
          store_id: string
          tenant_id: string | null
          updated_at: string
          vehicle_file_id: string | null
          vin: string
          ymm: string | null
        }
        Insert: {
          accessories_installed?: Json
          created_at?: string
          created_by?: string | null
          foreman_ip?: string | null
          foreman_name: string
          foreman_signature_data?: string | null
          get_ready_record_id?: string | null
          id?: string
          inspection_form_type?: string | null
          inspection_passed?: boolean
          install_photos?: Json
          listing_unlocked?: boolean
          notes?: string | null
          rejection_reason?: string | null
          signed_at?: string | null
          status?: string
          stock_number?: string | null
          store_id: string
          tenant_id?: string | null
          updated_at?: string
          vehicle_file_id?: string | null
          vin: string
          ymm?: string | null
        }
        Update: {
          accessories_installed?: Json
          created_at?: string
          created_by?: string | null
          foreman_ip?: string | null
          foreman_name?: string
          foreman_signature_data?: string | null
          get_ready_record_id?: string | null
          id?: string
          inspection_form_type?: string | null
          inspection_passed?: boolean
          install_photos?: Json
          listing_unlocked?: boolean
          notes?: string | null
          rejection_reason?: string | null
          signed_at?: string | null
          status?: string
          stock_number?: string | null
          store_id?: string
          tenant_id?: string | null
          updated_at?: string
          vehicle_file_id?: string | null
          vin?: string
          ymm?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prep_sign_offs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_sign_offs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_sign_offs_vehicle_file_id_fkey"
            columns: ["vehicle_file_id"]
            isOneToOne: false
            referencedRelation: "vehicle_files"
            referencedColumns: ["id"]
          },
        ]
      }
      product_rules: {
        Row: {
          body_styles: string[]
          condition: string
          created_at: string
          id: string
          makes: string[]
          mileage_max: number
          models: string[]
          product_id: string
          tenant_id: string
          trims: string[]
          updated_at: string
          year_max: string
          year_min: string
        }
        Insert: {
          body_styles?: string[]
          condition?: string
          created_at?: string
          id?: string
          makes?: string[]
          mileage_max?: number
          models?: string[]
          product_id: string
          tenant_id: string
          trims?: string[]
          updated_at?: string
          year_max?: string
          year_min?: string
        }
        Update: {
          body_styles?: string[]
          condition?: string
          created_at?: string
          id?: string
          makes?: string[]
          mileage_max?: number
          models?: string[]
          product_id?: string
          tenant_id?: string
          trims?: string[]
          updated_at?: string
          year_max?: string
          year_min?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sale_mode_changes: {
        Row: {
          addendum_id: string | null
          changed_by: string
          changed_by_name: string | null
          created_at: string
          from_mode: string | null
          id: string
          product_id: string | null
          product_name: string
          signing_token: string | null
          tenant_id: string
          to_mode: string
          vehicle_vin: string | null
        }
        Insert: {
          addendum_id?: string | null
          changed_by?: string
          changed_by_name?: string | null
          created_at?: string
          from_mode?: string | null
          id?: string
          product_id?: string | null
          product_name: string
          signing_token?: string | null
          tenant_id: string
          to_mode: string
          vehicle_vin?: string | null
        }
        Update: {
          addendum_id?: string | null
          changed_by?: string
          changed_by_name?: string | null
          created_at?: string
          from_mode?: string | null
          id?: string
          product_id?: string | null
          product_name?: string
          signing_token?: string | null
          tenant_id?: string
          to_mode?: string
          vehicle_vin?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          available_preinstalled: boolean
          badge_type: string
          benefit_justification: string
          benefit_justification_optional: string | null
          contract_doc_type: string | null
          contract_url: string | null
          created_at: string
          disclosure: string | null
          disclosure_optional: string | null
          id: string
          is_active: boolean
          name: string
          price: number
          price_in_advertised: boolean
          price_label: string | null
          price_tiers: Json | null
          sort_order: number
          subtitle: string | null
          updated_at: string
          upgrade: Json | null
          warranty: string | null
        }
        Insert: {
          available_preinstalled?: boolean
          badge_type?: string
          benefit_justification?: string
          benefit_justification_optional?: string | null
          contract_doc_type?: string | null
          contract_url?: string | null
          created_at?: string
          disclosure?: string | null
          disclosure_optional?: string | null
          id?: string
          is_active?: boolean
          name: string
          price?: number
          price_in_advertised?: boolean
          price_label?: string | null
          price_tiers?: Json | null
          sort_order?: number
          subtitle?: string | null
          updated_at?: string
          upgrade?: Json | null
          warranty?: string | null
        }
        Update: {
          available_preinstalled?: boolean
          badge_type?: string
          benefit_justification?: string
          benefit_justification_optional?: string | null
          contract_doc_type?: string | null
          contract_url?: string | null
          created_at?: string
          disclosure?: string | null
          disclosure_optional?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          price_in_advertised?: boolean
          price_label?: string | null
          price_tiers?: Json | null
          sort_order?: number
          subtitle?: string | null
          updated_at?: string
          upgrade?: Json | null
          warranty?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      qr_codes: {
        Row: {
          code: string
          created_at: string
          document_id: string | null
          id: string
          is_active: boolean
          label: string | null
          surface: string | null
          target_url: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          document_id?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          surface?: string | null
          target_url: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          document_id?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          surface?: string | null
          target_url?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_codes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_scan_events: {
        Row: {
          city: string | null
          code: string
          country: string | null
          id: string
          ip_hash: string | null
          qr_code_id: string | null
          referrer: string | null
          region: string | null
          scanned_at: string
          tenant_id: string | null
          user_agent: string | null
          vehicle_id: string | null
        }
        Insert: {
          city?: string | null
          code: string
          country?: string | null
          id?: string
          ip_hash?: string | null
          qr_code_id?: string | null
          referrer?: string | null
          region?: string | null
          scanned_at?: string
          tenant_id?: string | null
          user_agent?: string | null
          vehicle_id?: string | null
        }
        Update: {
          city?: string | null
          code?: string
          country?: string | null
          id?: string
          ip_hash?: string | null
          qr_code_id?: string | null
          referrer?: string | null
          region?: string | null
          scanned_at?: string
          tenant_id?: string | null
          user_agent?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_scan_events_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scan_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scan_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_scan_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_evidence: {
        Row: {
          consent_text: string | null
          created_at: string
          device_label: string | null
          document_keys: string[]
          id: string
          ip_address: string | null
          metadata: Json
          role: string
          signature_image_url: string | null
          signed_at: string | null
          signer_email: string | null
          signer_name: string | null
          stock: string | null
          tenant_id: string
          user_agent: string | null
          vehicle_id: string | null
          vin: string | null
        }
        Insert: {
          consent_text?: string | null
          created_at?: string
          device_label?: string | null
          document_keys?: string[]
          id?: string
          ip_address?: string | null
          metadata?: Json
          role: string
          signature_image_url?: string | null
          signed_at?: string | null
          signer_email?: string | null
          signer_name?: string | null
          stock?: string | null
          tenant_id: string
          user_agent?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Update: {
          consent_text?: string | null
          created_at?: string
          device_label?: string | null
          document_keys?: string[]
          id?: string
          ip_address?: string | null
          metadata?: Json
          role?: string
          signature_image_url?: string | null
          signed_at?: string | null
          signer_email?: string | null
          signer_name?: string | null
          stock?: string | null
          tenant_id?: string
          user_agent?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Relationships: []
      }
      signed_document_archive: {
        Row: {
          byte_size: number | null
          content_hash: string
          created_at: string
          created_by: string | null
          doc_type: string
          entity_id: string
          id: string
          mime_type: string
          retained_until: string | null
          storage_bucket: string
          storage_path: string
          tenant_id: string | null
          vin: string | null
        }
        Insert: {
          byte_size?: number | null
          content_hash: string
          created_at?: string
          created_by?: string | null
          doc_type: string
          entity_id: string
          id?: string
          mime_type?: string
          retained_until?: string | null
          storage_bucket?: string
          storage_path: string
          tenant_id?: string | null
          vin?: string | null
        }
        Update: {
          byte_size?: number | null
          content_hash?: string
          created_at?: string
          created_by?: string | null
          doc_type?: string
          entity_id?: string
          id?: string
          mime_type?: string
          retained_until?: string | null
          storage_bucket?: string
          storage_path?: string
          tenant_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signed_document_archive_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signed_document_archive_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stale_document_flags: {
        Row: {
          changed_field: string | null
          created_at: string
          generated_document_id: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          status: string
          tenant_id: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          changed_field?: string | null
          created_at?: string
          generated_document_id?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          tenant_id: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          changed_field?: string | null
          created_at?: string
          generated_document_id?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stale_document_flags_generated_document_id_fkey"
            columns: ["generated_document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stale_document_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stale_document_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sticker_template_categories: {
        Row: {
          created_at: string
          id: string
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      sticker_template_versions: {
        Row: {
          changelog: string | null
          config: Json
          id: string
          published_at: string
          template_id: string
          version: number
        }
        Insert: {
          changelog?: string | null
          config?: Json
          id?: string
          published_at?: string
          template_id: string
          version: number
        }
        Update: {
          changelog?: string | null
          config?: Json
          id?: string
          published_at?: string
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sticker_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "sticker_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sticker_templates: {
        Row: {
          config: Json
          created_at: string
          current_version: number
          deleted_at: string | null
          id: string
          is_active: boolean
          is_featured: boolean
          name: string
          preview_url: string | null
          size: string
          style_tags: string[]
          template_key: string
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          name: string
          preview_url?: string | null
          size: string
          style_tags?: string[]
          template_key: string
          type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          name?: string
          preview_url?: string | null
          size?: string
          style_tags?: string[]
          template_key?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_members: {
        Row: {
          accepted_at: string | null
          id: string
          invited_at: string
          invited_by: string | null
          invited_email: string | null
          role: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          invited_email?: string | null
          role?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          invited_email?: string | null
          role?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          autocheck_dealer_id: string | null
          autocurb_profile: Json | null
          autocurb_synced_at: string | null
          autocurb_tenant_id: string | null
          billing_email: string | null
          carfax_dealer_id: string | null
          created_at: string
          domain: string | null
          id: string
          is_active: boolean
          name: string
          primary_email: string | null
          slug: string
          source: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          autocheck_dealer_id?: string | null
          autocurb_profile?: Json | null
          autocurb_synced_at?: string | null
          autocurb_tenant_id?: string | null
          billing_email?: string | null
          carfax_dealer_id?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          is_active?: boolean
          name: string
          primary_email?: string | null
          slug: string
          source?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          autocheck_dealer_id?: string | null
          autocurb_profile?: Json | null
          autocurb_synced_at?: string | null
          autocurb_tenant_id?: string | null
          billing_email?: string | null
          carfax_dealer_id?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          is_active?: boolean
          name?: string
          primary_email?: string | null
          slug?: string
          source?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      trade_in_records: {
        Row: {
          customer_name: string
          deal_vin: string
          deal_ymm: string
          id: string
          notes: string
          received_at: string
          status: string
          store_id: string | null
          tenant_id: string | null
          trade_mileage: number
          trade_value: number
          trade_vin: string
          trade_ymm: string
          updated_at: string
          vehicle_file_id: string | null
        }
        Insert: {
          customer_name?: string
          deal_vin?: string
          deal_ymm?: string
          id?: string
          notes?: string
          received_at?: string
          status?: string
          store_id?: string | null
          tenant_id?: string | null
          trade_mileage?: number
          trade_value?: number
          trade_vin: string
          trade_ymm?: string
          updated_at?: string
          vehicle_file_id?: string | null
        }
        Update: {
          customer_name?: string
          deal_vin?: string
          deal_ymm?: string
          id?: string
          notes?: string
          received_at?: string
          status?: string
          store_id?: string | null
          tenant_id?: string | null
          trade_mileage?: number
          trade_value?: number
          trade_vin?: string
          trade_ymm?: string
          updated_at?: string
          vehicle_file_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_in_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_in_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      used_vehicle_inspection_photos: {
        Row: {
          caption: string | null
          category: string | null
          created_at: string
          id: string
          inspection_id: string
          photo_url: string
          show_on_passport: boolean
          stock: string | null
          tenant_id: string | null
          vehicle_id: string | null
          vin: string | null
        }
        Insert: {
          caption?: string | null
          category?: string | null
          created_at?: string
          id?: string
          inspection_id: string
          photo_url: string
          show_on_passport?: boolean
          stock?: string | null
          tenant_id?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Update: {
          caption?: string | null
          category?: string | null
          created_at?: string
          id?: string
          inspection_id?: string
          photo_url?: string
          show_on_passport?: boolean
          stock?: string | null
          tenant_id?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "used_vehicle_inspection_photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "used_vehicle_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      used_vehicle_inspections: {
        Row: {
          advisor_name: string | null
          alignment_status: string | null
          battery_status: string | null
          created_at: string
          customer_visible_notes: string | null
          fluids_status: string | null
          front_brakes: string | null
          id: string
          inspection_date: string
          inspection_status: string
          manager_approval_status: string
          mileage: number | null
          qr_token: string | null
          rear_brakes: string | null
          recon_summary: string | null
          road_test_status: string | null
          show_on_passport: boolean
          stock: string | null
          store_id: string | null
          technician_name: string | null
          technician_notes: string | null
          tenant_id: string | null
          tires_front_left: string | null
          tires_front_right: string | null
          tires_rear_left: string | null
          tires_rear_right: string | null
          updated_at: string
          vehicle_id: string | null
          vin: string | null
          warning_lights_status: string | null
        }
        Insert: {
          advisor_name?: string | null
          alignment_status?: string | null
          battery_status?: string | null
          created_at?: string
          customer_visible_notes?: string | null
          fluids_status?: string | null
          front_brakes?: string | null
          id?: string
          inspection_date?: string
          inspection_status?: string
          manager_approval_status?: string
          mileage?: number | null
          qr_token?: string | null
          rear_brakes?: string | null
          recon_summary?: string | null
          road_test_status?: string | null
          show_on_passport?: boolean
          stock?: string | null
          store_id?: string | null
          technician_name?: string | null
          technician_notes?: string | null
          tenant_id?: string | null
          tires_front_left?: string | null
          tires_front_right?: string | null
          tires_rear_left?: string | null
          tires_rear_right?: string | null
          updated_at?: string
          vehicle_id?: string | null
          vin?: string | null
          warning_lights_status?: string | null
        }
        Update: {
          advisor_name?: string | null
          alignment_status?: string | null
          battery_status?: string | null
          created_at?: string
          customer_visible_notes?: string | null
          fluids_status?: string | null
          front_brakes?: string | null
          id?: string
          inspection_date?: string
          inspection_status?: string
          manager_approval_status?: string
          mileage?: number | null
          qr_token?: string | null
          rear_brakes?: string | null
          recon_summary?: string | null
          road_test_status?: string | null
          show_on_passport?: boolean
          stock?: string | null
          store_id?: string | null
          technician_name?: string | null
          technician_notes?: string | null
          tenant_id?: string | null
          tires_front_left?: string | null
          tires_front_right?: string | null
          tires_rear_left?: string | null
          tires_rear_right?: string | null
          updated_at?: string
          vehicle_id?: string | null
          vin?: string | null
          warning_lights_status?: string | null
        }
        Relationships: []
      }
      used_vehicle_investment_items: {
        Row: {
          amount: number | null
          created_at: string
          detail: string | null
          id: string
          inspection_id: string
          label: string
          show_on_passport: boolean
          source: string
          stock: string | null
          tenant_id: string | null
          vehicle_id: string | null
          vin: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          detail?: string | null
          id?: string
          inspection_id: string
          label: string
          show_on_passport?: boolean
          source?: string
          stock?: string | null
          tenant_id?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          detail?: string | null
          id?: string
          inspection_id?: string
          label?: string
          show_on_passport?: boolean
          source?: string
          stock?: string | null
          tenant_id?: string | null
          vehicle_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "used_vehicle_investment_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "used_vehicle_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_addendum_items: {
        Row: {
          created_at: string
          description: string | null
          disclosure_text: string | null
          display_order: number
          id: string
          is_included: boolean
          is_installed: boolean
          is_selected: boolean
          item_type: string
          name: string
          price: number
          updated_at: string
          vehicle_addendum_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          disclosure_text?: string | null
          display_order?: number
          id?: string
          is_included?: boolean
          is_installed?: boolean
          is_selected?: boolean
          item_type: string
          name: string
          price?: number
          updated_at?: string
          vehicle_addendum_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          disclosure_text?: string | null
          display_order?: number
          id?: string
          is_included?: boolean
          is_installed?: boolean
          is_selected?: boolean
          item_type?: string
          name?: string
          price?: number
          updated_at?: string
          vehicle_addendum_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_addendum_items_vehicle_addendum_id_fkey"
            columns: ["vehicle_addendum_id"]
            isOneToOne: false
            referencedRelation: "vehicle_addendums"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_addendums: {
        Row: {
          available_upgrades_total: number
          base_msrp: number
          created_at: string
          id: string
          installed_total: number
          selected_upgrades_total: number
          status: string
          tenant_id: string
          total_msrp: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          available_upgrades_total?: number
          base_msrp?: number
          created_at?: string
          id?: string
          installed_total?: number
          selected_upgrades_total?: number
          status?: string
          tenant_id: string
          total_msrp?: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          available_upgrades_total?: number
          base_msrp?: number
          created_at?: string
          id?: string
          installed_total?: number
          selected_upgrades_total?: number
          status?: string
          tenant_id?: string
          total_msrp?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      vehicle_files: {
        Row: {
          aftermarket_installs: Json
          attached_documents: Json
          available_accessories: Json
          cobuyer_email: string
          cobuyer_name: string
          cobuyer_phone: string
          condition: string
          created_at: string
          created_by: string | null
          customer_email: string
          customer_info: Json
          customer_name: string
          customer_phone: string
          deal_qr_token: string
          deal_status: string
          factory_equipment: Json
          feed_source: string | null
          id: string
          make: string
          market_value: number
          mileage: number
          model: string
          msrp: number
          service_records: Json
          signings: Json
          sold_at: string | null
          stickers: Json
          stock_number: string
          store_id: string | null
          tenant_id: string | null
          trim: string
          updated_at: string
          vin: string
          warranty_info: Json
          year: string
        }
        Insert: {
          aftermarket_installs?: Json
          attached_documents?: Json
          available_accessories?: Json
          cobuyer_email?: string
          cobuyer_name?: string
          cobuyer_phone?: string
          condition?: string
          created_at?: string
          created_by?: string | null
          customer_email?: string
          customer_info?: Json
          customer_name?: string
          customer_phone?: string
          deal_qr_token?: string
          deal_status?: string
          factory_equipment?: Json
          feed_source?: string | null
          id?: string
          make?: string
          market_value?: number
          mileage?: number
          model?: string
          msrp?: number
          service_records?: Json
          signings?: Json
          sold_at?: string | null
          stickers?: Json
          stock_number?: string
          store_id?: string | null
          tenant_id?: string | null
          trim?: string
          updated_at?: string
          vin: string
          warranty_info?: Json
          year?: string
        }
        Update: {
          aftermarket_installs?: Json
          attached_documents?: Json
          available_accessories?: Json
          cobuyer_email?: string
          cobuyer_name?: string
          cobuyer_phone?: string
          condition?: string
          created_at?: string
          created_by?: string | null
          customer_email?: string
          customer_info?: Json
          customer_name?: string
          customer_phone?: string
          deal_qr_token?: string
          deal_status?: string
          factory_equipment?: Json
          feed_source?: string | null
          id?: string
          make?: string
          market_value?: number
          mileage?: number
          model?: string
          msrp?: number
          service_records?: Json
          signings?: Json
          sold_at?: string | null
          stickers?: Json
          stock_number?: string
          store_id?: string | null
          tenant_id?: string | null
          trim?: string
          updated_at?: string
          vin?: string
          warranty_info?: Json
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_listings: {
        Row: {
          available_accessories: Json
          certification: Json | null
          closed_recall_count: number | null
          condition: string | null
          created_at: string
          created_by: string | null
          dealer_snapshot: Json
          default_locale: string
          description: string | null
          documents: Json
          factory_sticker_url: string | null
          features: Json
          feed_source: string | null
          hero_image_url: string | null
          id: string
          install_token: string
          key_specs: Json
          market_checked_at: string | null
          market_payload: Json | null
          market_position: string | null
          market_value: number | null
          mc_attributes: Json
          mileage: number | null
          oem_sticker_checked_at: string | null
          oem_sticker_url: string | null
          open_recall_count: number | null
          packet_modules: Json
          payment_estimate: Json | null
          photo_count: number | null
          photos: Json
          prep_status: Json | null
          price: number | null
          published_at: string | null
          recall_check: Json | null
          recall_checked_at: string | null
          recall_override_at: string | null
          recall_override_by: string | null
          recall_override_notes: string | null
          recall_payload: Json | null
          recall_status: string | null
          scrape_last_synced_at: string | null
          scrape_source_url: string | null
          service_records: Json
          slug: string
          source_url: string | null
          status: string
          sticker_snapshot: Json
          store_id: string
          tenant_id: string | null
          trim: string | null
          updated_at: string
          value_props: Json
          vehicle_file_id: string | null
          videos: Json
          view_count: number
          vin: string
          warranty_info: Json
          ymm: string | null
        }
        Insert: {
          available_accessories?: Json
          certification?: Json | null
          closed_recall_count?: number | null
          condition?: string | null
          created_at?: string
          created_by?: string | null
          dealer_snapshot?: Json
          default_locale?: string
          description?: string | null
          documents?: Json
          factory_sticker_url?: string | null
          features?: Json
          feed_source?: string | null
          hero_image_url?: string | null
          id?: string
          install_token?: string
          key_specs?: Json
          market_checked_at?: string | null
          market_payload?: Json | null
          market_position?: string | null
          market_value?: number | null
          mc_attributes?: Json
          mileage?: number | null
          oem_sticker_checked_at?: string | null
          oem_sticker_url?: string | null
          open_recall_count?: number | null
          packet_modules?: Json
          payment_estimate?: Json | null
          photo_count?: number | null
          photos?: Json
          prep_status?: Json | null
          price?: number | null
          published_at?: string | null
          recall_check?: Json | null
          recall_checked_at?: string | null
          recall_override_at?: string | null
          recall_override_by?: string | null
          recall_override_notes?: string | null
          recall_payload?: Json | null
          recall_status?: string | null
          scrape_last_synced_at?: string | null
          scrape_source_url?: string | null
          service_records?: Json
          slug: string
          source_url?: string | null
          status?: string
          sticker_snapshot?: Json
          store_id: string
          tenant_id?: string | null
          trim?: string | null
          updated_at?: string
          value_props?: Json
          vehicle_file_id?: string | null
          videos?: Json
          view_count?: number
          vin: string
          warranty_info?: Json
          ymm?: string | null
        }
        Update: {
          available_accessories?: Json
          certification?: Json | null
          closed_recall_count?: number | null
          condition?: string | null
          created_at?: string
          created_by?: string | null
          dealer_snapshot?: Json
          default_locale?: string
          description?: string | null
          documents?: Json
          factory_sticker_url?: string | null
          features?: Json
          feed_source?: string | null
          hero_image_url?: string | null
          id?: string
          install_token?: string
          key_specs?: Json
          market_checked_at?: string | null
          market_payload?: Json | null
          market_position?: string | null
          market_value?: number | null
          mc_attributes?: Json
          mileage?: number | null
          oem_sticker_checked_at?: string | null
          oem_sticker_url?: string | null
          open_recall_count?: number | null
          packet_modules?: Json
          payment_estimate?: Json | null
          photo_count?: number | null
          photos?: Json
          prep_status?: Json | null
          price?: number | null
          published_at?: string | null
          recall_check?: Json | null
          recall_checked_at?: string | null
          recall_override_at?: string | null
          recall_override_by?: string | null
          recall_override_notes?: string | null
          recall_payload?: Json | null
          recall_status?: string | null
          scrape_last_synced_at?: string | null
          scrape_source_url?: string | null
          service_records?: Json
          slug?: string
          source_url?: string | null
          status?: string
          sticker_snapshot?: Json
          store_id?: string
          tenant_id?: string | null
          trim?: string | null
          updated_at?: string
          value_props?: Json
          vehicle_file_id?: string | null
          videos?: Json
          view_count?: number
          vin?: string
          warranty_info?: Json
          ymm?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_listings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_listings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_listings_vehicle_file_id_fkey"
            columns: ["vehicle_file_id"]
            isOneToOne: false
            referencedRelation: "vehicle_files"
            referencedColumns: ["id"]
          },
        ]
      }
      vin_queue: {
        Row: {
          condition: string | null
          decoded_data: Json
          id: string
          mileage: string
          notes: string
          scanned_at: string
          status: string
          stock_number: string
          store_id: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string | null
          vin: string
        }
        Insert: {
          condition?: string | null
          decoded_data?: Json
          id?: string
          mileage?: string
          notes?: string
          scanned_at?: string
          status?: string
          stock_number?: string
          store_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          vin: string
        }
        Update: {
          condition?: string | null
          decoded_data?: Json
          id?: string
          mileage?: string
          notes?: string
          scanned_at?: string
          status?: string
          stock_number?: string
          store_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          vin?: string
        }
        Relationships: [
          {
            foreignKeyName: "vin_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vin_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_signups: {
        Row: {
          city: string | null
          created_at: string
          current_provider: string | null
          dealership_name: string
          email: string
          full_name: string
          id: string
          monthly_volume: string | null
          notes: string | null
          oem_brands: string | null
          phone: string | null
          role: string | null
          rooftops: string | null
          source: string | null
          state: string | null
          status: string
          user_agent: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          current_provider?: string | null
          dealership_name: string
          email: string
          full_name: string
          id?: string
          monthly_volume?: string | null
          notes?: string | null
          oem_brands?: string | null
          phone?: string | null
          role?: string | null
          rooftops?: string | null
          source?: string | null
          state?: string | null
          status?: string
          user_agent?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          current_provider?: string | null
          dealership_name?: string
          email?: string
          full_name?: string
          id?: string
          monthly_volume?: string | null
          notes?: string | null
          oem_brands?: string | null
          phone?: string | null
          role?: string | null
          rooftops?: string | null
          source?: string | null
          state?: string | null
          status?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      warranty_records: {
        Row: {
          coverage_type: string
          created_at: string
          customer_name: string
          id: string
          notes: string
          product_id: string
          product_name: string
          provider: string
          registration_number: string
          status: string
          store_id: string | null
          tenant_id: string
          updated_at: string
          vehicle_vin: string
          vehicle_ymm: string
          warranty_end: string | null
          warranty_start: string | null
        }
        Insert: {
          coverage_type?: string
          created_at?: string
          customer_name?: string
          id?: string
          notes?: string
          product_id?: string
          product_name?: string
          provider?: string
          registration_number?: string
          status?: string
          store_id?: string | null
          tenant_id: string
          updated_at?: string
          vehicle_vin: string
          vehicle_ymm?: string
          warranty_end?: string | null
          warranty_start?: string | null
        }
        Update: {
          coverage_type?: string
          created_at?: string
          customer_name?: string
          id?: string
          notes?: string
          product_id?: string
          product_name?: string
          provider?: string
          registration_number?: string
          status?: string
          store_id?: string | null
          tenant_id?: string
          updated_at?: string
          vehicle_vin?: string
          vehicle_ymm?: string
          warranty_end?: string | null
          warranty_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warranty_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      zebra_print_jobs: {
        Row: {
          created_at: string
          id: string
          label_type: string
          printer_name: string
          status: string
          stock_number: string
          store_id: string | null
          tenant_id: string
          vin: string
          ymm: string
          zpl_content: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_type: string
          printer_name?: string
          status?: string
          stock_number?: string
          store_id?: string | null
          tenant_id: string
          vin: string
          ymm?: string
          zpl_content: string
        }
        Update: {
          created_at?: string
          id?: string
          label_type?: string
          printer_name?: string
          status?: string
          stock_number?: string
          store_id?: string | null
          tenant_id?: string
          vin?: string
          ymm?: string
          zpl_content?: string
        }
        Relationships: [
          {
            foreignKeyName: "zebra_print_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zebra_print_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      addendum_signings_full: {
        Row: {
          acknowledgments: Json | null
          addendum_id: string | null
          content_hash: string | null
          deal_token_id: string | null
          delivery_mileage: number | null
          id: string | null
          ip_address: string | null
          prep_sign_off_id: string | null
          signature_type: string | null
          signed_at: string | null
          signer_email: string | null
          signer_name: string | null
          signer_phone: string | null
          signer_type: string | null
          tenant_id: string | null
          tenant_name: string | null
          vehicle_listing_id: string | null
          vin: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addendum_signings_addendum_id_fkey"
            columns: ["addendum_id"]
            isOneToOne: false
            referencedRelation: "addendums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_deal_token_id_fkey"
            columns: ["deal_token_id"]
            isOneToOne: false
            referencedRelation: "deal_signing_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_prep_sign_off_id_fkey"
            columns: ["prep_sign_off_id"]
            isOneToOne: false
            referencedRelation: "prep_sign_offs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addendum_signings_vehicle_listing_id_fkey"
            columns: ["vehicle_listing_id"]
            isOneToOne: false
            referencedRelation: "vehicle_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_engagement_document_summary: {
        Row: {
          document_id: string | null
          document_title: string | null
          document_type: string | null
          downloads: number | null
          last_opened_at: string | null
          opens: number | null
          prints: number | null
          tenant_id: string | null
          total_events: number | null
          unique_sessions: number | null
          vehicle_id: string | null
          vin: string | null
        }
        Relationships: []
      }
      customer_engagement_vehicle_summary: {
        Row: {
          cta_clicks: number | null
          document_opens: number | null
          first_engaged_at: string | null
          last_engaged_at: string | null
          leads: number | null
          packet_opens: number | null
          passport_opens: number | null
          sticker_scans: number | null
          stock: string | null
          tenant_id: string | null
          total_events: number | null
          unique_sessions: number | null
          vehicle_id: string | null
          vin: string | null
        }
        Relationships: []
      }
      passport_delivery_request_summary: {
        Row: {
          delivered_requests: number | null
          last_requested_at: string | null
          leads_created: number | null
          phone_captured: number | null
          stock: string | null
          tenant_id: string | null
          total_requests: number | null
          trade_intent_count: number | null
          vehicle_id: string | null
          verified_requests: number | null
          vin: string | null
        }
        Relationships: []
      }
      tenant_summary: {
        Row: {
          active_apps: number | null
          app_slugs: string[] | null
          created_at: string | null
          domain: string | null
          id: string | null
          is_active: boolean | null
          last_activity: string | null
          member_count: number | null
          name: string | null
          slug: string | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          active_apps?: never
          app_slugs?: never
          created_at?: string | null
          domain?: string | null
          id?: string | null
          is_active?: boolean | null
          last_activity?: never
          member_count?: never
          name?: string | null
          slug?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          active_apps?: never
          app_slugs?: never
          created_at?: string | null
          domain?: string | null
          id?: string | null
          is_active?: boolean | null
          last_activity?: never
          member_count?: never
          name?: string | null
          slug?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _audit_chain_payload: {
        Args: {
          _action: string
          _created_at: string
          _details: Json
          _entity_id: string
          _entity_type: string
          _prev_hash: string
          _store_id: string
          _user_email: string
        }
        Returns: string
      }
      admin_clear_synced_inventory: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      admin_create_tenant: {
        Args: {
          _app_slug?: string
          _domain: string
          _name: string
          _owner_email: string
          _plan_tier?: string
          _slug: string
          _trial_days?: number
        }
        Returns: string
      }
      admin_invite_member: {
        Args: { _email: string; _role?: string; _tenant_id: string }
        Returns: string
      }
      admin_link_autocurb: {
        Args: { p_autocurb_id: string; p_profile: Json; p_tenant_id: string }
        Returns: undefined
      }
      admin_override_entitlement: {
        Args: {
          _app_slug: string
          _expires_at?: string
          _plan_tier: string
          _seat_limit?: number
          _status: string
          _tenant_id: string
        }
        Returns: string
      }
      admin_set_member_role: {
        Args: { _member_id: string; _role: string }
        Returns: boolean
      }
      admin_set_tenant_active: {
        Args: { _active: boolean; _tenant_id: string }
        Returns: boolean
      }
      admin_set_tenant_features: {
        Args: { _patch: Json; _tenant_id: string }
        Returns: undefined
      }
      autocurb_cancel_subscription: {
        Args: { p_stripe_subscription_id: string }
        Returns: number
      }
      autocurb_upsert_dealer: {
        Args: {
          p_autocurb_tenant_id: string
          p_autocurb_tier: string
          p_autolabels_tier?: string
          p_bundle_autolabels: boolean
          p_dealer_name: string
          p_expires_at?: string
          p_state: string
          p_stripe_customer_id?: string
          p_stripe_subscription_id?: string
          p_user_email: string
          p_user_id: string
        }
        Returns: string
      }
      bootstrap_tenant: {
        Args: {
          _app_slug?: string
          _name: string
          _plan_tier?: string
          _slug: string
          _source?: string
        }
        Returns: string
      }
      claim_platform: { Args: never; Returns: Json }
      current_tenant_id: { Args: never; Returns: string }
      find_abandoned_signings: {
        Args: {
          _limit?: number
          _min_hours_since_open?: number
          _min_hours_since_retry?: number
        }
        Returns: {
          addendum_id: string
          customer_email: string
          dealer_name: string
          opened_at: string
          signing_token: string
          store_id: string
          tenant_id: string
          vehicle_vin: string
          vehicle_ymm: string
        }[]
      }
      get_addendum_by_token: {
        Args: { _token: string }
        Returns: {
          addendum_date: string
          buyers_guide_id: string
          cobuyer_name: string
          dealer_snapshot: Json
          financing_input: Json
          id: string
          initials: Json
          listing_slug: string
          optional_selections: Json
          price_overrides: Json
          price_verification_status: string
          price_verified: boolean
          products_snapshot: Json
          sb766_add_on_precontract: Json
          sb766_financing_disclosure: Json
          sb766_three_day_return_ack: boolean
          selling_price: number
          status: string
          vehicle_condition: string
          vehicle_price: number
          vehicle_state: string
          vehicle_vin: string
          vehicle_ymm: string
        }[]
      }
      get_cron_job_status: {
        Args: { _jobname: string }
        Returns: {
          active: boolean
          jobname: string
          last_end: string
          last_message: string
          last_start: string
          last_status: string
          schedule: string
        }[]
      }
      get_deal_token: {
        Args: { _token: string }
        Returns: {
          content_hash: string | null
          created_at: string
          created_by: string | null
          customer_ip: string | null
          esign_consent: Json | null
          expires_at: string
          id: string
          revoked_at: string | null
          signed_at: string | null
          signed_payload: Json | null
          status: string
          tenant_id: string | null
          token: string
          updated_at: string
          user_agent: string | null
          vehicle_file_id: string
          vehicle_payload: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "deal_signing_tokens"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_install_proofs_public: {
        Args: { _slug: string }
        Returns: {
          id: string
          installed_at: string
          installer_company: string
          photo_path: string
          product_name: string
        }[]
      }
      get_or_create_install_token: {
        Args: { _store_id: string; _vin: string; _ymm?: string }
        Returns: string
      }
      get_published_documents_public: {
        Args: { p_slug: string }
        Returns: {
          document_type: string
          id: string
          online_url: string
          pdf_url: string
          png_url: string
          published_at: string
          template_id: string
          version: number
        }[]
      }
      get_reengage_schedule: {
        Args: never
        Returns: {
          active: boolean
          jobid: number
          schedule: string
        }[]
      }
      get_signing_documents: {
        Args: { _token: string }
        Returns: {
          approved_at: string
          created_at: string
          document_type: string
          id: string
          label_mode: string
          online_url: string
          pdf_url: string
          png_url: string
          published_at: string
          template_id: string
          template_version: number
          version: number
        }[]
      }
      get_vehicle_file_by_deal_token: {
        Args: { _token: string }
        Returns: {
          aftermarket_installs: Json
          attached_documents: Json
          available_accessories: Json
          cobuyer_email: string
          cobuyer_name: string
          cobuyer_phone: string
          condition: string
          created_at: string
          created_by: string | null
          customer_email: string
          customer_info: Json
          customer_name: string
          customer_phone: string
          deal_qr_token: string
          deal_status: string
          factory_equipment: Json
          feed_source: string | null
          id: string
          make: string
          market_value: number
          mileage: number
          model: string
          msrp: number
          service_records: Json
          signings: Json
          sold_at: string | null
          stickers: Json
          stock_number: string
          store_id: string | null
          tenant_id: string | null
          trim: string
          updated_at: string
          vin: string
          warranty_info: Json
          year: string
        }[]
        SetofOptions: {
          from: "*"
          to: "vehicle_files"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_vehicle_listing_by_slug: {
        Args: { _slug: string }
        Returns: {
          available_accessories: Json
          certification: Json | null
          closed_recall_count: number | null
          condition: string | null
          created_at: string
          created_by: string | null
          dealer_snapshot: Json
          default_locale: string
          description: string | null
          documents: Json
          factory_sticker_url: string | null
          features: Json
          feed_source: string | null
          hero_image_url: string | null
          id: string
          install_token: string
          key_specs: Json
          market_checked_at: string | null
          market_payload: Json | null
          market_position: string | null
          market_value: number | null
          mc_attributes: Json
          mileage: number | null
          oem_sticker_checked_at: string | null
          oem_sticker_url: string | null
          open_recall_count: number | null
          packet_modules: Json
          payment_estimate: Json | null
          photo_count: number | null
          photos: Json
          prep_status: Json | null
          price: number | null
          published_at: string | null
          recall_check: Json | null
          recall_checked_at: string | null
          recall_override_at: string | null
          recall_override_by: string | null
          recall_override_notes: string | null
          recall_payload: Json | null
          recall_status: string | null
          scrape_last_synced_at: string | null
          scrape_source_url: string | null
          service_records: Json
          slug: string
          source_url: string | null
          status: string
          sticker_snapshot: Json
          store_id: string
          tenant_id: string | null
          trim: string | null
          updated_at: string
          value_props: Json
          vehicle_file_id: string | null
          videos: Json
          view_count: number
          vin: string
          warranty_info: Json
          ymm: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "vehicle_listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_app_access: { Args: { _app_slug: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_listing_view: { Args: { _slug: string }; Returns: undefined }
      is_tenant_manager: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      listings_with_stale_recalls: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          published_at: string
          recall_checked_at: string
          slug: string
          status: string
          store_id: string
          tenant_id: string
          vin: string
          ymm: string
        }[]
      }
      log_qr_scan: {
        Args: {
          _browser?: string
          _device?: string
          _referrer?: string
          _token: string
          _ua?: string
        }
        Returns: string
      }
      mark_addendum_executed: {
        Args: { _addendum_id: string }
        Returns: undefined
      }
      mark_ready_for_signature: {
        Args: { _addendum_id: string; _version_label: string }
        Returns: undefined
      }
      marketcheck_prune_inventory: {
        Args: { _live_vins: string[]; _tenant_id: string }
        Returns: Json
      }
      merge_scraped_vdp: {
        Args: {
          _description: string
          _features: Json
          _key_specs: Json
          _mileage?: number
          _options?: Json
          _photos: Json
          _price?: number
          _source_url: string
          _vehicle_id: string
        }
        Returns: string
      }
      record_addendum_event: {
        Args: {
          _channel?: string
          _details?: Json
          _event: string
          _signing_token: string
        }
        Returns: undefined
      }
      record_customer_signing: {
        Args: {
          _acknowledgments: Json
          _canonical_payload: Json
          _content_hash: string
          _delivery_mileage: number
          _esign_consent: Json
          _ip_address: string
          _price_overrides: Json
          _signature_data: string
          _signature_type: string
          _signer_email: string
          _signer_name: string
          _signer_phone: string
          _signer_type: string
          _signing_location: Json
          _signing_token: string
          _user_agent: string
        }
        Returns: string
      }
      record_evidence_receipt: {
        Args: {
          _chain_root: string
          _manifest: Json
          _packet_version?: string
          _vin: string
        }
        Returns: string
      }
      record_install_proof:
        | {
            Args: {
              _install_token: string
              _installed_at: string
              _installer_company: string
              _installer_name: string
              _notes?: string
              _photo_path: string
              _product_id: string
              _product_name: string
            }
            Returns: string
          }
        | {
            Args: {
              _install_token: string
              _installed_at: string
              _installer_company: string
              _installer_ip: string
              _installer_name: string
              _installer_signature_data: string
              _installer_signature_type: string
              _notes: string
              _photo_path: string
              _product_id: string
              _product_name: string
            }
            Returns: string
          }
      record_signing_reengagement: {
        Args: { _addendum_id: string; _channel?: string; _details?: Json }
        Returns: undefined
      }
      request_signing_link_resend: {
        Args: { _contact: string; _origin?: string; _vin: string }
        Returns: Json
      }
      save_marketcheck_config:
        | {
            Args: {
              _day_of_week: number
              _enabled: boolean
              _frequency: string
              _max_vehicles: number
              _run_hour: number
              _source: string
              _tenant_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _day_of_week: number
              _dealer_id: string
              _enabled: boolean
              _frequency: string
              _max_vehicles: number
              _run_hour: number
              _source: string
              _tenant_id: string
            }
            Returns: undefined
          }
      schedule_marketcheck_sync: {
        Args: {
          _cron_expr?: string
          _service_key?: string
          _supabase_url?: string
        }
        Returns: number
      }
      schedule_reengage_abandoned_signings: {
        Args: {
          _cron_expr?: string
          _service_key?: string
          _supabase_url?: string
        }
        Returns: number
      }
      set_marketcheck_allowed: {
        Args: { _allowed: boolean; _tenant_id: string }
        Returns: undefined
      }
      sign_deal_token: {
        Args: {
          _content_hash: string
          _customer_ip: string
          _esign_consent: Json
          _signed_payload: Json
          _token: string
          _user_agent: string
        }
        Returns: boolean
      }
      tenant_price_verification_on: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      unschedule_marketcheck_sync: { Args: never; Returns: undefined }
      unschedule_reengage_abandoned_signings: {
        Args: never
        Returns: undefined
      }
      verify_addendum_price: {
        Args: { _addendum_id: string; _tolerance?: number }
        Returns: string
      }
      verify_audit_chain: {
        Args: { _store_id: string }
        Returns: {
          first_break_at: string
          first_break_id: string
          total: number
          verified: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
