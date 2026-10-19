CREATE TYPE "public"."finding_category" AS ENUM('dependency', 'code', 'config');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"category" "finding_category" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"rule_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"recommendation" text NOT NULL,
	"location" text NOT NULL,
	"reference_id" text,
	"reference_url" text,
	"evidence" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "osv_vulns" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"repo_url" text NOT NULL,
	"ref_requested" text,
	"ref_resolved" text,
	"commit_sha" text NOT NULL,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"stage" text,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"progress_message" text DEFAULT 'Queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"summarizer" text,
	"summarizer_note" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_scan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_scan_idx" ON "findings" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "findings_scan_fp_idx" ON "findings" USING btree ("scan_id","fingerprint");--> statement-breakpoint
CREATE INDEX "scan_events_scan_idx" ON "scan_events" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "scans_repo_created_idx" ON "scans" USING btree ("repo_url","created_at");--> statement-breakpoint
CREATE INDEX "scans_repo_commit_idx" ON "scans" USING btree ("repo_url","commit_sha");--> statement-breakpoint
CREATE INDEX "scans_status_idx" ON "scans" USING btree ("status");