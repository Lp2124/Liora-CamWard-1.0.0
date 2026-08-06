CREATE TABLE "premium_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"is_redeemed" boolean DEFAULT false NOT NULL,
	"redeemed_by_openid" text,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "scan_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"module" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_openid" text NOT NULL,
	"label" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"modules_run" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"risk_level" text,
	"latitude" double precision,
	"longitude" double precision
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_openid" text PRIMARY KEY NOT NULL,
	"scans_this_month" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"openid" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"locale" text DEFAULT 'es' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_premium" boolean DEFAULT false NOT NULL,
	"premium_lifetime" boolean DEFAULT false NOT NULL,
	"premium_since" timestamp with time zone,
	"premium_expires_at" timestamp with time zone,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "premium_codes" ADD CONSTRAINT "premium_codes_redeemed_by_openid_app_users_openid_fk" FOREIGN KEY ("redeemed_by_openid") REFERENCES "public"."app_users"("openid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_findings" ADD CONSTRAINT "scan_findings_session_id_scan_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."scan_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_user_openid_app_users_openid_fk" FOREIGN KEY ("user_openid") REFERENCES "public"."app_users"("openid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_openid_app_users_openid_fk" FOREIGN KEY ("user_openid") REFERENCES "public"."app_users"("openid") ON DELETE no action ON UPDATE no action;