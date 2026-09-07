ALTER TABLE "account" DROP CONSTRAINT "account_reconciled_by_app_user_id_fk";
--> statement-breakpoint
ALTER TABLE "account_transaction" DROP CONSTRAINT "account_transaction_created_by_app_user_id_fk";
--> statement-breakpoint
ALTER TABLE "cash_movement" DROP CONSTRAINT "cash_movement_created_by_app_user_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_closing" DROP CONSTRAINT "daily_closing_closed_by_app_user_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_closing" DROP CONSTRAINT "daily_closing_voided_by_app_user_id_fk";
--> statement-breakpoint
ALTER TABLE "expense" DROP CONSTRAINT "expense_voided_by_app_user_id_fk";
--> statement-breakpoint
ALTER TABLE "expense" DROP CONSTRAINT "expense_created_by_app_user_id_fk";
